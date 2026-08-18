-- Migration 046: membership-payment-mode (RECONSTRUCTED — not the original applied SQL)
--
-- ⚠️ PROVENANCE: Applied directly to production via the Supabase dashboard SQL editor,
-- never committed. No literal record of the original statements survives (not in this
-- repo, not in supabase_migrations.schema_migrations, which only covers June 2026
-- onward). Reconstructed on 2026-08-13 by Deployment Operator from the live schema
-- dump (supabase/baseline/schema.sql) to document net effect and bring a from-scratch
-- database to parity. Best-effort, NOT a byte-identical replay.
--
-- Net effect modeled here: membership_transactions gains a payment_mode column so a
-- deposit's payment method is recorded on the ledger (previously only booking
-- payments in public.payments tracked payment_mode). record_membership_transaction is
-- replaced with a version that actually persists it.
--
-- ⚠️ NAME COLLISION WITH 060: prod's ledger has TWO migrations named
-- "membership-payment-mode" — 046 and 060. Per the task brief these are different,
-- later-reused-name changes. Best-effort split, inferred from schema evidence:
--   - 046 (this file): membership_transactions.payment_mode is ADDED, with a fixed
--     enum-style CHECK matching the hardcoded list in enroll_member() (see 045):
--     'Cash','Card','MobileBanking','Cheque','Esewa','Khalti'.
--   - 060: renew_membership() (introduced in 059 without a payment_mode parameter)
--     is given a p_payment_mode parameter so renewal deposits also carry a mode —
--     i.e. 060 is "payment_mode reaches the renewal flow", not "payment_mode is
--     added to the schema" (that already happened here in 046).
-- This is a judgment call — the live ledger only has the reused name to go on, not
-- the SQL that ran, so the split above is inferred from what actually changed shape
-- between 045/059/061's evidence, not observed directly.
--
-- The final live CHECK constraint on membership_transactions.payment_mode
-- (membership_transactions_payment_mode_check) is actually a generic length/trim
-- check, not this enum — that's because migration-055 later renamed AND redefined
-- it (see 055's header for that reasoning). This file intentionally recreates the
-- enum-shaped constraint 046 would have originally added; 055 supersedes it.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS, guarded CHECK add, CREATE OR REPLACE).

-- 1. Add the column ------------------------------------------------------------
ALTER TABLE public.membership_transactions
  ADD COLUMN IF NOT EXISTS payment_mode text;

-- 2. Constrain it to the same fixed set enroll_member() already validates in-app.
-- Postgres has no "ADD CONSTRAINT IF NOT EXISTS", so guard with a catalog check.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'membership_transactions_payment_mode_check'
  ) THEN
    ALTER TABLE public.membership_transactions
      ADD CONSTRAINT membership_transactions_payment_mode_check
      CHECK (payment_mode IS NULL OR payment_mode IN ('Cash','Card','MobileBanking','Cheque','Esewa','Khalti'));
  END IF;
END $$;

-- 3. record_membership_transaction(): now actually persists payment_mode on the
--    ledger row (045's version accepted the parameter but silently dropped it).
CREATE OR REPLACE FUNCTION public.record_membership_transaction(p_membership_id uuid, p_kind text, p_amount numeric, p_payment_mode text DEFAULT NULL::text, p_booking_id uuid DEFAULT NULL::uuid, p_payment_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_role         user_role := get_user_role();
  v_caller_org   uuid      := get_user_org_id();
  v_mem_org      uuid;
  v_balance      numeric(12,2);
  v_activation   date;
  v_expiry       date;
  v_perk_used    timestamptz;
  v_txn_id       uuid;
BEGIN
  IF p_kind NOT IN ('deposit','deduction','birthday_perk','adjustment') THEN
    RAISE EXCEPTION 'record_membership_transaction: invalid kind %', p_kind;
  END IF;

  SELECT org_id, balance, activation_date, expiry_date, birthday_perk_used_at
    INTO v_mem_org, v_balance, v_activation, v_expiry, v_perk_used
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF v_mem_org IS NULL THEN
    RAISE EXCEPTION 'record_membership_transaction: membership % not found', p_membership_id;
  END IF;

  IF v_mem_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_membership_transaction: membership is not in your organization';
  END IF;

  IF p_kind IN ('deposit','deduction','birthday_perk') THEN
    IF v_role NOT IN ('manager','admin') THEN
      RAISE EXCEPTION 'record_membership_transaction: manager or admin role required';
    END IF;
  ELSIF p_kind = 'adjustment' THEN
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'record_membership_transaction: adjustments are admin-only';
    END IF;
    IF p_notes IS NULL OR length(btrim(p_notes)) = 0 THEN
      RAISE EXCEPTION 'record_membership_transaction: adjustment requires a note';
    END IF;
  END IF;

  IF p_kind = 'deposit' AND p_amount <= 0 THEN
    RAISE EXCEPTION 'record_membership_transaction: deposit amount must be positive';
  END IF;

  IF p_kind = 'deduction' THEN
    IF p_amount >= 0 THEN
      RAISE EXCEPTION 'record_membership_transaction: deduction amount must be negative';
    END IF;
    IF abs(p_amount) > v_balance THEN
      RAISE EXCEPTION 'record_membership_transaction: insufficient balance (have %, need %)',
        v_balance, abs(p_amount);
    END IF;
  END IF;

  IF p_kind = 'birthday_perk' THEN
    IF p_amount <> 0 THEN
      RAISE EXCEPTION 'record_membership_transaction: birthday_perk amount must be 0';
    END IF;
    IF v_activation IS NULL THEN
      RAISE EXCEPTION 'record_membership_transaction: birthday perk requires an active membership';
    END IF;
    IF v_perk_used IS NOT NULL
       AND v_perk_used::date >= v_activation
       AND v_perk_used::date <= COALESCE(v_expiry, v_activation) THEN
      RAISE EXCEPTION 'record_membership_transaction: birthday perk already used in current cycle';
    END IF;
  END IF;

  INSERT INTO public.membership_transactions
    (membership_id, org_id, kind, amount, payment_mode, booking_id, payment_id, performed_by, notes)
  VALUES
    (p_membership_id, v_mem_org, p_kind, p_amount, p_payment_mode, p_booking_id, p_payment_id, auth.uid(), p_notes)
  RETURNING id INTO v_txn_id;

  IF p_kind = 'birthday_perk' THEN
    UPDATE public.memberships
       SET birthday_perk_used_at = now()
     WHERE id = p_membership_id;
  END IF;

  RETURN v_txn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_membership_transaction(uuid, text, numeric, text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_membership_transaction(uuid, text, numeric, text, uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_membership_transaction(uuid, text, numeric, text, uuid, uuid, text) TO authenticated;

-- 4. Record migration ------------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('046', 'membership-payment-mode')
ON CONFLICT (version) DO NOTHING;
