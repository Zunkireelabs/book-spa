-- Migration 071: referral reward redemption at checkout (additive, REVERSIBLE)
--
-- migration-067/068/069/070 built the customer_referrals + customer_referral_credits
-- ledger, but nothing ever let a referring customer actually SPEND a reward: wallet
-- credits were an append-only ledger with no debit/spend mechanism, and vouchers were
-- just a reporting label with no redemption tracking at all.
--
-- This migration adds:
--   1. customer_referral_debits — append-only debit ledger, mirrors
--      customer_referral_credits. get_referral_credit_balance nets credits - debits.
--   2. Voucher redemption tracking columns on customer_referrals.
--   3. record_referral_wallet_payment(booking_id, amount, notes) — SECURITY DEFINER,
--      directly modeled on record_membership_payment (migration-046): atomically
--      inserts a payments row (payment_mode='ReferralWallet') and a debit row.
--   4. redeem_referral_voucher(referral_id, booking_id) — SECURITY DEFINER: atomically
--      inserts a payments row (payment_mode='ReferralVoucher', amount = catalog value)
--      and marks the referral row redeemed. Generic against whatever reward_catalog
--      rows exist — no hardcoded voucher names.
--
-- payments.payment_mode has no fixed CHECK allowlist since migration-052 (relaxed to a
-- basic sanity check), so no constraint change is needed there.
--
-- Idempotent: CREATE ... IF NOT EXISTS, CREATE OR REPLACE FUNCTION, guarded ALTER TABLE
-- ADD COLUMN. Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.redeem_referral_voucher(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.record_referral_wallet_payment(uuid, numeric, text);
--   ALTER TABLE public.customer_referrals DROP COLUMN IF EXISTS redeemed_at;
--   ALTER TABLE public.customer_referrals DROP COLUMN IF EXISTS redeemed_booking_id;
--   ALTER TABLE public.customer_referrals DROP COLUMN IF EXISTS redeemed_by;
--   DROP TABLE IF EXISTS public.customer_referral_debits;
--   -- get_referral_credit_balance: re-run migration-067's original definition to revert.

-- ============================================================
-- 1. TABLE: customer_referral_debits (append-only spend ledger)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.customer_referral_debits (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id  uuid        NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  amount       numeric(12,2) NOT NULL CHECK (amount > 0),
  booking_id   uuid        REFERENCES public.bookings(id) ON DELETE SET NULL,
  payment_id   uuid        REFERENCES public.payments(id) ON DELETE SET NULL,
  created_by   uuid        REFERENCES public.users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_referral_debits_customer
  ON public.customer_referral_debits(org_id, customer_id);

ALTER TABLE public.customer_referral_debits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own org customer referral debits" ON public.customer_referral_debits;
CREATE POLICY "Users can read own org customer referral debits"
  ON public.customer_referral_debits FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

-- NO INSERT/UPDATE/DELETE policy — ledger is append-only via
-- record_referral_wallet_payment() (SECURITY DEFINER, below).

-- ============================================================
-- 2. customer_referrals: voucher redemption tracking columns
-- ============================================================

ALTER TABLE public.customer_referrals
  ADD COLUMN IF NOT EXISTS redeemed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS redeemed_booking_id  uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS redeemed_by          uuid REFERENCES public.users(id);

-- ============================================================
-- 3. get_referral_credit_balance — net credits minus debits
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_referral_credit_balance(
  p_customer_id uuid
)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE((SELECT SUM(amount) FROM public.customer_referral_credits
              WHERE customer_id = p_customer_id AND org_id = get_user_org_id()), 0)
    -
    COALESCE((SELECT SUM(amount) FROM public.customer_referral_debits
              WHERE customer_id = p_customer_id AND org_id = get_user_org_id()), 0);
$$;

REVOKE ALL ON FUNCTION public.get_referral_credit_balance(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_referral_credit_balance(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_referral_credit_balance(uuid) TO authenticated;

-- ============================================================
-- 4. record_referral_wallet_payment — atomic payment + wallet debit
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_referral_wallet_payment(
  p_booking_id  uuid,
  p_amount      numeric,
  p_notes       text DEFAULT NULL
)
RETURNS uuid  -- the new payments.id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_org    uuid := get_user_org_id();
  v_actor         uuid := auth.uid();
  v_customer_id   uuid;
  v_booking_org   uuid;
  v_is_locked     boolean;
  v_balance       numeric(12,2);
  v_payment_id    uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'record_referral_wallet_payment: must be signed in';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'record_referral_wallet_payment: amount must be positive';
  END IF;

  SELECT b.customer_id, br.org_id, b.is_locked
    INTO v_customer_id, v_booking_org, v_is_locked
  FROM public.bookings b
  JOIN public.branches br ON br.id = b.branch_id
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;

  IF v_booking_org IS NULL THEN
    RAISE EXCEPTION 'record_referral_wallet_payment: booking % not found', p_booking_id;
  END IF;

  IF v_booking_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_referral_wallet_payment: booking is not in your organization';
  END IF;

  IF v_is_locked THEN
    RAISE EXCEPTION 'record_referral_wallet_payment: this day has been closed, no further modifications allowed';
  END IF;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'record_referral_wallet_payment: booking has no linked customer';
  END IF;

  -- Re-derive the balance server-side rather than trusting the client's read —
  -- never trust a client-computed balance for a spend.
  v_balance := public.get_referral_credit_balance(v_customer_id);

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'record_referral_wallet_payment: insufficient referral wallet balance (have %, need %)',
      v_balance, p_amount;
  END IF;

  INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
  VALUES (p_booking_id, p_amount, 'ReferralWallet', v_actor, p_notes)
  RETURNING id INTO v_payment_id;

  INSERT INTO public.customer_referral_debits
    (org_id, customer_id, amount, booking_id, payment_id, created_by)
  VALUES
    (v_caller_org, v_customer_id, p_amount, p_booking_id, v_payment_id, v_actor);

  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_referral_wallet_payment(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_referral_wallet_payment(uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_referral_wallet_payment(uuid, numeric, text) TO authenticated;

-- ============================================================
-- 5. redeem_referral_voucher — atomic payment + voucher redemption
-- ============================================================

CREATE OR REPLACE FUNCTION public.redeem_referral_voucher(
  p_referral_id uuid,
  p_booking_id  uuid
)
RETURNS uuid  -- the new payments.id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_org      uuid := get_user_org_id();
  v_actor           uuid := auth.uid();
  v_referral_org    uuid;
  v_referring_cust  uuid;
  v_reward_type     text;
  v_reward_status   text;
  v_redeemed_at     timestamptz;
  v_catalog_value   numeric(12,2);
  v_requested       numeric(12,2);
  v_value           numeric(12,2);
  v_booking_org     uuid;
  v_booking_customer uuid;
  v_is_locked       boolean;
  v_payment_id      uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'redeem_referral_voucher: must be signed in';
  END IF;

  SELECT cr.org_id, cr.referring_customer_id, cr.reward_type, cr.reward_status,
         cr.redeemed_at, rc.value, cr.requested_reward_amount
    INTO v_referral_org, v_referring_cust, v_reward_type, v_reward_status,
         v_redeemed_at, v_catalog_value, v_requested
  FROM public.customer_referrals cr
  LEFT JOIN public.reward_catalog rc ON rc.id = cr.reward_catalog_id
  WHERE cr.id = p_referral_id
  FOR UPDATE OF cr;

  IF v_referral_org IS NULL THEN
    RAISE EXCEPTION 'redeem_referral_voucher: referral % not found', p_referral_id;
  END IF;
  IF v_referral_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'redeem_referral_voucher: referral is not in your organization';
  END IF;
  IF v_reward_type IS DISTINCT FROM 'voucher' THEN
    RAISE EXCEPTION 'redeem_referral_voucher: referral % is not a voucher reward', p_referral_id;
  END IF;
  IF v_reward_status IS DISTINCT FROM 'credited' THEN
    RAISE EXCEPTION 'redeem_referral_voucher: reward has not been credited yet';
  END IF;
  IF v_redeemed_at IS NOT NULL THEN
    RAISE EXCEPTION 'redeem_referral_voucher: voucher has already been redeemed';
  END IF;

  SELECT b.customer_id, br.org_id, b.is_locked
    INTO v_booking_customer, v_booking_org, v_is_locked
  FROM public.bookings b
  JOIN public.branches br ON br.id = b.branch_id
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;

  IF v_booking_org IS NULL THEN
    RAISE EXCEPTION 'redeem_referral_voucher: booking % not found', p_booking_id;
  END IF;
  IF v_booking_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'redeem_referral_voucher: booking is not in your organization';
  END IF;
  IF v_is_locked THEN
    RAISE EXCEPTION 'redeem_referral_voucher: this day has been closed, no further modifications allowed';
  END IF;
  IF v_booking_customer IS DISTINCT FROM v_referring_cust THEN
    RAISE EXCEPTION 'redeem_referral_voucher: voucher belongs to a different customer than this booking';
  END IF;

  v_value := COALESCE(v_catalog_value, v_requested);
  IF v_value IS NULL OR v_value <= 0 THEN
    RAISE EXCEPTION 'redeem_referral_voucher: voucher has no redeemable value';
  END IF;

  INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
  VALUES (p_booking_id, v_value, 'ReferralVoucher', v_actor, NULL)
  RETURNING id INTO v_payment_id;

  UPDATE public.customer_referrals
     SET redeemed_at         = now(),
         redeemed_booking_id = p_booking_id,
         redeemed_by         = v_actor
   WHERE id = p_referral_id;

  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_referral_voucher(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_referral_voucher(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.redeem_referral_voucher(uuid, uuid) TO authenticated;

-- ============================================================
-- 6. Record migration
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('071', 'referral-reward-redemption')
ON CONFLICT (version) DO NOTHING;
