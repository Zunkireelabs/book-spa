-- Migration 060: membership-payment-mode (RECONSTRUCTED — not the original applied
-- SQL)
--
-- ⚠️ PROVENANCE: Applied directly to production via the Supabase dashboard SQL editor,
-- never committed. No literal record survives (not in this repo, not in
-- supabase_migrations.schema_migrations, which only covers June 2026 onward).
-- Reconstructed on 2026-08-13 by Deployment Operator from the live schema dump
-- (supabase/baseline/schema.sql) to document net effect and bring a from-scratch
-- database to parity. Best-effort, NOT a byte-identical replay.
--
-- ⚠️ NAME COLLISION WITH 046: prod's ledger has TWO migrations named
-- "membership-payment-mode". See 046's header for the full reasoning; short
-- version: 046 added the payment_mode COLUMN to membership_transactions. This one
-- (060), coming after 059's initial renew_membership() (which took no payment_mode
-- argument), is where renew_membership() is given a p_payment_mode parameter so a
-- renewal deposit's payment method is captured too — i.e. it's the same underlying
-- concept (payment_mode) reaching a second call site, not the schema-level add.
-- This is a judgment call inferred from the two functions' shapes in the final
-- schema, not a confirmed fact — the live ledger only preserves the reused name.
--
-- Idempotent (DROP FUNCTION IF EXISTS old signature to avoid ambiguous overloads,
-- then CREATE OR REPLACE the new one).

-- Drop 059's 4-arg signature so a 5-named-arg RPC call is never ambiguous.
DROP FUNCTION IF EXISTS public.renew_membership(uuid, numeric, uuid, text);

CREATE OR REPLACE FUNCTION public.renew_membership(p_membership_id uuid, p_amount numeric, p_payment_mode text, p_tier_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text) RETURNS uuid
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

  -- Record the deposit, now carrying payment_mode (trigger recomputes
  -- total_deposited/balance).
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

-- Record migration ------------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('060', 'membership-payment-mode')
ON CONFLICT (version) DO NOTHING;
