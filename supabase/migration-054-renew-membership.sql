-- Migration 054: renew_membership (additive, REVERSIBLE)
--
-- Adds a dedicated "Renew" path for a DEPLETED (balance = 0) or LAPSED
-- (validity period passed) membership, distinct from a plain top-up.
--
-- Problem: record_membership_transaction (migration-045) only recomputes
-- total_deposited/balance -- the membership_recompute trigger sets
-- activation_date/expiry_date ONLY the first time a membership crosses its
-- tier threshold (v_already short-circuits once activation_date is already
-- set). So topping up a depleted/lapsed membership silently adds money but
-- leaves the old, already-expired validity window in place, and there's no
-- way to change tier at the same time. This mirrors the manual patch applied
-- to historical rows in supabase/fix-membership-import-round2.sql (INSERT
-- deposit, then UPDATE activation_date/expiry_date), but as a reusable path
-- for real renewals going forward.
--
-- renew_membership(p_membership_id, p_amount, p_payment_mode, p_tier_id,
-- p_notes): same manager/admin-only, SECURITY DEFINER pattern as
-- record_membership_transaction/enroll_member. Optionally moves the
-- membership to a new tier, records the deposit via
-- record_membership_transaction (reusing its balance/total_deposited
-- recompute), then resets activation_date to today (Asia/Kathmandu) and
-- expiry_date to activation_date + validity_days -- starting a fresh cycle
-- on the SAME membership row (so history/reporting stays continuous, unlike
-- creating a second enrollment).
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- Portable: no UUIDs.
--
-- Reversible:
--   DROP FUNCTION IF EXISTS public.renew_membership(uuid, numeric, text, uuid, text);

CREATE OR REPLACE FUNCTION public.renew_membership(
  p_membership_id uuid,
  p_amount        numeric,
  p_payment_mode  text,
  p_tier_id       uuid DEFAULT NULL,
  p_notes         text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role         user_role := get_user_role();
  v_caller_org   uuid      := get_user_org_id();
  v_mem_org      uuid;
  v_current_tier uuid;
  v_final_tier   uuid;
  v_tier_org     uuid;
  v_validity     int;
  v_activation   date;
  v_txn_id       uuid;
BEGIN
  IF v_role NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'renew_membership: manager or admin role required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'renew_membership: amount must be positive';
  END IF;

  -- Lock the membership row + load current state.
  SELECT org_id, tier_id
    INTO v_mem_org, v_current_tier
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF v_mem_org IS NULL THEN
    RAISE EXCEPTION 'renew_membership: membership % not found', p_membership_id;
  END IF;

  IF v_mem_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'renew_membership: membership is not in your organization';
  END IF;

  -- Optional tier change.
  v_final_tier := COALESCE(p_tier_id, v_current_tier);
  IF p_tier_id IS NOT NULL AND p_tier_id IS DISTINCT FROM v_current_tier THEN
    SELECT org_id INTO v_tier_org FROM public.membership_tiers WHERE id = p_tier_id;
    IF v_tier_org IS NULL THEN
      RAISE EXCEPTION 'renew_membership: tier % not found', p_tier_id;
    END IF;
    IF v_tier_org IS DISTINCT FROM v_caller_org THEN
      RAISE EXCEPTION 'renew_membership: tier must be in your organization';
    END IF;
    UPDATE public.memberships SET tier_id = p_tier_id WHERE id = p_membership_id;
  END IF;

  SELECT validity_days INTO v_validity FROM public.membership_tiers WHERE id = v_final_tier;

  -- Record the deposit (trigger recomputes total_deposited/balance; won't
  -- touch activation_date/expiry_date since they're already set).
  v_txn_id := public.record_membership_transaction(
    p_membership_id, 'deposit', p_amount, p_payment_mode, NULL, NULL,
    COALESCE(p_notes, 'Renewal deposit')
  );

  -- Start a fresh cycle on this same row.
  v_activation := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  UPDATE public.memberships
     SET activation_date = v_activation,
         expiry_date     = v_activation + (v_validity || ' days')::interval
   WHERE id = p_membership_id;

  RETURN v_txn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.renew_membership(uuid, numeric, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_membership(uuid, numeric, text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.renew_membership(uuid, numeric, text, uuid, text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('054', 'renew-membership')
ON CONFLICT (version) DO NOTHING;
