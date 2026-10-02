-- Migration 234: admin-only backdating for membership enrollment.
--
-- Idempotent: CREATE OR REPLACE FUNCTION with a trailing DEFAULT param — the
-- existing 6-arg callers keep working unchanged, no DROP FUNCTION needed.
-- Additive, reversible (manual): re-run migration-156's
--   CREATE OR REPLACE FUNCTION public.enroll_member block to drop the param.
-- Portable: no hardcoded UUIDs.
--
--
-- Why this exists
--
-- Packages and vouchers already let an admin record a past issue date
-- (NewPackageModal.jsx / NewVoucherModal.jsx pass p_issued_date straight
-- through, guarded only by expiry_date >= issued_date). Membership enrollment
-- has no equivalent: enroll_member() takes no date parameter at all, and
-- activation_date/expiry_date are always stamped by the trg_membership_recompute
-- trigger (migration-045) as "today" the moment a deposit first crosses the
-- tier's advance_amount threshold. This migration closes that gap the same way
-- migration-232/233 did for bookings/vouchers/packages: an admin-only,
-- mandatory-recheck-inside-the-RPC correction, not a client-side-only date
-- picker.
--
--
-- Why the override happens after the INSERT instead of skipping the trigger
--
-- trg_membership_recompute is shared by topUpMembership / renew_membership /
-- record_membership_transaction as well as enroll_member. Teaching it about
-- p_activation_date would mean plumbing a transaction-local flag through every
-- one of those call sites for a feature only enrollment needs, for no benefit
-- -- the trigger's ordinary "activation_date = today" behavior is exactly
-- right for every one of them, including enroll_member on the non-backdated
-- path. So this lets the trigger run unchanged and then corrects its output
-- in place, scoped to enroll_member() alone.
--
--
-- Why "nothing to backdate" is an error, not a silent no-op
--
-- If the initial deposit does not meet the tier's advance_amount threshold,
-- the trigger leaves activation_date NULL (membership stays pending) — there
-- is no activation event yet to move to another date. Silently ignoring
-- p_activation_date in that case would let an admin believe a membership was
-- backdated when it was not; erroring is the same "explicit failure over a
-- misleading success" posture as admin_correct_package_sessions() etc. in
-- migration-233.
--
--
-- Why membership_transactions.created_at is also overridden
--
-- getCustomerMembershipTransactions / getMembershipTransactions (api.js)
-- bucket "Memberships Sold" dashboard rows by this column's date. Without the
-- override, a backdated enrollment would still show up as sold "today" --
-- the same gap packages/vouchers avoid by having issued_date as an explicit,
-- already-settable column instead of relying on created_at.
--
-- Both overrides stamp Nepal midnight, not UTC midnight: casting the date
-- straight to timestamptz (`p_activation_date::timestamptz`) is interpreted
-- in the session/server's timezone (effectively UTC here), which is 5:45h
-- behind v_today's own Asia/Kathmandu basis -- an internal inconsistency,
-- even though the UI only ever displays the date part. Explicit
-- `::timestamp AT TIME ZONE 'Asia/Kathmandu'` treats the naive timestamp as
-- Nepal wall-clock time and converts it to the correct UTC-backed
-- timestamptz.

BEGIN;

CREATE OR REPLACE FUNCTION public.enroll_member(
  p_customer_id      uuid,
  p_tier_id          uuid,
  p_initial_deposit  numeric,
  p_payment_mode     text,
  p_notes            text DEFAULT NULL,
  p_branch_id        uuid DEFAULT NULL,
  p_activation_date  date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role        user_role := get_user_role();
  v_caller_org  uuid      := get_user_org_id();
  v_cust_org    uuid;
  v_tier_org    uuid;
  v_membership  uuid;
  v_validity    int;
  v_today       date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
BEGIN
  IF v_role NOT IN ('manager', 'admin', 'staff') THEN
    RAISE EXCEPTION 'enroll_member: manager, admin, or staff role required';
  END IF;

  IF p_initial_deposit IS NULL OR p_initial_deposit <= 0 THEN
    RAISE EXCEPTION 'enroll_member: initial deposit must be positive';
  END IF;

  IF p_payment_mode IS NULL
     OR length(trim(p_payment_mode)) = 0
     OR length(p_payment_mode) > 40 THEN
    RAISE EXCEPTION 'enroll_member: invalid payment_mode %', p_payment_mode;
  END IF;

  IF p_activation_date IS NOT NULL THEN
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'enroll_member: only admin can backdate activation';
    END IF;
    IF p_activation_date > v_today THEN
      RAISE EXCEPTION 'enroll_member: activation date cannot be in the future';
    END IF;
  END IF;

  SELECT org_id INTO v_cust_org FROM public.customers      WHERE id = p_customer_id;
  SELECT org_id, validity_days INTO v_tier_org, v_validity FROM public.membership_tiers WHERE id = p_tier_id;

  IF v_cust_org IS NULL THEN
    RAISE EXCEPTION 'enroll_member: customer % not found', p_customer_id;
  END IF;
  IF v_tier_org IS NULL THEN
    RAISE EXCEPTION 'enroll_member: tier % not found', p_tier_id;
  END IF;
  IF v_cust_org IS DISTINCT FROM v_caller_org OR v_tier_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'enroll_member: customer and tier must be in your organization';
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, notes, created_by)
  VALUES (v_caller_org, p_customer_id, p_tier_id, p_notes, auth.uid())
  RETURNING id INTO v_membership;

  -- Initial deposit, inserted directly (not via record_membership_transaction,
  -- which is manager/admin-only) so a staff-enrolled member's first deposit
  -- still goes through the same trigger-driven balance recompute.
  INSERT INTO public.membership_transactions
    (membership_id, org_id, kind, amount, payment_mode, performed_by, notes, branch_id)
  VALUES
    (v_membership, v_caller_org, 'deposit', p_initial_deposit, p_payment_mode, auth.uid(), 'Initial enrollment deposit', p_branch_id);

  IF p_activation_date IS NOT NULL THEN
    -- trg_membership_recompute already ran via the INSERT above. It only sets
    -- activation_date when this deposit crossed the tier's advance_amount
    -- threshold; if it didn't, there is no activation event to backdate.
    IF NOT EXISTS (
      SELECT 1 FROM public.memberships
      WHERE id = v_membership AND activation_date IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'enroll_member: deposit does not meet the tier threshold -- nothing to backdate';
    END IF;

    UPDATE public.memberships
       SET activation_date = p_activation_date,
           expiry_date     = p_activation_date + (v_validity || ' days')::interval,
           created_at      = p_activation_date::timestamp AT TIME ZONE 'Asia/Kathmandu'
     WHERE id = v_membership;

    UPDATE public.membership_transactions
       SET created_at = p_activation_date::timestamp AT TIME ZONE 'Asia/Kathmandu'
     WHERE membership_id = v_membership AND kind = 'deposit';
  END IF;

  RETURN v_membership;
END;
$$;

REVOKE ALL ON FUNCTION public.enroll_member(uuid, uuid, numeric, text, text, uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enroll_member(uuid, uuid, numeric, text, text, uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.enroll_member(uuid, uuid, numeric, text, text, uuid, date) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('234', 'membership-enrollment-backdate')
ON CONFLICT (version) DO NOTHING;

COMMIT;
