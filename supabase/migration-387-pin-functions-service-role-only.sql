-- Migration 387 (ZNLY-219): records the production hotfix applied by the owner. The PIN functions verify_pin and login_with_pin are
-- executable by service_role ONLY (the pin-login Edge Function calls them with the service key); PUBLIC, anon and authenticated cannot.
-- Idempotent and signature-agnostic: loops over whatever overloads exist; does nothing for a function that does not exist
-- (login_with_pin does not exist in the local DB).
-- Rollback (manual): GRANT EXECUTE back to the roles that need it.
-- Applied: prod (hotfix, by hand) / stage -.

BEGIN;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('verify_pin', 'login_with_pin')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('387', 'pin-functions-service-role-only')
ON CONFLICT (version) DO NOTHING;

COMMIT;
