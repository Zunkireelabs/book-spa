-- Migration 061: renew-membership-forfeit-balance (RECONSTRUCTED — not the original
-- applied SQL)
--
-- ⚠️ PROVENANCE: Applied directly to production via the Supabase dashboard SQL editor,
-- never committed. No literal record survives (not in this repo, not in
-- supabase_migrations.schema_migrations, which only covers June 2026 onward).
-- Reconstructed on 2026-08-13 by Deployment Operator from the live schema dump
-- (supabase/baseline/schema.sql) to document net effect and bring a from-scratch
-- database to parity. Best-effort, NOT a byte-identical replay.
--
-- Net effect modeled here: renew_membership() (built up through 059 and 060) is
-- replaced with the version matching the final live schema exactly — it now writes
-- off ("forfeits") any balance still left over from the just-expired cycle as a
-- zero-sum audit adjustment row BEFORE recording the new deposit, so unspent money
-- from an old cycle doesn't silently roll into the new one, but is still visible
-- in transaction history rather than dropped.
--
-- This is the highest-confidence of the renew_membership trio (059/060/061) since
-- its body is copied verbatim from schema.sql lines ~2013-2094 — the live function
-- IS this version.
--
-- Idempotent (CREATE OR REPLACE — same signature as 060, no DROP FUNCTION needed).

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
  v_balance      numeric(12,2);
  v_txn_id       uuid;
BEGIN
  IF v_role NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'renew_membership: manager or admin role required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'renew_membership: amount must be positive';
  END IF;

  -- Lock the membership row + load current state.
  SELECT org_id, tier_id, balance
    INTO v_mem_org, v_current_tier, v_balance
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

  -- Forfeit any balance left over from the expired cycle -- renewal starts a
  -- fresh cycle, so old unspent money is written off (visible in history as
  -- an adjustment row, not dropped).
  IF v_balance <> 0 THEN
    INSERT INTO public.membership_transactions
      (membership_id, org_id, kind, amount, performed_by, notes)
    VALUES
      (p_membership_id, v_mem_org, 'adjustment', -v_balance, auth.uid(),
       'Previous cycle balance forfeited on renewal.');
  END IF;

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

-- Record migration ------------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('061', 'renew-membership-forfeit-balance')
ON CONFLICT (version) DO NOTHING;
