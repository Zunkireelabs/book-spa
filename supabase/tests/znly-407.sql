-- ZNLY-407: tests for migration 434 (extend_booking). Local DB only. EVERYTHING ROLLS BACK.
--   psql postgresql://postgres:postgres@127.0.0.1:56422/postgres -v ON_ERROR_STOP=1 -f supabase/tests/znly-407.sql
-- ON org = samis-import-qc (beauty: extend ON by default), OFF org = nuad-thai-spa (spa: OFF by default).
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
BEGIN;
CREATE TEMP TABLE res (n text, what text, ok boolean, evidence text);
CREATE FUNCTION pg_temp.as_user(p_email text) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM public.users WHERE email = p_email), 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.rec(p_n text, p_what text, p_ok boolean, p_ev text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO res VALUES (p_n, p_what, COALESCE(p_ok, false), p_ev) $$;
-- run extend_booking; 'OK' or 'message | sqlstate'
CREATE FUNCTION pg_temp.ext(p_id uuid, p_extra int, p_reason text DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS
$$ BEGIN PERFORM public.extend_booking(p_id, p_extra, p_reason); RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM || ' | ' || SQLSTATE; END $$;
CREATE FUNCTION pg_temp.mk(p_branch uuid, p_svc uuid, p_t uuid, p_date text, p_start text) RETURNS uuid LANGUAGE plpgsql AS
$$ DECLARE r jsonb; BEGIN
  r := public.visit_create(p_branch, '{"name":"Test 407","phone":"+9779800040701","gender":"female"}',
    jsonb_build_array(jsonb_build_object('service_id', p_svc, 'date', p_date, 'start_time', p_start, 'therapist_id', p_t)), NULL, false);
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'setup failed: %', r; END IF;
  RETURN (r->'rows'->0->>'booking_id')::uuid; END $$;

UPDATE public.organizations SET enforce_staff_availability = false, allow_staff_overlap = false WHERE slug IN ('samis-import-qc','nuad-thai-spa');  -- overlap OFF so the clash rule is the one under test
CREATE TEMP TABLE fx AS SELECT
  'c9300f29-4e99-481e-8a67-897e4a463858'::uuid AS br, '30545e06-6002-45d8-9e1f-a2feb1d7dfdc'::uuid AS svc,   -- Classic Manicure 45 min
  '8f9534ea-406d-5c38-9bf4-4e766dbe3830'::uuid AS t1, '27d7c9fd-8296-5563-a0bc-3bbb925b5525'::uuid AS t2,
  'b0000000-0000-0000-0000-000000000001'::uuid AS off_br, 'f0000000-0000-0000-0000-000000000001'::uuid AS off_svc, 'd0000000-0000-0000-0000-000000000001'::uuid AS off_t;
CREATE TEMP TABLE keep (k text PRIMARY KEY, v uuid);

SELECT pg_temp.as_user('admin@samis-import-qc.test');
INSERT INTO keep SELECT 'b1', pg_temp.mk(br, svc, t1, '2027-03-10', '10:00') FROM fx;
INSERT INTO keep SELECT 'b2', pg_temp.mk(br, svc, t1, '2027-03-10', '12:00') FROM fx;   -- the next booking of t1
INSERT INTO keep SELECT 'p', pg_temp.mk(br, svc, t2, '2027-03-10', '10:00') FROM fx;    -- price/untouched twin

-- T407-1 extra 0 is exactly as before
DO $$ DECLARE b record; BEGIN SELECT * INTO b FROM bookings WHERE id = (SELECT v FROM keep WHERE k='b1');
  PERFORM pg_temp.rec('T407-1', 'a normal booking: extra 0, ends start + service length (45 min)', b.extra_minutes = 0 AND b.end_time = '10:45', b.end_time::text); END $$;
-- T407-2 extend: +20, end moves, price unchanged, junction follows, history row
DO $$ DECLARE b0 record; b record; r text; n int; jt time; BEGIN
  SELECT * INTO b0 FROM bookings WHERE id = (SELECT v FROM keep WHERE k='b1');
  r := pg_temp.ext(b0.id, 20);
  SELECT * INTO b FROM bookings WHERE id = b0.id;
  SELECT end_time INTO jt FROM booking_therapists WHERE booking_id = b0.id LIMIT 1;
  SELECT count(*) INTO n FROM audit_logs WHERE record_id = b0.id AND action_type = 'LENGTH_CHANGED' AND (old_data->>'length_minutes')::int = 45 AND (new_data->>'length_minutes')::int = 65;
  PERFORM pg_temp.rec('T407-2a', '+20: end 11:05, extra 20', r = 'OK' AND b.end_time = '11:05' AND b.extra_minutes = 20 AND b.end_datetime - b.start_datetime = interval '65 minutes', r || ' ' || b.end_time);
  PERFORM pg_temp.rec('T407-2b', 'price untouched (base, discount, final)', b.base_amount = b0.base_amount AND b.discount_amount = b0.discount_amount AND b.final_amount = b0.final_amount, b0.final_amount || '/' || b.final_amount);
  PERFORM pg_temp.rec('T407-2c', 'staff junction row follows the booking end', jt = '11:05', jt::text);
  PERFORM pg_temp.rec('T407-2d', 'history row "length changed 45 -> 65"', n = 1, n::text);
END $$;
-- T407-3 clash with t1's next booking (12:00): refused with a plain sentence, nothing changed
DO $$ DECLARE r text; b record; BEGIN
  r := pg_temp.ext((SELECT v FROM keep WHERE k='b1'), 120);  -- 10:00 + 45 + 120 = 12:45 > 12:00
  SELECT * INTO b FROM bookings WHERE id = (SELECT v FROM keep WHERE k='b1');
  PERFORM pg_temp.rec('T407-3', 'runs into the next booking: refused, plain sentence, unchanged', r LIKE 'EXTEND_CLASH:%12:00pm%' AND r NOT ILIKE '%constraint%' AND b.extra_minutes = 20, r); END $$;
-- T407-4 shorter back to 0, not a multiple of 5, negative
DO $$ DECLARE r1 text; r2 text; r3 text; b record; BEGIN
  r2 := pg_temp.ext((SELECT v FROM keep WHERE k='b1'), 7); r3 := pg_temp.ext((SELECT v FROM keep WHERE k='b1'), -5);
  r1 := pg_temp.ext((SELECT v FROM keep WHERE k='b1'), 0);
  SELECT * INTO b FROM bookings WHERE id = (SELECT v FROM keep WHERE k='b1');
  PERFORM pg_temp.rec('T407-4', 'back to 0 works; 7 and -5 refused', r1 = 'OK' AND b.end_time = '10:45' AND r2 LIKE 'EXTEND_REFUSED:%' AND r3 LIKE 'EXTEND_REFUSED:%', r1||' / '||r2||' / '||r3); END $$;
-- T407-5 a direct PATCH of extra_minutes is refused
DO $$ DECLARE r text; BEGIN
  BEGIN UPDATE bookings SET extra_minutes = 30 WHERE id = (SELECT v FROM keep WHERE k='b1'); r := 'OK'; EXCEPTION WHEN OTHERS THEN r := SQLERRM; END;
  PERFORM pg_temp.rec('T407-5', 'direct update of extra_minutes is refused', r LIKE 'EXTRA_PROTECTED:%', r); END $$;
-- T407-6 reschedule keeps the extra minutes
DO $$ DECLARE j jsonb; nb record; BEGIN
  PERFORM pg_temp.ext((SELECT v FROM keep WHERE k='p'), 15);
  j := public.reschedule_booking((SELECT v FROM keep WHERE k='p'), '2027-03-11', '14:00', (SELECT t2 FROM fx), NULL, 'test');
  SELECT * INTO nb FROM bookings WHERE id = (j->>'id')::uuid;
  PERFORM pg_temp.rec('T407-6', 'reschedule keeps the extra minutes (end = 14:00 + 45 + 15)', nb.extra_minutes = 15 AND nb.end_time = '15:00', nb.extra_minutes || ' ' || nb.end_time); END $$;
-- T407-7 changing the service resets extra
DO $$ DECLARE b record; s2 uuid; BEGIN
  SELECT id INTO s2 FROM services WHERE org_id = (SELECT org_id FROM branches WHERE id = (SELECT br FROM fx)) AND id <> (SELECT svc FROM fx) AND is_active AND NOT COALESCE(is_combo, false) AND duration_minutes <> 45 LIMIT 1;
  PERFORM pg_temp.ext((SELECT v FROM keep WHERE k='b1'), 10);
  UPDATE bookings SET service_id = s2 WHERE id = (SELECT v FROM keep WHERE k='b1');
  SELECT * INTO b FROM bookings WHERE id = (SELECT v FROM keep WHERE k='b1');
  PERFORM pg_temp.rec('T407-7', 'service change resets extra to 0', b.extra_minutes = 0, b.extra_minutes::text); END $$;
-- T407-8 setting OFF (spa default) refuses; a beauty org can be switched OFF too
SELECT pg_temp.as_user('admin@smoke.test');
DO $$ DECLARE f fx; bid uuid; r text; BEGIN SELECT * INTO f FROM fx;
  bid := pg_temp.mk(f.off_br, f.off_svc, f.off_t, '2027-03-10', '10:00');
  r := pg_temp.ext(bid, 10);
  PERFORM pg_temp.rec('T407-8a', 'spa org (default OFF): refused, plain', r LIKE 'EXTEND_OFF:%', r);
  UPDATE organizations SET extend_by_drag = true WHERE slug = 'nuad-thai-spa';
  r := pg_temp.ext(bid, 10);
  PERFORM pg_temp.rec('T407-8b', 'spa org switched ON explicitly: allowed', r = 'OK', r);
END $$;
SELECT pg_temp.as_user('admin@samis-import-qc.test');
DO $$ DECLARE r text; BEGIN
  UPDATE organizations SET extend_by_drag = false WHERE slug = 'samis-import-qc';
  r := pg_temp.ext((SELECT v FROM keep WHERE k='b2'), 5);
  PERFORM pg_temp.rec('T407-8c', 'beauty org switched OFF explicitly: refused', r LIKE 'EXTEND_OFF:%', r);
  UPDATE organizations SET extend_by_drag = NULL WHERE slug = 'samis-import-qc'; END $$;
-- T407-9 staff can extend inside hours; outside hours (availability ON): staff refused, manager needs a reason, then allowed + logged
SELECT pg_temp.as_user('staff@samis-import-qc.test');
DO $$ DECLARE r text; BEGIN
  r := pg_temp.ext((SELECT v FROM keep WHERE k='b2'), 5);
  PERFORM pg_temp.rec('T407-9a', 'staff may make a booking longer (availability off)', r = 'OK', r); END $$;
SELECT pg_temp.as_user('admin@samis-import-qc.test');
UPDATE public.organizations SET enforce_staff_availability = true WHERE slug = 'samis-import-qc';
INSERT INTO keep SELECT 'late', pg_temp.mk((SELECT br FROM fx), (SELECT svc FROM fx), (SELECT t1 FROM fx), '2027-03-10', '15:00') ;
DO $$ DECLARE r1 text; r2 text; r3 text; bid uuid := (SELECT v FROM keep WHERE k='late'); n int; BEGIN
  -- push it far past any shift end
  r1 := pg_temp.ext(bid, 300);
  IF r1 = 'OK' THEN PERFORM pg_temp.ext(bid, 0); END IF;
  PERFORM pg_temp.rec('T407-9b', 'far past working hours with availability ON: needs a reason (not silently saved)', r1 <> 'OK' AND r1 ILIKE '%|%PT409%', r1);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM public.users WHERE email = 'staff@samis-import-qc.test'), 'role', 'authenticated')::text, true);
  r2 := pg_temp.ext(bid, 300, 'please');
  PERFORM pg_temp.rec('T407-9c', 'staff + reason: refused (manager only)', r2 LIKE 'OVERRIDE_NOT_ALLOWED:%', r2);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM public.users WHERE email = 'admin@samis-import-qc.test'), 'role', 'authenticated')::text, true);
  r3 := pg_temp.ext(bid, 300, 'Customer asked to stay late');
  SELECT count(*) INTO n FROM audit_logs WHERE record_id = bid AND action_type = 'AVAILABILITY_OVERRIDE';
  PERFORM pg_temp.rec('T407-9d', 'admin + reason: allowed and the override is logged', r3 = 'OK' AND n >= 1, r3 || ' / override rows ' || n); END $$;
SELECT pg_temp.rec('T407-10', 'migration 434 recorded', EXISTS (SELECT 1 FROM schema_migrations WHERE version = '434'), '');

SELECT n || ' | ' || what || ' | ' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' | ' || COALESCE(evidence, '') FROM res ORDER BY n;
SELECT 'FAILS: ' || count(*) FROM res WHERE NOT ok;
ROLLBACK;
