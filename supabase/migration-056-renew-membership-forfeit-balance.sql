-- Migration 056: renew_membership forfeits leftover balance (additive, REVERSIBLE)
--
-- Bug found during a wallet-balance audit: renew_membership (migration-054)
-- records the renewal deposit via record_membership_transaction but never
-- touches whatever balance is already on the row. renew_membership is only
-- reachable for a DEPLETED (balance = 0) or LAPSED (validity period passed,
-- balance can still be > 0) membership -- so a lapsed card with leftover
-- unspent wallet money got that old balance ADDED to the new renewal
-- deposit. Example: a card with 300000 left over from the expired cycle,
-- renewed for 100000, ends up showing 400000 as its "current" balance --
-- even though the RenewModal UI already tells the customer "this starts a
-- fresh cycle" and the sheet/business expectation is that the live balance
-- after a renewal is just the renewal amount.
--
-- Fix: renew_membership now writes off any nonzero pre-renewal balance as an
-- explicit 'adjustment' ledger row (not silently deleted -- stays visible in
-- transaction history) BEFORE recording the new deposit. This mirrors the
-- CARD DONE zero-out already applied by hand in
-- supabase/fix-membership-import-round2.sql, made universal + automatic for
-- every future renewal. The forfeiture is inserted directly (not via
-- record_membership_transaction, which requires the caller to be 'admin'
-- for adjustment-kind rows) since renew_membership already gates on
-- manager/admin itself.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
--
-- Reversible: re-run migration-054's CREATE OR REPLACE FUNCTION body (see
-- that file) to restore the old (purely additive) behavior.

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

INSERT INTO public.schema_migrations (version, name)
VALUES ('056', 'renew-membership-forfeit-balance')
ON CONFLICT (version) DO NOTHING;
