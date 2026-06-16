-- Migration 046: Membership as a payment mode at booking checkout
--                 (Phase 3 — additive, REVERSIBLE)
--
-- Enables the prepaid wallet from migration-045 to actually PAY for services.
-- Two changes:
--
--   1. Extend payments.payment_mode CHECK to accept 'Membership'.
--   2. Add SECURITY DEFINER fn record_membership_payment(p_booking_id, p_amount,
--      p_notes) that atomically:
--         INSERTs a payments row (payment_mode='Membership')
--         INSERTs a membership_transactions row (kind='deduction', linked by
--           booking_id + the just-created payment_id)
--      so the wallet balance and the booking's payment_status can never drift.
--      The membership_recompute trigger from migration-045 then recomputes the
--      parent membership's balance/total_deposited just like for a top-up.
--
-- Unlike record_membership_transaction(), this fn is callable by ANY signed-in
-- staff (not just manager/admin) because taking a wallet payment is part of the
-- normal checkout flow. Authorization is via same-org check on the booking.
--
-- Idempotent (CREATE OR REPLACE, guarded ALTER) and portable (no UUIDs).
--
-- Reversible:
--   DROP FUNCTION IF EXISTS public.record_membership_payment(uuid, numeric, text);
--   ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_mode_check;
--   ALTER TABLE public.payments ADD CONSTRAINT payments_payment_mode_check
--     CHECK (payment_mode IN ('Cash','Card','MobileBanking','Cheque','Esewa','Khalti'));

-- ============================================================
-- 1. Extend payment_mode CHECK to allow 'Membership'
-- ============================================================

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_mode_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_payment_mode_check
  CHECK (payment_mode IN ('Cash','Card','MobileBanking','Cheque','Esewa','Khalti','Membership'));

-- ============================================================
-- 2. record_membership_payment — atomic payment + wallet deduction
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_membership_payment(
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
  v_membership_id uuid;
  v_balance       numeric(12,2);
  v_payment_id    uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'record_membership_payment: must be signed in';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'record_membership_payment: amount must be positive';
  END IF;

  -- Resolve the booking → customer → org. Walk-ins (NULL customer_id) cannot
  -- use a wallet because there's nothing to bill against.
  SELECT b.customer_id, br.org_id
    INTO v_customer_id, v_booking_org
  FROM public.bookings b
  JOIN public.branches br ON br.id = b.branch_id
  WHERE b.id = p_booking_id;

  IF v_booking_org IS NULL THEN
    RAISE EXCEPTION 'record_membership_payment: booking % not found', p_booking_id;
  END IF;

  IF v_booking_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_membership_payment: booking is not in your organization';
  END IF;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'record_membership_payment: booking has no linked customer (walk-in cannot use a wallet)';
  END IF;

  -- Find the most recent membership for this customer in the org and lock it.
  -- (One non-depleted membership per customer is enforced by the partial unique
  -- index in migration-045, so this is unambiguous in practice.)
  SELECT id, balance
    INTO v_membership_id, v_balance
  FROM public.memberships
  WHERE org_id = v_caller_org AND customer_id = v_customer_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_membership_id IS NULL THEN
    RAISE EXCEPTION 'record_membership_payment: customer has no membership';
  END IF;

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'record_membership_payment: insufficient wallet balance (have %, need %)',
      v_balance, p_amount;
  END IF;

  -- Atomic pair: payments INSERT first so we can link the deduction back to it.
  INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
  VALUES (p_booking_id, p_amount, 'Membership', v_actor, p_notes)
  RETURNING id INTO v_payment_id;

  INSERT INTO public.membership_transactions
    (membership_id, org_id, kind, amount, payment_mode, booking_id, payment_id, performed_by, notes)
  VALUES
    (v_membership_id, v_caller_org, 'deduction', -p_amount, NULL, p_booking_id, v_payment_id, v_actor,
     COALESCE(p_notes, 'Booking checkout'));

  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_membership_payment(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_membership_payment(uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_membership_payment(uuid, numeric, text) TO authenticated;

-- ============================================================
-- 3. Record migration
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('046', 'membership-payment-mode')
ON CONFLICT (version) DO NOTHING;
