-- Migration 059: renew-membership (RECONSTRUCTED — not the original applied SQL)
--
-- ⚠️ PROVENANCE: Applied directly to production via the Supabase dashboard SQL editor,
-- never committed. No literal record survives (not in this repo, not in
-- supabase_migrations.schema_migrations, which only covers June 2026 onward).
-- Reconstructed on 2026-08-13 by Deployment Operator from the live schema dump
-- (supabase/baseline/schema.sql) to document net effect and bring a from-scratch
-- database to parity. Best-effort, NOT a byte-identical replay.
--
-- Net effect modeled here: the FIRST version of renew_membership() — lets
-- manager/admin start a fresh membership cycle (new activation/expiry, optional
-- tier change) with a new deposit, once the current cycle has expired.
--
-- JUDGMENT CALL (see also 060 and 061's headers): the live renew_membership() has
-- THREE features layered on top of "renew": (a) a p_payment_mode parameter, (b)
-- forfeiting any leftover balance from the expired cycle before the new deposit.
-- Migration-060 is separately named "membership-payment-mode" (reusing 046's name)
-- and migration-061 is separately named "renew-membership-forfeit-balance" — both
-- clearly distinct, LATER changes to this same function. Working backward, this
-- file (059, the plain "renew-membership") is reconstructed WITHOUT payment_mode
-- and WITHOUT forfeiture, since both of those are independently and more
-- specifically named later. This is the most internally-consistent split available
-- from the evidence, not a confirmed fact.
--
-- Idempotent (CREATE OR REPLACE). The final 4-positional-arg signature this file
-- defines is superseded by 060's 5-arg version; 060 drops this exact signature
-- before creating its own, so there's no ambiguous-overload risk if both run in
-- order on a from-scratch database.

CREATE OR REPLACE FUNCTION public.renew_membership(p_membership_id uuid, p_amount numeric, p_tier_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
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

  -- Record the deposit (trigger recomputes total_deposited/balance).
  v_txn_id := public.record_membership_transaction(
    p_membership_id, 'deposit', p_amount, NULL, NULL, NULL,
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

REVOKE ALL ON FUNCTION public.renew_membership(uuid, numeric, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_membership(uuid, numeric, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.renew_membership(uuid, numeric, uuid, text) TO authenticated;

-- Record migration ------------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('059', 'renew-membership')
ON CONFLICT (version) DO NOTHING;
