-- Migration 093: fix cross-org data leak on public-read RLS policies
-- (SECURITY FIX)
--
-- Bug: therapists, rooms, and services each have an "Anonymous can read
-- active ___" SELECT policy scoped `TO anon, authenticated` with no org_id
-- filter (just `is_active = true`). Postgres RLS policies are OR'd together
-- for the same command, so ANY authenticated user -- staff at any
-- organization -- matches this permissive policy and can read every other
-- org's active therapists/rooms/services, regardless of the correctly
-- org-scoped "Users can read own org ___" policy that already exists
-- alongside it. Found via the branch-manager Staff list showing therapist
-- rows from the `demo` and `khems-cleaning` orgs while logged in as a
-- Nuad Thai admin.
--
-- membership_tiers has the same `TO anon, authenticated USING (true)` shape
-- but -- unlike the other three -- has no separate authenticated org-scoped
-- policy at all, so it needs one added (not just the anon-only restriction)
-- or authenticated staff would lose membership-tier access entirely.
--
-- Fix: restrict each public-marketing-page policy to `TO anon` only, so
-- authenticated requests fall through to (or newly get) the org-scoped
-- policy instead. No application code changes needed -- every read already
-- goes through `services/api.js` which filters by org_id explicitly; this
-- closes the gap for any query that doesn't (or won't, in the future).
--
-- Idempotent: ALTER POLICY / DROP POLICY IF EXISTS + CREATE POLICY.
-- Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   ALTER POLICY "Anonymous can read active therapists" ON public.therapists TO anon, authenticated;
--   ALTER POLICY "Anonymous can read active rooms" ON public.rooms TO anon, authenticated;
--   ALTER POLICY "Anonymous can read active services" ON public.services TO anon, authenticated;
--   ALTER POLICY "Anyone can read membership tiers" ON public.membership_tiers TO anon, authenticated USING (true);
--   DROP POLICY IF EXISTS "Users can read own org membership tiers" ON public.membership_tiers;

BEGIN;

ALTER POLICY "Anonymous can read active therapists" ON public.therapists
  TO anon;

ALTER POLICY "Anonymous can read active rooms" ON public.rooms
  TO anon;

ALTER POLICY "Anonymous can read active services" ON public.services
  TO anon;

ALTER POLICY "Anyone can read membership tiers" ON public.membership_tiers
  TO anon
  USING (is_active = true);

DROP POLICY IF EXISTS "Users can read own org membership tiers" ON public.membership_tiers;
CREATE POLICY "Users can read own org membership tiers"
  ON public.membership_tiers FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

INSERT INTO public.schema_migrations (version, name)
VALUES ('093', 'fix-cross-org-rls-leak')
ON CONFLICT (version) DO NOTHING;

COMMIT;
