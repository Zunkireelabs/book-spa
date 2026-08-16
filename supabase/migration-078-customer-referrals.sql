-- Migration 078: customer referral reward program (additive, REVERSIBLE)
--
-- A "refer a friend" system distinct from the existing staff/therapist referral
-- commission feature (bookings.referred_by, migration-031/043, computeReferralCommission,
-- getReferralsReport, ReferralsReportPanel.jsx — that system is untouched by this migration).
--
-- Mechanics:
--   1. When staff create a booking for a genuinely NEW customer (no prior customers row),
--      they may log which EXISTING customer referred them. This creates a `customer_referrals`
--      row with reward_status = 'pending'. No money moves at this point.
--   2. When that specific booking later transitions to status = 'Completed', the referring
--      customer is credited a reward (amount = organizations.referral_reward_amount at that
--      moment) into the append-only `customer_referral_credits` ledger, and the referral row
--      flips to 'credited'.
--
-- Deliberately NOT built on the Membership Wallet (migration-045+): that system's tables are
-- not applied to production (MEMBERSHIP_ENABLED is off there, per src/lib/featureFlags.js) and
-- it models a paid/tiered product, not a system-granted credit. This reward must work for any
-- existing customer, independent of membership enrollment or the membership rollout timeline.
--
-- Writes to both new tables go through SECURITY DEFINER functions only — no direct
-- INSERT/UPDATE/DELETE policies. Mirrors the membership_transactions / staff_transfers pattern.
--
-- Idempotent: CREATE ... IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY,
-- CREATE OR REPLACE FUNCTION, guarded ALTER TABLE ADD COLUMN.
-- Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.get_referral_credit_balance(uuid);
--   DROP FUNCTION IF EXISTS public.credit_pending_referral_for_booking(uuid);
--   DROP FUNCTION IF EXISTS public.record_customer_referral(uuid, uuid, uuid, text);
--   DROP TABLE IF EXISTS public.customer_referral_credits;
--   DROP TABLE IF EXISTS public.customer_referrals;
--   ALTER TABLE public.organizations DROP COLUMN IF EXISTS referral_reward_amount;

-- ============================================================
-- 1. ORGANIZATIONS: configurable reward amount
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS referral_reward_amount numeric(12,2) NOT NULL DEFAULT 500
    CHECK (referral_reward_amount >= 0);

-- ============================================================
-- 2. TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.customer_referrals (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  referring_customer_id  uuid        NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  referred_customer_id   uuid        NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  booking_id             uuid        NOT NULL REFERENCES public.bookings(id)  ON DELETE RESTRICT,
  reward_status          text        NOT NULL DEFAULT 'pending'
                                      CHECK (reward_status IN ('pending','credited','void')),
  reward_amount          numeric(12,2),
  credited_at            timestamptz,
  credited_by            uuid        REFERENCES public.users(id),
  created_by             uuid        REFERENCES public.users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  notes                  text,
  CONSTRAINT customer_referrals_no_self_referral CHECK (referring_customer_id <> referred_customer_id),
  CONSTRAINT customer_referrals_referred_customer_uniq UNIQUE (referred_customer_id),
  CONSTRAINT customer_referrals_booking_uniq UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_referrals_org
  ON public.customer_referrals(org_id);
CREATE INDEX IF NOT EXISTS idx_customer_referrals_referrer
  ON public.customer_referrals(org_id, referring_customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_referrals_pending
  ON public.customer_referrals(reward_status)
  WHERE reward_status = 'pending';

CREATE TABLE IF NOT EXISTS public.customer_referral_credits (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  referral_id  uuid        NOT NULL REFERENCES public.customer_referrals(id) ON DELETE RESTRICT,
  customer_id  uuid        NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  amount       numeric(12,2) NOT NULL CHECK (amount > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_referral_credits_referral_uniq UNIQUE (referral_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_referral_credits_customer
  ON public.customer_referral_credits(org_id, customer_id);

-- ============================================================
-- 3. RLS
-- ============================================================

ALTER TABLE public.customer_referrals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_referral_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own org customer referrals" ON public.customer_referrals;
CREATE POLICY "Users can read own org customer referrals"
  ON public.customer_referrals FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

-- NO direct INSERT/UPDATE/DELETE policy — writes go through record_customer_referral()
-- and credit_pending_referral_for_booking() (SECURITY DEFINER, defined below).

DROP POLICY IF EXISTS "Users can read own org customer referral credits" ON public.customer_referral_credits;
CREATE POLICY "Users can read own org customer referral credits"
  ON public.customer_referral_credits FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

-- NO INSERT/UPDATE/DELETE policy — ledger is append-only via
-- credit_pending_referral_for_booking() (SECURITY DEFINER).

-- ============================================================
-- 4. SECURITY DEFINER WRITE FUNCTIONS
-- ============================================================

-- ---- record_customer_referral ----------------------------------------------
-- Logs that `p_referring_customer_id` referred `p_referred_customer_id`, whose
-- first booking is `p_booking_id`. Called right after that booking's customer
-- row is inserted as genuinely new — no money moves here. Any authenticated
-- staff member in the org may log a referral (same posture as entering
-- customer_name/phone on a booking); this is not a financial action by itself.

CREATE OR REPLACE FUNCTION public.record_customer_referral(
  p_referring_customer_id uuid,
  p_referred_customer_id  uuid,
  p_booking_id            uuid,
  p_notes                 text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_org   uuid := get_user_org_id();
  v_referrer_org uuid;
  v_referred_org uuid;
  v_booking_customer uuid;
  v_booking_branch   uuid;
  v_booking_org      uuid;
  v_referral_id  uuid;
BEGIN
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'record_customer_referral: caller has no organization';
  END IF;

  IF p_referring_customer_id = p_referred_customer_id THEN
    RAISE EXCEPTION 'record_customer_referral: a customer cannot refer themselves';
  END IF;

  SELECT org_id INTO v_referrer_org FROM public.customers WHERE id = p_referring_customer_id;
  SELECT org_id INTO v_referred_org FROM public.customers WHERE id = p_referred_customer_id;

  IF v_referrer_org IS NULL THEN
    RAISE EXCEPTION 'record_customer_referral: referring customer % not found', p_referring_customer_id;
  END IF;
  IF v_referred_org IS NULL THEN
    RAISE EXCEPTION 'record_customer_referral: referred customer % not found', p_referred_customer_id;
  END IF;
  IF v_referrer_org IS DISTINCT FROM v_caller_org OR v_referred_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_customer_referral: customers must be in your organization';
  END IF;

  SELECT b.customer_id, b.branch_id, br.org_id
    INTO v_booking_customer, v_booking_branch, v_booking_org
  FROM public.bookings b
  JOIN public.branches br ON br.id = b.branch_id
  WHERE b.id = p_booking_id;

  IF v_booking_org IS NULL THEN
    RAISE EXCEPTION 'record_customer_referral: booking % not found', p_booking_id;
  END IF;
  IF v_booking_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_customer_referral: booking is not in your organization';
  END IF;
  IF v_booking_customer IS DISTINCT FROM p_referred_customer_id THEN
    RAISE EXCEPTION 'record_customer_referral: booking does not belong to the referred customer';
  END IF;

  IF EXISTS (SELECT 1 FROM public.customer_referrals WHERE referred_customer_id = p_referred_customer_id) THEN
    RAISE EXCEPTION 'record_customer_referral: this customer has already been referred once';
  END IF;

  INSERT INTO public.customer_referrals
    (org_id, referring_customer_id, referred_customer_id, booking_id, created_by, notes)
  VALUES
    (v_caller_org, p_referring_customer_id, p_referred_customer_id, p_booking_id, auth.uid(), p_notes)
  RETURNING id INTO v_referral_id;

  RETURN v_referral_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_customer_referral(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_customer_referral(uuid, uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_customer_referral(uuid, uuid, uuid, text) TO authenticated;

-- ---- credit_pending_referral_for_booking ------------------------------------
-- Called right after a booking successfully transitions to status = 'Completed'.
-- No-ops (returns NULL) if the booking has no referral attached, or the referral
-- is not 'pending' — this is both the normal case (most bookings have no
-- referral) and the idempotency guard against double-crediting. The
-- UNIQUE(referral_id) constraint on customer_referral_credits is the hard
-- DB-level backstop underneath this application-level check.

CREATE OR REPLACE FUNCTION public.credit_pending_referral_for_booking(
  p_booking_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_referral_id   uuid;
  v_org_id        uuid;
  v_referrer      uuid;
  v_status        text;
  v_booking_status booking_status;
  v_amount        numeric(12,2);
  v_credit_id     uuid;
BEGIN
  SELECT id, org_id, referring_customer_id, reward_status
    INTO v_referral_id, v_org_id, v_referrer, v_status
  FROM public.customer_referrals
  WHERE booking_id = p_booking_id
  FOR UPDATE;

  IF v_referral_id IS NULL THEN
    RETURN NULL; -- no referral attached to this booking; normal case
  END IF;

  IF v_status <> 'pending' THEN
    RETURN NULL; -- already credited or voided; idempotent no-op
  END IF;

  SELECT status INTO v_booking_status FROM public.bookings WHERE id = p_booking_id;
  IF v_booking_status IS DISTINCT FROM 'Completed' THEN
    RAISE EXCEPTION 'credit_pending_referral_for_booking: booking % is not Completed', p_booking_id;
  END IF;

  SELECT referral_reward_amount INTO v_amount FROM public.organizations WHERE id = v_org_id;

  IF v_amount IS NULL OR v_amount = 0 THEN
    UPDATE public.customer_referrals
       SET reward_status = 'credited',
           reward_amount = 0,
           credited_at   = now(),
           credited_by   = auth.uid()
     WHERE id = v_referral_id;
    RETURN NULL; -- confirmed, but no reward configured — nothing to ledger
  END IF;

  INSERT INTO public.customer_referral_credits (org_id, referral_id, customer_id, amount)
  VALUES (v_org_id, v_referral_id, v_referrer, v_amount)
  RETURNING id INTO v_credit_id;

  UPDATE public.customer_referrals
     SET reward_status = 'credited',
         reward_amount = v_amount,
         credited_at   = now(),
         credited_by   = auth.uid()
   WHERE id = v_referral_id;

  RETURN v_credit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_pending_referral_for_booking(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.credit_pending_referral_for_booking(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.credit_pending_referral_for_booking(uuid) TO authenticated;

-- ---- get_referral_credit_balance --------------------------------------------
-- Sum of a customer's credited referral rewards. Used by the reporting panel.

CREATE OR REPLACE FUNCTION public.get_referral_credit_balance(
  p_customer_id uuid
)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(SUM(amount), 0)
  FROM public.customer_referral_credits
  WHERE customer_id = p_customer_id
    AND org_id = get_user_org_id();
$$;

REVOKE ALL ON FUNCTION public.get_referral_credit_balance(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_referral_credit_balance(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_referral_credit_balance(uuid) TO authenticated;

-- ============================================================
-- 5. RECORD MIGRATION
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('078', 'customer-referrals')
ON CONFLICT (version) DO NOTHING;
