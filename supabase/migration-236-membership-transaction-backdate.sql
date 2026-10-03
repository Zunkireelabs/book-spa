-- Migration 236: admin-only backdating for membership wallet top-up/deduction/adjustment.
--
-- Idempotent: CREATE OR REPLACE FUNCTION on a brand-new function name (no prior
-- signature to collide with), CREATE INDEX IF NOT EXISTS style N/A here (no new
-- columns/indexes), ON CONFLICT DO NOTHING on the self-record insert.
-- Additive, reversible (manual):
--   DROP FUNCTION IF EXISTS public.record_membership_transaction_backdated(uuid, text, numeric, text, text, uuid, date);
-- Portable: no hardcoded UUIDs.
--
--
-- Why this exists
--
-- migration-234 added admin-only backdating for a membership's *initial*
-- enrollment deposit (enroll_member(..., p_activation_date)). Every later
-- top-up (deposit), deduction, or admin adjustment on an already-active
-- membership still always stamps created_at = now() via
-- record_membership_transaction (migration-156) — there's no way to record,
-- say, a cash top-up that actually happened last week.
--
--
-- Why a new function instead of adding a param to record_membership_transaction
--
-- record_membership_transaction is shared by topUpMembership, deductMembership
-- /adjustMembership, and renew_membership (5+ call sites), none of which need
-- backdating. Following the same reasoning migration-234's header gives for not
-- teaching the shared trigger about backdating: a dedicated RPC keeps the
-- backdating-specific role gate (admin only, no manager path — unlike the
-- shared function's manager-or-admin deposit/deduction path) and the explicit
-- created_at override isolated to the one call site that needs them, with zero
-- risk to the 5 existing non-backdated callers.
--
--
-- Why birthday_perk is excluded
--
-- A birthday perk is a system-granted, cycle-gated freebie tied to "today" by
-- definition (membership_recompute's birthday_perk_used_at cycle check uses
-- v_activation/v_expiry, not a caller-supplied date) — backdating when it was
-- "granted" doesn't correspond to any real-world event worth correcting.
--
--
-- Why checks are duplicated here instead of calling record_membership_transaction
--
-- This RPC needs its own, stricter role gate (admin only, every kind — the
-- shared function allows manager for deposit/deduction) and must set an
-- explicit created_at on the INSERT, which the shared function's INSERT list
-- doesn't expose a parameter for. Duplicating the per-kind sign/business-rule
-- checks keeps this function fully self-contained and auditable on its own,
-- same posture as migration-232/233's admin-correction RPCs.
--
--
-- Why "not yet active" is rejected
--
-- A membership only gets activation_date/expiry_date once trg_membership_recompute
-- sees total_deposited cross the tier's advance_amount threshold (migration-045).
-- Before that, there's no "wallet" an admin should be backdating transactions
-- against in this flow — that first deposit is enroll_member's initial deposit,
-- already backdatable via migration-234's p_activation_date. Rejecting here with
-- a pointer to that path avoids a confusing silent no-op.
--
--
-- Why created_at is stamped via Nepal-wall-clock conversion
--
-- Same bug class migration-234 fixed: casting a bare date straight to
-- timestamptz (`p_backdated_at::timestamptz`) is interpreted in the session's
-- timezone (UTC here), 5:45h behind Nepal — an internal inconsistency even
-- though the UI only ever shows the date part. Explicit
-- `::timestamp AT TIME ZONE 'Asia/Kathmandu'` treats the naive timestamp as
-- Nepal wall-clock time and converts it to the correct UTC-backed timestamptz.
--
--
-- Why trg_membership_recompute is left untouched
--
-- The trigger (migration-045) only ever does SUM(amount) over all ledger rows
-- for the membership — order/date-independent — so inserting a row with a
-- backdated created_at is safe without touching the trigger. Its one
-- date-sensitive branch (v_already false → stamp activation_date/expiry_date
-- from "today") cannot fire here: this RPC requires v_activation IS NOT NULL
-- up front, which is exactly the v_already = true case the trigger takes
-- unconditionally (plain balance/total_deposited recompute, no activation
-- stamping).

BEGIN;

CREATE OR REPLACE FUNCTION public.record_membership_transaction_backdated(
  p_membership_id uuid,
  p_kind          text,
  p_amount        numeric,
  p_payment_mode  text DEFAULT NULL,
  p_notes         text DEFAULT NULL,
  p_branch_id     uuid DEFAULT NULL,
  -- Syntactically has a default (Postgres requires trailing params to all have
  -- one once any preceding param does) but is semantically required — the
  -- NULL check below is the real enforcement, not this default.
  p_backdated_at  date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role        user_role := get_user_role();
  v_caller_org  uuid      := get_user_org_id();
  v_mem_org     uuid;
  v_balance     numeric(12,2);
  v_activation  date;
  v_today       date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_backdated_ts timestamptz;
  v_txn_id      uuid;
BEGIN
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'record_membership_transaction_backdated: admin role required';
  END IF;

  IF p_kind NOT IN ('deposit','deduction','adjustment') THEN
    RAISE EXCEPTION 'record_membership_transaction_backdated: invalid kind %', p_kind;
  END IF;

  IF p_backdated_at IS NULL THEN
    RAISE EXCEPTION 'record_membership_transaction_backdated: backdated_at is required';
  END IF;

  IF p_backdated_at > v_today THEN
    RAISE EXCEPTION 'record_membership_transaction_backdated: date cannot be in the future';
  END IF;

  -- Lock the membership row + load current state.
  SELECT org_id, balance, activation_date
    INTO v_mem_org, v_balance, v_activation
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF v_mem_org IS NULL THEN
    RAISE EXCEPTION 'record_membership_transaction_backdated: membership % not found', p_membership_id;
  END IF;

  IF v_mem_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_membership_transaction_backdated: membership is not in your organization';
  END IF;

  IF v_activation IS NULL THEN
    RAISE EXCEPTION 'record_membership_transaction_backdated: membership is not yet active — use enroll_member backdating instead';
  END IF;

  -- Per-kind sign/business-rule checks (mirrors record_membership_transaction).
  IF p_kind = 'deposit' AND p_amount <= 0 THEN
    RAISE EXCEPTION 'record_membership_transaction_backdated: deposit amount must be positive';
  END IF;

  IF p_kind = 'deduction' THEN
    IF p_amount >= 0 THEN
      RAISE EXCEPTION 'record_membership_transaction_backdated: deduction amount must be negative';
    END IF;
    IF abs(p_amount) > v_balance THEN
      RAISE EXCEPTION 'record_membership_transaction_backdated: insufficient balance (have %, need %)',
        v_balance, abs(p_amount);
    END IF;
  END IF;

  IF p_kind = 'adjustment' THEN
    IF p_notes IS NULL OR length(btrim(p_notes)) = 0 THEN
      RAISE EXCEPTION 'record_membership_transaction_backdated: adjustment requires a note';
    END IF;
  END IF;

  v_backdated_ts := p_backdated_at::timestamp AT TIME ZONE 'Asia/Kathmandu';

  -- Append the ledger row with an explicit created_at. trg_membership_recompute
  -- (migration-045) fires normally — see header note on why that's safe.
  INSERT INTO public.membership_transactions
    (membership_id, org_id, kind, amount, payment_mode, performed_by, notes, branch_id, created_at)
  VALUES
    (p_membership_id, v_mem_org, p_kind, p_amount, p_payment_mode, auth.uid(), p_notes, p_branch_id, v_backdated_ts)
  RETURNING id INTO v_txn_id;

  RETURN v_txn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_membership_transaction_backdated(uuid, text, numeric, text, text, uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_membership_transaction_backdated(uuid, text, numeric, text, text, uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_membership_transaction_backdated(uuid, text, numeric, text, text, uuid, date) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('236', 'membership-transaction-backdate')
ON CONFLICT (version) DO NOTHING;

COMMIT;
