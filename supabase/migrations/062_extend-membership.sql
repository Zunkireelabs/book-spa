-- Migration 062: extend-membership (RECONSTRUCTED — not the original applied SQL)
--
-- ⚠️ PROVENANCE: Applied directly to production via the Supabase dashboard SQL editor,
-- never committed. No literal record survives (not in this repo, not in
-- supabase_migrations.schema_migrations, which only covers June 2026 onward).
-- Reconstructed on 2026-08-13 by Deployment Operator from the live schema dump
-- (supabase/baseline/schema.sql) to document net effect and bring a from-scratch
-- database to parity. Best-effort, NOT a byte-identical replay.
--
-- Net effect modeled here: extend_membership() — a manager/admin-only RPC that
-- reactivates a LAPSED membership (expiry_date in the past) that still has a
-- positive balance, by pushing its expiry_date out to a new caller-supplied date.
-- Unlike renew_membership, no new deposit is taken and no balance is touched or
-- forfeited — this is purely a validity extension for a membership whose money
-- hasn't run out yet, just its clock has. A zero-amount 'extension' transaction
-- kind (already covered by membership_transactions_kind_check /
-- membership_transactions_amount_sign, both from migration-045) is written so the
-- reactivation shows up in the membership's transaction history.
--
-- High confidence: body copied verbatim from schema.sql lines ~1459-1518.
--
-- Idempotent (CREATE OR REPLACE FUNCTION).

CREATE OR REPLACE FUNCTION public.extend_membership(p_membership_id uuid, p_new_expiry_date date, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_role        user_role := get_user_role();
  v_caller_org  uuid      := get_user_org_id();
  v_mem_org     uuid;
  v_balance     numeric(12,2);
  v_expiry      date;
  v_today       date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_txn_id      uuid;
BEGIN
  IF v_role NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'extend_membership: manager or admin role required';
  END IF;

  IF p_new_expiry_date IS NULL OR p_new_expiry_date <= v_today THEN
    RAISE EXCEPTION 'extend_membership: new expiry date must be after today';
  END IF;

  -- Lock the membership row + load current state.
  SELECT org_id, balance, expiry_date
    INTO v_mem_org, v_balance, v_expiry
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF v_mem_org IS NULL THEN
    RAISE EXCEPTION 'extend_membership: membership % not found', p_membership_id;
  END IF;

  IF v_mem_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'extend_membership: membership is not in your organization';
  END IF;

  IF v_balance <= 0 THEN
    RAISE EXCEPTION 'extend_membership: membership has no remaining balance -- use renew instead';
  END IF;

  IF v_expiry IS NULL OR v_expiry >= v_today THEN
    RAISE EXCEPTION 'extend_membership: membership is not lapsed';
  END IF;

  -- Extend validity only -- balance, total_deposited, and tier_id are untouched.
  UPDATE public.memberships
     SET expiry_date = p_new_expiry_date
   WHERE id = p_membership_id;

  -- Zero-amount audit row so the reactivation shows up in transaction history.
  INSERT INTO public.membership_transactions
    (membership_id, org_id, kind, amount, performed_by, notes)
  VALUES
    (p_membership_id, v_mem_org, 'extension', 0, auth.uid(),
     COALESCE(p_notes, 'Membership reactivated -- validity extended to ' || p_new_expiry_date || ', balance preserved.'))
  RETURNING id INTO v_txn_id;

  RETURN v_txn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.extend_membership(uuid, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.extend_membership(uuid, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.extend_membership(uuid, date, text) TO authenticated;

-- extend_membership introduces the 'extension' kind to membership_transactions.
-- membership-045's kind_check / amount_sign constraints already allow it in the
-- live schema (they were reconstructed there with 'extension' included, since
-- Postgres CHECK constraints can't be widened piecemeal without a full
-- drop+recreate and 045 is this repo's single source of truth for that table's
-- shape) — no ALTER TABLE is needed here. Flagged for visibility: if 045 is ever
-- revised to exclude 'extension', this migration would need a guarded
-- DROP CONSTRAINT / ADD CONSTRAINT to re-add it.

-- Record migration ------------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('062', 'extend-membership')
ON CONFLICT (version) DO NOTHING;
