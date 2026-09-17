-- Migration 181: let logged-in customers read their own org's branch names,
-- needed to show "which branch" on the /account membership-activity and
-- voucher-usage history popups.
--
-- Same root cause as migration-094 (customer sessions are `authenticated`
-- but have no row in the staff `users` table, so get_user_org_id() resolves
-- to nothing and get_user_role()-gated policies never match) and the same
-- fix shape: a separate, org-scoped SELECT policy for customers, using the
-- same pattern as migration-082/094 ("... org_id IN (SELECT org_id FROM
-- customer_accounts WHERE auth_user_id = auth.uid())"). branches.name/
-- address are already world-readable via the existing "Anonymous can read
-- active branches" policy (TO anon), so this doesn't expose anything new —
-- it just extends the same "active branches are public info" posture to
-- already-logged-in customers, who currently fall through both the anon
-- policy (wrong role) and the staff policy (no org via get_user_org_id()).
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
-- Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   DROP POLICY IF EXISTS "customer reads own org branches" ON public.branches;

BEGIN;

DROP POLICY IF EXISTS "customer reads own org branches" ON public.branches;
CREATE POLICY "customer reads own org branches" ON public.branches
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND org_id IN (SELECT org_id FROM public.customer_accounts WHERE auth_user_id = auth.uid())
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('181', 'customer-branch-read-for-history')
ON CONFLICT (version) DO NOTHING;

COMMIT;
