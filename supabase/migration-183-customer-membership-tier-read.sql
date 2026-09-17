-- Migration 183: let logged-in customers read their own org's membership
-- tiers, needed to show the tier name ("Deluxe Club", "Premium Club", etc.)
-- on the /account membership card and detail popup.
--
-- Same root cause as migration-094/181/182 (customer sessions are
-- `authenticated` but have no row in the staff `users` table, so
-- get_user_org_id() resolves to nothing and get_user_role()-gated policies
-- never match) and the same fix shape: a separate, org-scoped SELECT policy
-- for customers, using the same pattern as migration-082/094/181/182.
--
-- Without this, getCustomerMembership()'s embedded
-- `tier:membership_tiers(...)` select silently comes back null under RLS,
-- so transformMembership()'s tierName ends up null and the UI falls back to
-- "—" / "Membership" instead of the real tier name — for both the current
-- membership and any past/expired ones.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
-- Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   DROP POLICY IF EXISTS "customer reads own org membership tiers" ON public.membership_tiers;

BEGIN;

DROP POLICY IF EXISTS "customer reads own org membership tiers" ON public.membership_tiers;
CREATE POLICY "customer reads own org membership tiers" ON public.membership_tiers
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (SELECT org_id FROM public.customer_accounts WHERE auth_user_id = auth.uid())
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('183', 'customer-membership-tier-read')
ON CONFLICT (version) DO NOTHING;

COMMIT;
