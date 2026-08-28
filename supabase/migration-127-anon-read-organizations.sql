-- The customer-facing booking flow (fetchOrganizationBySlug in src/services/api.js) looks up an
-- org by slug as the anon role — this is how /:orgSlug/book resolves which tenant to show. That
-- currently only works because staging/production carry an anon SELECT policy on `organizations`
-- that was applied out-of-band (dashboard/ad hoc), not tracked in any migration file — the same
-- class of drift CLAUDE.md's "Past incident (2026-06-13)" already flags for this repo. Discovered
-- while bootstrapping a fresh local Postgres stack from these tracked migrations alone: the local
-- stack correctly has no such policy (migration-012-org-rls-policies.sql explicitly restricted
-- organizations to `authenticated` only), so /:orgSlug/book 404s locally with "Organization Not
-- Found" even though it works on staging. This migration makes that policy an actual tracked
-- migration instead of undocumented drift.

CREATE POLICY "Anonymous can read active organizations"
  ON organizations FOR SELECT
  TO anon
  USING (is_active = true);

INSERT INTO public.schema_migrations (version, name)
VALUES ('127', 'anon-read-organizations') ON CONFLICT (version) DO NOTHING;
