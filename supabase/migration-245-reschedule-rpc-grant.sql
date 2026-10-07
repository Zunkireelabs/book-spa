-- Migration 245: grant EXECUTE on reschedule_booking() to authenticated
-- migration-243 created the function but never granted EXECUTE — Supabase's
-- default-deny posture means every supabase.rpc('reschedule_booking', ...)
-- call fails with "permission denied for function" until this runs.

BEGIN;

REVOKE ALL ON FUNCTION public.reschedule_booking(uuid, date, time, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reschedule_booking(uuid, date, time, uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reschedule_booking(uuid, date, time, uuid, uuid, text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('245', 'reschedule-rpc-grant')
ON CONFLICT (version) DO NOTHING;

COMMIT;
