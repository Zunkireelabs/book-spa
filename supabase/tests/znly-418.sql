-- ZNLY-418 / ZNLY-406: tests for migration 433 (staff not on the service's list). Local DB only. EVERYTHING ROLLS BACK.
--   psql postgresql://postgres:postgres@127.0.0.1:56422/postgres -v ON_ERROR_STOP=1 -f supabase/tests/znly-418.sql
-- Calls check_therapist_booking_guards directly, acting as the local QC logins through request.jwt.claims.
-- ON org = samis-import-qc (every service has a list), OFF org = nuad-thai-spa (no lists). One line per case: T418-n | what | PASS/FAIL | evidence.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
BEGIN;

CREATE TEMP TABLE res (n text, what text, ok boolean, evidence text);
CREATE FUNCTION pg_temp.as_user(p_email text) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM public.users WHERE email = p_email), 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.rec(p_n text, p_what text, p_ok boolean, p_ev text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO res VALUES (p_n, p_what, COALESCE(p_ok, false), p_ev) $$;
-- run the guard; returns 'OK' or '<message>' | sqlstate
CREATE FUNCTION pg_temp.guard(p_t uuid, p_s uuid, p_b uuid, p_reason text, p_booking uuid DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS
$$ BEGIN
  PERFORM public.check_therapist_booking_guards(p_t, p_s, '2027-03-10', '2027-03-10 10:00+05:45'::timestamptz, p_b, '2027-03-10 10:30+05:45'::timestamptz, p_booking, p_reason, true);
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM || ' | ' || SQLSTATE;
END $$;

-- fixtures: a Lazimpat service that has a list, one listed person and one unlisted person; a no-list service in the OFF org ---------------------
-- (local data lists every staff member on every service, so the test takes one person OFF one list; the whole test rolls back)
CREATE TEMP TABLE fx AS
SELECT st.service_id AS svc, t.branch_id AS b, st.therapist_id AS unlisted,
       (SELECT s2.therapist_id FROM public.service_therapists s2 WHERE s2.service_id = st.service_id AND s2.therapist_id <> st.therapist_id ORDER BY s2.therapist_id LIMIT 1) AS listed,
       (SELECT o.id FROM public.branches o JOIN public.organizations oo ON oo.id = o.org_id WHERE oo.slug = 'nuad-thai-spa' ORDER BY o.id LIMIT 1) AS off_b
  FROM public.service_therapists st
  JOIN public.therapists t ON t.id = st.therapist_id
  JOIN public.organizations o ON o.id = t.org_id AND o.slug = 'samis-import-qc'
 ORDER BY st.service_id, st.therapist_id LIMIT 1;
DELETE FROM public.service_therapists WHERE service_id = (SELECT svc FROM fx) AND therapist_id = (SELECT unlisted FROM fx);
CREATE TEMP TABLE fx2 AS
SELECT (SELECT s.id FROM public.services s JOIN public.organizations o ON o.id = s.org_id AND o.slug = 'nuad-thai-spa' ORDER BY s.id LIMIT 1) AS off_svc,
       (SELECT t.id FROM public.therapists t JOIN public.organizations o ON o.id = t.org_id AND o.slug = 'nuad-thai-spa' ORDER BY t.id LIMIT 1) AS off_t;
UPDATE public.organizations SET enforce_staff_availability = false WHERE slug IN ('samis-import-qc','nuad-thai-spa');

-- T418-1 no reason: refused as before (code + SQLSTATE P0006), anyone ---------------------------------------------------------------------------
SELECT pg_temp.as_user('admin@samis-import-qc.test');
DO $$ DECLARE f fx; r text; BEGIN SELECT * INTO f FROM fx; r := pg_temp.guard(f.unlisted, f.svc, f.b, NULL);
  PERFORM pg_temp.rec('T418-1', 'unlisted person, no reason: refused with THERAPIST_NOT_ELIGIBLE / P0006', r LIKE 'THERAPIST_NOT_ELIGIBLE:%' AND r LIKE '%| P0006', r); END $$;
-- T418-2 listed person: fine
DO $$ DECLARE f fx; r text; BEGIN SELECT * INTO f FROM fx; r := pg_temp.guard(f.listed, f.svc, f.b, NULL);
  PERFORM pg_temp.rec('T418-2', 'listed person is accepted', r = 'OK', r); END $$;
-- T418-3 admin + reason: allowed, one audit row with the distinct code
DO $$ DECLARE f fx; r text; n int; BEGIN SELECT * INTO f FROM fx;
  -- an audit row needs a booking id; the test uses a throwaway uuid (audit_logs.record_id has no FK)
  r := pg_temp.guard(f.unlisted, f.svc, f.b, 'Rojina off sick', '11111111-1111-1111-1111-111111111111');
  SELECT count(*) INTO n FROM public.audit_logs WHERE record_id = '11111111-1111-1111-1111-111111111111' AND action_type = 'AVAILABILITY_OVERRIDE' AND new_data->>'code' = 'THERAPIST_NOT_ELIGIBLE' AND reason = 'Rojina off sick' AND new_data->>'service_name' IS NOT NULL;
  PERFORM pg_temp.rec('T418-3', 'admin + reason is allowed and logged once (distinct code, reason, service)', r = 'OK' AND n = 1, r || ' / audit rows ' || n); END $$;
-- T418-4 manager + reason: allowed
SELECT pg_temp.as_user('manager@smoke.test');
-- (manager@smoke.test belongs to the smoke org; the guard only checks the role, so use the staff-list fixture again)
DO $$ DECLARE f fx; r text; BEGIN SELECT * INTO f FROM fx; r := pg_temp.guard(f.unlisted, f.svc, f.b, 'Trained on it');
  PERFORM pg_temp.rec('T418-4', 'manager + reason is allowed', r = 'OK', r); END $$;
-- T418-5 staff + reason: OVERRIDE_NOT_ALLOWED (PT403), no audit row
SELECT pg_temp.as_user('staff@samis-import-qc.test');
DO $$ DECLARE f fx; r text; n int; BEGIN SELECT * INTO f FROM fx;
  r := pg_temp.guard(f.unlisted, f.svc, f.b, 'Please', '22222222-2222-2222-2222-222222222222');
  SELECT count(*) INTO n FROM public.audit_logs WHERE record_id = '22222222-2222-2222-2222-222222222222';
  PERFORM pg_temp.rec('T418-5', 'staff + reason is refused (OVERRIDE_NOT_ALLOWED / PT403), nothing logged', r LIKE 'OVERRIDE_NOT_ALLOWED:%' AND r LIKE '%| PT403' AND n = 0, r || ' / audit rows ' || n); END $$;
-- T418-6 service with no list: unaffected for everyone, with or without a reason
SELECT pg_temp.as_user('staff@smoke.test');
DO $$ DECLARE f fx2; f1 fx; r1 text; r2 text; n int; BEGIN SELECT * INTO f FROM fx2; SELECT * INTO f1 FROM fx;
  r1 := pg_temp.guard(f.off_t, f.off_svc, f1.off_b, NULL);
  r2 := pg_temp.guard(f.off_t, f.off_svc, f1.off_b, NULL, '33333333-3333-3333-3333-333333333333');
  SELECT count(*) INTO n FROM public.audit_logs WHERE record_id = '33333333-3333-3333-3333-333333333333';
  PERFORM pg_temp.rec('T418-6', 'no-list service (Nuad): accepted, nothing logged', r1 = 'OK' AND r2 = 'OK' AND n = 0, r1 || ' / ' || r2 || ' / audit rows ' || n); END $$;
-- T418-7 visit_* classifier: not-listed is overridable for manager/admin, not for staff
SELECT pg_temp.as_user('admin@samis-import-qc.test');
SELECT pg_temp.rec('T418-7a', '_visit_classify: admin may override THERAPIST_NOT_ELIGIBLE', (public._visit_classify('P0006', 'THERAPIST_NOT_ELIGIBLE: X is not on the staff list for Y.')->>'overridable')::boolean, '');
SELECT pg_temp.as_user('staff@samis-import-qc.test');
SELECT pg_temp.rec('T418-7b', '_visit_classify: staff may not', NOT (public._visit_classify('P0006', 'THERAPIST_NOT_ELIGIBLE: X is not on the staff list for Y.')->>'overridable')::boolean, '');
SELECT pg_temp.rec('T418-8', 'migration 433 is recorded in schema_migrations', EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '433'), '');

SELECT n || ' | ' || what || ' | ' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' | ' || COALESCE(evidence, '') FROM res ORDER BY n;
SELECT 'FAILS: ' || count(*) FROM res WHERE NOT ok;
ROLLBACK;
