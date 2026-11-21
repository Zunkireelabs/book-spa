-- Migration 418 (ZNLY-358): wrap auth.uid() lookup in the contact sync log SELECT policy (migration 411)
-- so it is evaluated once per statement (initplan), as scripts/check-rls-initplan.sh requires.
-- Same name, same semantics: a user reads only their own org's rows. Migration 411 is left untouched.
BEGIN;

DROP POLICY IF EXISTS "Staff can read their org's contact sync log" ON public.marketplace_contact_sync_log;
CREATE POLICY "Staff can read their org's contact sync log"
  ON public.marketplace_contact_sync_log
  FOR SELECT TO authenticated
  USING (org_id = (SELECT get_user_org_id()));

INSERT INTO public.schema_migrations (version, name)
VALUES ('418', 'contact-sync-log-rls-initplan')
ON CONFLICT (version) DO NOTHING;

COMMIT;
