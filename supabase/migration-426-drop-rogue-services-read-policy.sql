-- Migration 426: drop an untracked cross-org RLS leak on services
-- (SECURITY FIX)
--
-- Bug: production (not staging) has a SELECT policy on public.services that
-- does not exist in any prior migration file in this repo -- it was added
-- directly in the Supabase dashboard, not through the migration pipeline:
--
--   CREATE POLICY "Users can read services" ON public.services
--     FOR SELECT TO authenticated
--     USING (org_id = get_user_org_id() OR is_active = true)
--
-- The `OR is_active = true` defeats the org check entirely: Postgres RLS
-- policies for the same command are OR'd together, so this one policy alone
-- grants every authenticated user -- staff at ANY org -- read access to
-- every other org's active services, regardless of the correctly org-scoped
-- "Users can read own org services" policy (migration-012) sitting right
-- alongside it. Same bug class as migration-093, a different policy.
--
-- Found via the samis (Sami's Brow and Lashes) staff Services panel showing
-- "452 of 452" services, including Nuad Thai Spa package names ("BANGKOK
-- PACKAGE", "Annual Package") -- samis's own catalog is 53 rows, none of
-- them Nuad Thai named; the other ~400 were leaking in from nuad-thai-spa,
-- demospa and khems-cleaning via this policy.
--
-- Fix: drop the rogue policy. "Users can read own org services" already
-- covers staff reads correctly; nothing else needs to be added.
--
-- Idempotent: DROP POLICY IF EXISTS.
-- Portable: no hardcoded UUIDs.
--
-- Reversible (manual, not recommended -- this is the leak):
--   CREATE POLICY "Users can read services" ON public.services
--     FOR SELECT TO authenticated
--     USING (org_id = get_user_org_id() OR is_active = true);

BEGIN;

DROP POLICY IF EXISTS "Users can read services" ON public.services;

INSERT INTO public.schema_migrations (version, name)
VALUES ('426', 'drop-rogue-services-read-policy')
ON CONFLICT (version) DO NOTHING;

COMMIT;
