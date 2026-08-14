-- Migration 060: staff can enroll members, but cannot read the membership
-- list, balances, or the deposit ledger.
--
-- Before this migration:
--   - enroll_member() rejected any caller whose role wasn't manager/admin.
--   - The `memberships` and `membership_transactions` SELECT policies were
--     open to ANY authenticated same-org user, including staff — so even
--     without a staff-facing UI, staff already had direct read access to
--     every member's balance/total_deposited via a raw table query, and
--     fetchCustomersLightweight() (used today by StaffBookingForm.jsx for
--     referral suggestions) embeds that same balance/total_deposited on
--     every customer row it returns.
--
-- After this migration:
--   - Staff CAN call enroll_member() to create a new membership + initial
--     deposit (the only membership write staff are allowed to make).
--   - Staff CANNOT SELECT from `memberships` or `membership_transactions`
--     at all — RLS narrows those two policies to manager/admin/admin_viewer.
--     This is enforced at the DB layer, so it holds regardless of what the
--     client-side UI shows or hides (fetchCustomersLightweight's embedded
--     `memberships` relation will simply come back empty for a staff caller).
--   - membership_tiers stays readable by everyone (unchanged) — staff need
--     tier names + prices (e.g. Premium/Deluxe advance_amount) to sell and
--     collect the correct deposit; that's the tier's fixed price, not any
--     member's actual balance/history.
--   - record_membership_transaction() is UNCHANGED — top-up/deduct/adjust
--     stay manager/admin(-only for adjustments), reached only via the
--     manager dashboard. enroll_member()'s initial deposit is inserted
--     directly (mirroring what record_membership_transaction does for kind
--     = 'deposit') instead of calling that function, specifically so this
--     one enrollment-time deposit doesn't require loosening the shared
--     function's role gate for every other membership-transaction caller.

-- ============================================================
-- 1. RLS: narrow membership reads to manager/admin/admin_viewer
-- ============================================================

DROP POLICY IF EXISTS "Users can read own org memberships" ON public.memberships;
CREATE POLICY "Manager/admin can read own org memberships"
  ON public.memberships FOR SELECT
  TO authenticated
  USING (
    org_id = get_user_org_id()
    AND get_user_role() IN ('manager', 'admin', 'admin_viewer')
  );

DROP POLICY IF EXISTS "Users can read own org membership transactions"
  ON public.membership_transactions;
CREATE POLICY "Manager/admin can read own org membership transactions"
  ON public.membership_transactions FOR SELECT
  TO authenticated
  USING (
    org_id = get_user_org_id()
    AND get_user_role() IN ('manager', 'admin', 'admin_viewer')
  );

-- ============================================================
-- 2. enroll_member(): allow staff, insert the initial deposit directly
-- ============================================================

CREATE OR REPLACE FUNCTION public.enroll_member(
  p_customer_id      uuid,
  p_tier_id          uuid,
  p_initial_deposit  numeric,
  p_payment_mode     text,
  p_notes            text DEFAULT NULL
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
BEGIN
  IF v_role NOT IN ('manager', 'admin', 'staff') THEN
    RAISE EXCEPTION 'enroll_member: manager, admin, or staff role required';
  END IF;

  IF p_initial_deposit IS NULL OR p_initial_deposit <= 0 THEN
    RAISE EXCEPTION 'enroll_member: initial deposit must be positive';
  END IF;

  IF p_payment_mode IS NULL OR p_payment_mode NOT IN ('Cash','Card','MobileBanking','Cheque','Esewa','Khalti') THEN
    RAISE EXCEPTION 'enroll_member: invalid payment_mode %', p_payment_mode;
  END IF;

  SELECT org_id INTO v_cust_org FROM public.customers      WHERE id = p_customer_id;
  SELECT org_id INTO v_tier_org FROM public.membership_tiers WHERE id = p_tier_id;

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
    (membership_id, org_id, kind, amount, payment_mode, performed_by, notes)
  VALUES
    (v_membership, v_caller_org, 'deposit', p_initial_deposit, p_payment_mode, auth.uid(), 'Initial enrollment deposit');

  RETURN v_membership;
END;
$$;

REVOKE ALL ON FUNCTION public.enroll_member(uuid, uuid, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enroll_member(uuid, uuid, numeric, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.enroll_member(uuid, uuid, numeric, text, text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('060', 'staff-membership-enrollment')
ON CONFLICT (version) DO NOTHING;
