-- Migration 088: let staff read memberships (balance included) (REVERSIBLE)
--
-- migration-080 narrowed `memberships` SELECT to manager/admin/admin_viewer,
-- specifically to hide wallet balances from staff. migration-087 then added a
-- staff-safe RPC (status/tier only, no balance) so staff could at least use
-- Membership as a payment option without seeing the number.
--
-- Product decision (confirmed explicitly): staff should see the exact same
-- thing admin/manager does at checkout — the real wallet balance and live
-- deduction — not a hidden/generic view. This reopens `memberships` SELECT to
-- staff, reversing migration-080's restriction for this one table.
--
-- `membership_transactions` (the deposit/deduction ledger, used by the
-- manager-only Memberships/Wallet Usage pages) is intentionally left
-- untouched — staff has no UI that reads it, and this migration is scoped to
-- exactly what changed: checkout wallet visibility.
--
-- migration-087's list_membership_status_for_org() RPC is left in place —
-- fetchCustomersLightweight still uses it for the booking-creation tier
-- badge, which never needed balance anyway, and removing it would be
-- unnecessary churn.
--
-- Idempotent (DROP/CREATE POLICY guarded) and portable (no hardcoded UUIDs).
-- MUST also be run on production (see PROMOTION.md) once this ships past stage.
--
-- Reversible:
--   DROP POLICY IF EXISTS "Manager/admin/staff can read own org memberships" ON public.memberships;
--   CREATE POLICY "Manager/admin can read own org memberships"
--     ON public.memberships FOR SELECT
--     TO authenticated
--     USING (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin', 'admin_viewer'));

DROP POLICY IF EXISTS "Manager/admin can read own org memberships" ON public.memberships;
CREATE POLICY "Manager/admin/staff can read own org memberships"
  ON public.memberships FOR SELECT
  TO authenticated
  USING (
    org_id = get_user_org_id()
    AND get_user_role() IN ('manager', 'admin', 'admin_viewer', 'staff')
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('088', 'staff-read-membership-balance')
ON CONFLICT (version) DO NOTHING;
