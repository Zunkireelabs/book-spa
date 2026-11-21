-- Migration 385 (B7, Locations): an INACTIVE location takes no new appointments and is not offered for online booking.
--   * Public availability readers (public_check_slot_availability, public_check_branch_bookings_range, public_check_therapist_bookings_range,
--     public_get_bookable_therapists, public_get_service_eligible_gender_headcount) return NOTHING for an inactive branch. Each original is kept
--     under the name _<name>_impl (not callable by app roles) and the public name becomes a thin guard that calls it, so the bodies of those
--     long functions are untouched. (Re-running is safe: an existing _impl means it is already wrapped.)
--   * A BEFORE INSERT trigger on bookings refuses a NEW booking at an inactive branch (online, staff, reschedule copy, group). Existing
--     bookings there are untouched: they stay valid, can be paid, completed and reported. The public branch list already hides inactive
--     branches (RLS "Anonymous can read active branches"); Settings -> Locations, reports and history read them as before.
--   * "Closes after it opens" on every open day is already a database check (chk_branch_working_hours_times, migration-308); the test pins it.
-- NOTE for later migrations: a later CREATE OR REPLACE of one of the five public names would replace the guard; redefine _<name>_impl instead.
-- Rollback (manual): DROP TRIGGER trg_bookings_no_inactive_branch; for each name: DROP the wrapper and ALTER ... RENAME _<name>_impl back.
-- Applied: stage - / prod HELD.

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_bookings_no_inactive_branch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.branches br WHERE br.id = NEW.branch_id AND br.is_active = false) THEN
    RAISE EXCEPTION 'LOCATION_INACTIVE: This location is inactive, so it cannot take new appointments.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trg_bookings_no_inactive_branch() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_bookings_no_inactive_branch ON public.bookings;
CREATE TRIGGER trg_bookings_no_inactive_branch BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.trg_bookings_no_inactive_branch();

DO $$
DECLARE
  f text; p record; impl text; call_args text; anon_ok boolean; auth_ok boolean; ident text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public_check_slot_availability', 'public_check_branch_bookings_range', 'public_check_therapist_bookings_range',
                           'public_get_bookable_therapists', 'public_get_service_eligible_gender_headcount'] LOOP
    impl := '_' || f || '_impl';
    IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = impl) THEN CONTINUE; END IF;
    SELECT p2.oid, p2.proargnames, p2.proargmodes, pg_get_function_arguments(p2.oid) AS args, pg_get_function_identity_arguments(p2.oid) AS ident_args,
           pg_get_function_result(p2.oid) AS res
      INTO p FROM pg_proc p2 WHERE p2.pronamespace = 'public'::regnamespace AND p2.proname = f;
    IF p.oid IS NULL THEN RAISE EXCEPTION '385: function % not found', f; END IF;
    anon_ok := has_function_privilege('anon', p.oid, 'EXECUTE');
    auth_ok := has_function_privilege('authenticated', p.oid, 'EXECUTE');
    ident := p.ident_args;
    EXECUTE format('ALTER FUNCTION public.%I(%s) RENAME TO %I', f, ident, impl);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', impl, ident);
    SELECT string_agg(format('%I := %I', n, n), ', ') INTO call_args FROM unnest(p.proargnames, COALESCE(p.proargmodes, array_fill('i'::"char", ARRAY[cardinality(p.proargnames)]))) AS t(n, m)
      WHERE m IN ('i', 'b');
    EXECUTE format($w$CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $b$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = p_branch_id AND br.is_active = true) THEN RETURN; END IF;
        RETURN QUERY SELECT * FROM public.%I(%s);
      END $b$
    $w$, f, p.args, p.res, impl, call_args);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC', f, ident);
    IF anon_ok THEN EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon', f, ident); END IF;
    IF auth_ok THEN EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', f, ident); END IF;
  END LOOP;
END $$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('385', 'inactive-location-rules')
ON CONFLICT (version) DO NOTHING;

COMMIT;
