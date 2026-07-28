-- Migration 057: extend_membership for Lapsed reactivation (additive, REVERSIBLE)
--
-- Problem: a LAPSED membership (expiry_date has passed but balance is still > 0)
-- was only reachable through renew_membership (migration-054, hardened by
-- migration-056 to forfeit any leftover balance). That's wrong for this case --
-- the customer already has unused money sitting on the card; they don't need a
-- new deposit, they just need the validity window pushed out so the existing
-- balance becomes spendable again. Depleted (balance = 0) memberships still
-- correctly go through renew_membership -- this migration does not touch that
-- path.
--
-- extend_membership(p_membership_id, p_new_expiry_date, p_notes): manager/admin
-- only, same locking pattern as renew_membership. Only callable while the
-- membership is actually lapsed (balance > 0 AND expiry_date in the past) --
-- active, pending, and depleted memberships must keep using their existing
-- top-up/renew paths. Moves expiry_date to p_new_expiry_date (must be a future
-- date); does NOT touch balance, total_deposited, or tier_id. Appends a
-- zero-amount 'extension' ledger row so the reactivation is visible in
-- transaction history, mirroring the existing zero-amount 'birthday_perk' kind.
--
-- Idempotent: guarded ALTER TABLE DROP/ADD CONSTRAINT, CREATE OR REPLACE FUNCTION.
-- Portable: no hardcoded UUIDs.
--
-- Reversible:
--   DROP FUNCTION IF EXISTS public.extend_membership(uuid, date, text);
--   ALTER TABLE public.membership_transactions DROP CONSTRAINT IF EXISTS membership_transactions_kind_check;
--   ALTER TABLE public.membership_transactions ADD CONSTRAINT membership_transactions_kind_check
--     CHECK (kind IN ('deposit','deduction','birthday_perk','adjustment'));
--   ALTER TABLE public.membership_transactions DROP CONSTRAINT IF EXISTS membership_transactions_amount_sign;
--   ALTER TABLE public.membership_transactions ADD CONSTRAINT membership_transactions_amount_sign CHECK (
--     (kind = 'deposit'       AND amount > 0)
--     OR (kind = 'deduction'  AND amount < 0)
--     OR (kind = 'adjustment' AND amount <> 0)
--     OR (kind = 'birthday_perk' AND amount = 0)
--   );

ALTER TABLE public.membership_transactions DROP CONSTRAINT IF EXISTS membership_transactions_kind_check;
ALTER TABLE public.membership_transactions ADD CONSTRAINT membership_transactions_kind_check
  CHECK (kind IN ('deposit','deduction','birthday_perk','adjustment','extension'));

ALTER TABLE public.membership_transactions DROP CONSTRAINT IF EXISTS membership_transactions_amount_sign;
ALTER TABLE public.membership_transactions ADD CONSTRAINT membership_transactions_amount_sign CHECK (
  (kind = 'deposit'       AND amount > 0)
  OR (kind = 'deduction'  AND amount < 0)
  OR (kind = 'adjustment' AND amount <> 0)
  OR (kind = 'birthday_perk' AND amount = 0)
  OR (kind = 'extension'  AND amount = 0)
);

CREATE OR REPLACE FUNCTION public.extend_membership(
  p_membership_id   uuid,
  p_new_expiry_date date,
  p_notes           text DEFAULT NULL
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

INSERT INTO public.schema_migrations (version, name)
VALUES ('057', 'extend-membership')
ON CONFLICT (version) DO NOTHING;
