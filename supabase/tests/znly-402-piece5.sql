-- ZNLY-402 piece 5: tests for migration 430 (visit_* functions). Local DB only. EVERYTHING ROLLS BACK.
--   psql postgresql://postgres:postgres@127.0.0.1:56422/postgres -v ON_ERROR_STOP=1 -f supabase/tests/znly-402-piece5.sql
-- Acts as the local QC logins through request.jwt.claims (the functions read auth.uid()). ON org = samis-import-qc, OFF org = nuad-thai-spa.
-- Each case prints one line: S5-n | what | PASS/FAIL | evidence. A final line counts FAILs.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
BEGIN;

CREATE TEMP TABLE res (n text, what text, ok boolean, evidence text);
CREATE FUNCTION pg_temp.as_user(p_email text) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM public.users WHERE email = p_email), 'role', 'authenticated')::text, true) $$;
-- row hash of one booking (visit): every column of every row + its junction rows; unchanged = identical hash
CREATE FUNCTION pg_temp.h(p_key uuid) RETURNS text LANGUAGE sql AS
$$ SELECT md5(COALESCE((SELECT string_agg(to_jsonb(b)::text, '|' ORDER BY b.id) FROM public.bookings b
                         WHERE b.id = p_key OR b.visit_id = p_key OR b.visit_id = (SELECT visit_id FROM public.bookings WHERE id = p_key)), '')
           || COALESCE((SELECT string_agg(to_jsonb(t)::text, '|' ORDER BY t.id) FROM public.booking_therapists t
                         WHERE t.booking_id IN (SELECT id FROM public.bookings WHERE id = p_key OR visit_id = p_key OR visit_id = (SELECT visit_id FROM public.bookings WHERE id = p_key))), '')) $$;
-- start a service on a future test date (the no-future-status rule would refuse; the test only needs the 'started' state)
CREATE FUNCTION pg_temp.start(p_id uuid) RETURNS void LANGUAGE plpgsql AS
$$ BEGIN
  ALTER TABLE public.bookings DISABLE TRIGGER trg_bookings_no_future_status;
  UPDATE public.bookings SET status = 'Confirmed' WHERE id = p_id;
  UPDATE public.bookings SET status = 'In-Progress' WHERE id = p_id;
  ALTER TABLE public.bookings ENABLE TRIGGER trg_bookings_no_future_status;
END $$;
CREATE FUNCTION pg_temp.rec(p_n text, p_what text, p_ok boolean, p_ev text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO res VALUES (p_n, p_what, COALESCE(p_ok, false), p_ev) $$;

-- fixtures ------------------------------------------------------------------------------------------------------------------------------------
-- ON org (Lazimpat, services + staff of samis-import-qc); availability guard off so shifts do not decide these cases (shift case S5-13 turns it on)
UPDATE public.organizations SET enforce_staff_availability = false WHERE slug = 'samis-import-qc';
CREATE TEMP TABLE fx AS SELECT
  'c9300f29-4e99-481e-8a67-897e4a463858'::uuid AS on_branch,
  '30545e06-6002-45d8-9e1f-a2feb1d7dfdc'::uuid AS svc_a,      -- Classic Manicure 45 min 1500
  '9a5495fb-d730-491e-9949-e4babe483eb8'::uuid AS svc_b,      -- Classic Pedicure 60 min 2000
  '4ef5f879-b61e-42bf-bd2c-8534f8520e13'::uuid AS svc_c,      -- Deluxe manicure 60 min 2300
  '8f9534ea-406d-5c38-9bf4-4e766dbe3830'::uuid AS t1, '27d7c9fd-8296-5563-a0bc-3bbb925b5525'::uuid AS t2, 'bac7c69d-d761-51d4-ad47-e81306c1aad9'::uuid AS t3,
  'b0000000-0000-0000-0000-000000000001'::uuid AS off_branch,
  'f0000000-0000-0000-0000-000000000001'::uuid AS off_svc1, '4286f5bf-a02c-415d-9dd3-2f02fa107a91'::uuid AS off_svc2,
  'd0000000-0000-0000-0000-000000000001'::uuid AS ot1, 'd0000000-0000-0000-0000-000000000002'::uuid AS ot2;
CREATE TEMP TABLE keep (k text PRIMARY KEY, v jsonb);

-- S5-1 visit_create ON, dry run changes nothing, real call writes one visit_id and no booking_group_id ---------------------------------------
SELECT pg_temp.as_user('admin@samis-import-qc.test');
DO $$ DECLARE f fx; c0 int; r jsonb; c1 int; c2 int; v jsonb;
BEGIN
  SELECT * INTO f FROM fx;
  v := jsonb_build_array(jsonb_build_object('service_id', f.svc_a, 'date', '2027-03-10', 'start_time', '10:00', 'therapist_id', f.t1),
                         jsonb_build_object('service_id', f.svc_b, 'date', '2027-03-10', 'start_time', '10:45', 'therapist_id', f.t2),
                         jsonb_build_object('service_id', f.svc_c, 'date', '2027-03-10', 'start_time', '11:45', 'therapist_id', f.t3));
  SELECT count(*) INTO c0 FROM bookings WHERE date = '2027-03-10';
  r := visit_create(f.on_branch, '{"name":"Test S5 One","phone":"+9779800099001","gender":"female"}', v, NULL, true);
  SELECT count(*) INTO c1 FROM bookings WHERE date = '2027-03-10';
  PERFORM pg_temp.rec('S5-1a', 'visit_create dry_run changes nothing', c0 = c1 AND (r->>'ok')::boolean AND (r->'totals'->>'change')::int = 3
    AND NOT EXISTS (SELECT 1 FROM customers WHERE phone = '+9779800099001'), format('bookings before %s after %s; totals %s; customer created %s', c0, c1, r->'totals', EXISTS (SELECT 1 FROM customers WHERE phone = '+9779800099001')));
  r := visit_create(f.on_branch, '{"name":"Test S5 One","phone":"+9779800099001","gender":"female"}', v, NULL, false);
  SELECT count(*) INTO c2 FROM bookings WHERE date = '2027-03-10';
  INSERT INTO keep VALUES ('visit', r->'rows'->0->'booking_id');
  PERFORM pg_temp.rec('S5-1b', 'visit_create ON writes 3 rows, one visit_id, no booking_group_id', (r->>'ok')::boolean AND c2 = c0 + 3
    AND (SELECT count(DISTINCT visit_id) FROM bookings WHERE date = '2027-03-10' AND customer_name = 'Test S5 One') = 1
    AND (SELECT count(*) FROM bookings WHERE date = '2027-03-10' AND customer_name = 'Test S5 One' AND visit_id IS NOT NULL AND booking_group_id IS NULL) = 3,
    (SELECT string_agg(booking_number || ' ' || start_time || ' ' || therapist_name_snapshot, '; ' ORDER BY start_time) FROM bookings WHERE customer_name = 'Test S5 One'));
END $$;

-- S5-2 visit_create refusal on row 2 leaves row 1 NOT created (same staff overlap with allow_staff_overlap OFF) ----------------------------------
DO $$ DECLARE f fx; c0 int; r jsonb; c1 int; v jsonb;
BEGIN
  SELECT * INTO f FROM fx;
  UPDATE organizations SET allow_staff_overlap = false WHERE slug = 'samis-import-qc';
  v := jsonb_build_array(jsonb_build_object('service_id', f.svc_a, 'date', '2027-03-11', 'start_time', '10:00', 'therapist_id', f.t1),
                         jsonb_build_object('service_id', f.svc_b, 'date', '2027-03-11', 'start_time', '10:30', 'therapist_id', f.t1));
  SELECT count(*) INTO c0 FROM bookings WHERE date = '2027-03-11';
  r := visit_create(f.on_branch, '{"name":"Test S5 Two","phone":"+9779800099002"}', v, NULL, false);
  SELECT count(*) INTO c1 FROM bookings WHERE date = '2027-03-11';
  PERFORM pg_temp.rec('S5-2', 'visit_create: row 2 refused (same staff overlap) => row 1 not created, nothing left', NOT (r->>'ok')::boolean AND c0 = c1
    AND r->'rows'->1->>'verdict' = 'block' AND NOT EXISTS (SELECT 1 FROM customers WHERE phone = '+9779800099002'),
    format('ok=%s code=%s msg=%s; row verdicts %s,%s; bookings %s->%s', r->>'ok', r->>'code', r->>'message', r->'rows'->0->>'verdict', r->'rows'->1->>'verdict', c0, c1));
  UPDATE organizations SET allow_staff_overlap = true WHERE slug = 'samis-import-qc';
END $$;

-- S5-3 OFF org: 2 services -> booking_group_id (no visit_id); 1 service -> neither -------------------------------------------------------------
SELECT pg_temp.as_user('admin@smoke.test');
DO $$ DECLARE f fx; r jsonb; r1 jsonb; v jsonb;
BEGIN
  SELECT * INTO f FROM fx;
  v := jsonb_build_array(jsonb_build_object('service_id', f.off_svc1, 'date', '2027-03-12', 'start_time', '10:00', 'therapist_id', f.ot1, 'room_id', 'c0000000-0000-0000-0000-000000000001'),
                         jsonb_build_object('service_id', f.off_svc2, 'date', '2027-03-12', 'start_time', '11:00', 'therapist_id', f.ot1, 'room_id', 'c0000000-0000-0000-0000-000000000001'));
  r := visit_create(f.off_branch, '{"name":"Test S5 Off","phone":"+9779800099003"}', v, NULL, false);
  r1 := visit_create(f.off_branch, '{"name":"Test S5 Solo","phone":"+9779800099004"}', jsonb_build_array(v->0 || '{"start_time":"14:00"}'), NULL, false);
  PERFORM pg_temp.rec('S5-3', 'OFF org: 2 services = one booking_group_id and no visit_id; 1 service = neither', (r->>'ok')::boolean AND (r1->>'ok')::boolean
    AND (SELECT count(*) FROM bookings WHERE customer_name = 'Test S5 Off' AND visit_id IS NULL AND booking_group_id IS NOT NULL) = 2
    AND (SELECT count(*) FROM bookings WHERE customer_name = 'Test S5 Solo' AND visit_id IS NULL AND booking_group_id IS NULL) = 1,
    format('create ok=%s/%s %s', r->>'ok', r1->>'ok', COALESCE(r->>'message', r1->>'message', '')));
END $$;

-- S5-4 visit_set_status ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.as_user('admin@samis-import-qc.test');
DO $$ DECLARE vk uuid; h0 text; h1 text; r jsonb; r2 jsonb; ids uuid[];
BEGIN
  SELECT (v->>0)::uuid INTO vk FROM keep WHERE k = 'visit';
  SELECT array_agg(id ORDER BY start_time) INTO ids FROM bookings WHERE visit_id = (SELECT visit_id FROM bookings WHERE id = vk);
  h0 := pg_temp.h(vk);
  r := visit_set_status(vk, 'Cancelled', 'Customer called', true);
  h1 := pg_temp.h(vk);
  PERFORM pg_temp.rec('S5-4a', 'set_status dry_run: row hash identical, preview says 3 change', h0 = h1 AND (r->>'ok')::boolean AND (r->'totals'->>'change')::int = 3, format('hash %s = %s; totals %s', left(h0, 8), left(h1, 8), r->'totals'));
  -- row 3 on a closed day => block; rows 1,2 must stay untouched (nothing half done)
  ALTER TABLE bookings DISABLE TRIGGER trg_enforce_booking_immutability;
  UPDATE bookings SET is_locked = true WHERE id = ids[3];
  ALTER TABLE bookings ENABLE TRIGGER trg_enforce_booking_immutability;
  h0 := pg_temp.h(vk);
  r := visit_set_status(vk, 'Cancelled', 'Customer called', false);
  h1 := pg_temp.h(vk);
  PERFORM pg_temp.rec('S5-4b', 'set_status: refusal on row 3 (closed day) leaves rows 1 and 2 unchanged', NOT (r->>'ok')::boolean AND h0 = h1 AND r->'rows'->2->>'verdict' = 'block'
    AND (SELECT count(*) FROM bookings WHERE id = ANY (ids) AND status::text = 'Cancelled') = 0, format('code=%s msg=%s; verdicts %s/%s/%s; hash same=%s', r->>'code', r->>'message', r->'rows'->0->>'verdict', r->'rows'->1->>'verdict', r->'rows'->2->>'verdict', h0 = h1));
  ALTER TABLE bookings DISABLE TRIGGER trg_enforce_booking_immutability;
  UPDATE bookings SET is_locked = false WHERE id = ids[3];
  ALTER TABLE bookings ENABLE TRIGGER trg_enforce_booking_immutability;
  -- row 2 started => kept; rows 1,3 cancelled
  PERFORM pg_temp.start(ids[2]);
  r := visit_set_status(vk, 'Cancelled', 'Customer called', false);
  PERFORM pg_temp.rec('S5-4c', 'set_status: started row stays, untouched rows cancel (change/keep list)', (r->>'ok')::boolean AND r->'rows'->1->>'verdict' = 'keep'
    AND (SELECT status::text FROM bookings WHERE id = ids[1]) = 'Cancelled' AND (SELECT status::text FROM bookings WHERE id = ids[2]) = 'In-Progress' AND (SELECT status::text FROM bookings WHERE id = ids[3]) = 'Cancelled',
    format('verdicts %s/%s/%s reason2=%s', r->'rows'->0->>'verdict', r->'rows'->1->>'verdict', r->'rows'->2->>'verdict', r->'rows'->1->>'reason'));
  r2 := visit_set_status(vk, 'No Show', '', false);
  PERFORM pg_temp.rec('S5-4d', 'set_status: reason is required', NOT (r2->>'ok')::boolean AND r2->>'code' = 'REASON_REQUIRED', r2->>'message');
END $$;

-- S5-5 visit_remove_service ----------------------------------------------------------------------------------------------------------------
DO $$ DECLARE f fx; r jsonb; v jsonb; ids uuid[]; vk uuid; h0 text; h1 text;
BEGIN
  SELECT * INTO f FROM fx;
  v := jsonb_build_array(jsonb_build_object('service_id', f.svc_a, 'date', '2027-03-15', 'start_time', '10:00', 'therapist_id', f.t1),
                         jsonb_build_object('service_id', f.svc_b, 'date', '2027-03-15', 'start_time', '10:45', 'therapist_id', f.t2));
  r := visit_create(f.on_branch, '{"name":"Test S5 Rm","phone":"+9779800099005"}', v, NULL, false);
  SELECT array_agg(id ORDER BY start_time) INTO ids FROM bookings WHERE customer_name = 'Test S5 Rm';
  vk := ids[1]; h0 := pg_temp.h(vk);
  r := visit_remove_service(ids[2], 'Customer changed mind', true);
  h1 := pg_temp.h(vk);
  PERFORM pg_temp.rec('S5-5a', 'remove_service dry_run: nothing changes, verdict change', h0 = h1 AND r->>'verdict' = 'change', format('verdict=%s hash same=%s', r->>'verdict', h0 = h1));
  r := visit_remove_service(ids[2], 'Customer changed mind', false);
  PERFORM pg_temp.rec('S5-5b', 'remove_service cancels ONE row with the reason, kept in history', (r->>'ok')::boolean AND (SELECT status::text || '/' || cancellation_reason FROM bookings WHERE id = ids[2]) = 'Cancelled/Customer changed mind'
    AND (SELECT status::text FROM bookings WHERE id = ids[1]) = 'Pending', (SELECT status::text || '/' || cancellation_reason FROM bookings WHERE id = ids[2]));
  h0 := pg_temp.h(vk);
  r := visit_remove_service(ids[1], 'x', false);
  PERFORM pg_temp.rec('S5-5c', 'remove_service on the last active row returns verdict last and changes nothing', NOT (r->>'ok')::boolean AND r->>'verdict' = 'last' AND r->>'code' = 'LAST_SERVICE' AND h0 = pg_temp.h(vk), format('verdict=%s code=%s', r->>'verdict', r->>'code'));
  PERFORM pg_temp.start(ids[1]);
  r := visit_remove_service(ids[1], 'x', false);
  PERFORM pg_temp.rec('S5-5d', 'remove_service on a started row is refused in plain words', NOT (r->>'ok')::boolean AND r->>'message' = 'Already started', format('code=%s msg=%s', r->>'code', r->>'message'));
END $$;

-- S5-6 visit_reschedule ---------------------------------------------------------------------------------------------------------------------
DO $$ DECLARE f fx; r jsonb; v jsonb; ids uuid[]; vk uuid; h0 text; h1 text; c0 int;
BEGIN
  SELECT * INTO f FROM fx;
  v := jsonb_build_array(jsonb_build_object('service_id', f.svc_a, 'date', '2027-03-16', 'start_time', '10:00', 'therapist_id', f.t1),
                         jsonb_build_object('service_id', f.svc_b, 'date', '2027-03-16', 'start_time', '10:45', 'therapist_id', f.t2),
                         jsonb_build_object('service_id', f.svc_c, 'date', '2027-03-16', 'start_time', '11:45', 'therapist_id', f.t3));
  r := visit_create(f.on_branch, '{"name":"Test S5 Mv","phone":"+9779800099006"}', v, NULL, false);
  SELECT array_agg(id ORDER BY start_time) INTO ids FROM bookings WHERE customer_name = 'Test S5 Mv';
  vk := ids[1]; h0 := pg_temp.h(vk); SELECT count(*) INTO c0 FROM bookings WHERE customer_name = 'Test S5 Mv';
  r := visit_reschedule(vk, '2027-03-17', '14:00', true);
  PERFORM pg_temp.rec('S5-6a', 'reschedule dry_run: nothing changes, 3 rows would move keeping offsets 14:00/14:45/15:45', pg_temp.h(vk) = h0 AND (r->>'ok')::boolean
    AND (SELECT string_agg(e->>'start', ',' ORDER BY e->>'start') FROM jsonb_array_elements(r->'rows') e) = '14:00,14:45,15:45', (SELECT string_agg(e->>'start', ',' ORDER BY e->>'start') FROM jsonb_array_elements(r->'rows') e));
  -- real move: staff + visit_id kept, new Pending rows, originals cancelled
  r := visit_reschedule(vk, '2027-03-17', '14:00', false);
  PERFORM pg_temp.rec('S5-6b', 'reschedule: new rows carry visit_id and same staff, originals Cancelled "Rescheduled"', (r->>'ok')::boolean
    AND (SELECT count(*) FROM bookings WHERE customer_name = 'Test S5 Mv' AND status::text = 'Pending' AND date = '2027-03-17' AND visit_id IS NOT NULL) = 3
    AND (SELECT count(*) FROM bookings WHERE customer_name = 'Test S5 Mv' AND status::text = 'Cancelled' AND cancellation_reason = 'Rescheduled' AND date = '2027-03-16') = 3
    AND (SELECT count(DISTINCT visit_id) FROM bookings WHERE customer_name = 'Test S5 Mv') = 1
    AND (SELECT string_agg(therapist_id::text, ',' ORDER BY start_time) FROM bookings WHERE customer_name = 'Test S5 Mv' AND status::text = 'Pending') = f.t1 || ',' || f.t2 || ',' || f.t3,
    (SELECT string_agg(booking_number || ' ' || date || ' ' || start_time || ' ' || status, '; ' ORDER BY date, start_time) FROM bookings WHERE customer_name = 'Test S5 Mv'));
  -- mid-way refusal: rows created while the org rule is OFF carry allows_overlap=false; a clash for row 2's staff at its NEW time must refuse all
  UPDATE organizations SET allow_staff_overlap = false WHERE slug = 'samis-import-qc';
  v := jsonb_build_array(jsonb_build_object('service_id', f.svc_a, 'date', '2027-03-16', 'start_time', '10:00', 'therapist_id', f.t1),
                         jsonb_build_object('service_id', f.svc_b, 'date', '2027-03-16', 'start_time', '10:45', 'therapist_id', f.t2),
                         jsonb_build_object('service_id', f.svc_c, 'date', '2027-03-16', 'start_time', '11:45', 'therapist_id', f.t3));
  PERFORM visit_create(f.on_branch, '{"name":"Test S5 Mv2","phone":"+9779800099016"}', v, NULL, false);
  SELECT array_agg(id ORDER BY start_time) INTO ids FROM bookings WHERE customer_name = 'Test S5 Mv2';
  vk := ids[1];
  PERFORM visit_create(f.on_branch, '{"name":"Test S5 Blocker","phone":"+9779800099007"}', jsonb_build_array(jsonb_build_object('service_id', f.svc_b, 'date', '2027-03-18', 'start_time', '09:50', 'therapist_id', f.t2)), NULL, false);
  h0 := pg_temp.h(vk);
  r := visit_reschedule(vk, '2027-03-18', '09:00', false);
  h1 := pg_temp.h(vk);
  PERFORM pg_temp.rec('S5-6c', 'reschedule: clash on row 2 (staff overlap, org rule OFF) leaves row 1 unchanged, no new rows', NOT (r->>'ok')::boolean AND h0 = h1
    AND r->'rows'->1->>'verdict' = 'block' AND (SELECT count(*) FROM bookings WHERE customer_name = 'Test S5 Mv2') = 3,
    format('code=%s msg=%s; verdicts %s; hash same=%s; rows %s', r->>'code', r->>'message', (SELECT string_agg(e->>'verdict', '/' ORDER BY e->>'start') FROM jsonb_array_elements(r->'rows') e), h0 = h1, (SELECT count(*) FROM bookings WHERE customer_name = 'Test S5 Mv2')));
  -- the same move on rows created while the org rule is ON (allows_overlap=true): allowed
  UPDATE organizations SET allow_staff_overlap = true WHERE slug = 'samis-import-qc';
  PERFORM visit_create(f.on_branch, '{"name":"Test S5 Mv3","phone":"+9779800099017"}', (SELECT jsonb_agg(e || '{"date":"2027-03-26"}'::jsonb) FROM jsonb_array_elements(v) e), NULL, false);
  PERFORM visit_create(f.on_branch, '{"name":"Test S5 Blocker2","phone":"+9779800099018"}', jsonb_build_array(jsonb_build_object('service_id', f.svc_b, 'date', '2027-03-29', 'start_time', '09:50', 'therapist_id', f.t2)), NULL, false);
  SELECT array_agg(id ORDER BY start_time) INTO ids FROM bookings WHERE customer_name = 'Test S5 Mv3';
  vk := ids[1];
  r := visit_reschedule(vk, '2027-03-29', '09:00', true);
  PERFORM pg_temp.rec('S5-6d', 'reschedule: same clash allowed when the org rule is ON (rows created ON)', (r->>'ok')::boolean, format('ok=%s verdicts %s', r->>'ok', (SELECT string_agg(e->>'verdict', '/' ORDER BY e->>'start') FROM jsonb_array_elements(r->'rows') e)));
  -- started row stays: row 1 started, rows 2-3 move keeping their offset from the first UNTOUCHED row
  PERFORM pg_temp.start(ids[1]);
  r := visit_reschedule(vk, '2027-03-30', '10:00', false);
  PERFORM pg_temp.rec('S5-6e', 'reschedule: started row kept, only untouched rows move (offset from the first untouched row)', (r->>'ok')::boolean AND (SELECT status::text FROM bookings WHERE id = ids[1]) = 'In-Progress'
    AND (SELECT string_agg(start_time::text, ',' ORDER BY start_time) FROM bookings WHERE customer_name = 'Test S5 Mv3' AND date = '2027-03-30' AND status::text = 'Pending') = '10:00:00,11:00:00',
    (SELECT string_agg((e->>'verdict') || ' ' || (e->>'start'), '; ' ORDER BY e->>'start') FROM jsonb_array_elements(r->'rows') e));
END $$;

-- S5-7 visit_apply_discount -------------------------------------------------------------------------------------------------------------------
DO $$ DECLARE f fx; r jsonb; v jsonb; ids uuid[]; vk uuid; h0 text; lines jsonb;
BEGIN
  SELECT * INTO f FROM fx;
  v := jsonb_build_array(jsonb_build_object('service_id', f.svc_a, 'date', '2027-03-22', 'start_time', '10:00', 'therapist_id', f.t1),
                         jsonb_build_object('service_id', f.svc_b, 'date', '2027-03-22', 'start_time', '10:45', 'therapist_id', f.t2),
                         jsonb_build_object('service_id', f.svc_c, 'date', '2027-03-22', 'start_time', '11:45', 'therapist_id', f.t3));
  PERFORM visit_create(f.on_branch, '{"name":"Test S5 Disc","phone":"+9779800099008"}', v, NULL, false);
  SELECT array_agg(id ORDER BY start_time) INTO ids FROM bookings WHERE customer_name = 'Test S5 Disc';
  vk := ids[1]; h0 := pg_temp.h(vk);
  -- whole-booking 7%: 1500*.07=105, 2000*.07=140, 2300*.07=161 -> total round(5800*.07)=406; remainder lands on the last row
  lines := jsonb_build_array(jsonb_build_object('booking_id', ids[1], 'type', '%', 'value', 7), jsonb_build_object('booking_id', ids[2], 'type', '%', 'value', 7), jsonb_build_object('booking_id', ids[3], 'type', '%', 'value', 7));
  r := visit_apply_discount(vk, lines, 'loyal', true);
  PERFORM pg_temp.rec('S5-7a', 'apply_discount dry_run: nothing changes', pg_temp.h(vk) = h0 AND (r->>'ok')::boolean AND (r->'totals'->>'discount_total')::numeric = 406, format('hash same=%s discount_total=%s', pg_temp.h(vk) = h0, r->'totals'->>'discount_total'));
  SELECT pg_temp.as_user('staff@samis-import-qc.test') INTO r;
  r := visit_apply_discount(vk, lines, 'loyal', false);
  PERFORM pg_temp.rec('S5-7b', 'staff 7% whole booking: approved on every row, whole rupees summing to the exact total 406', (r->>'ok')::boolean
    AND (SELECT sum(discount_amount) FROM bookings WHERE id = ANY (ids)) = 406 AND (SELECT count(*) FROM bookings WHERE id = ANY (ids) AND discount_status::text = 'approved' AND discount_amount = trunc(discount_amount)) = 3,
    (SELECT string_agg(discount_amount::text || '/' || final_amount::text || '/' || discount_status::text, '; ' ORDER BY start_time) FROM bookings WHERE id = ANY (ids)));
  -- staff over the ceiling (60% on row 2) with a valid row 1: refused, row 1 unchanged
  h0 := pg_temp.h(vk);
  r := visit_apply_discount(vk, jsonb_build_array(jsonb_build_object('booking_id', ids[1], 'type', '%', 'value', 10), jsonb_build_object('booking_id', ids[2], 'type', '%', 'value', 60)), 'x', false);
  PERFORM pg_temp.rec('S5-7c', 'staff: 60% on row 2 refused (DISCOUNT_LIMIT_EXCEEDED); row 1 unchanged', NOT (r->>'ok')::boolean AND h0 = pg_temp.h(vk) AND r->'rows'->1->>'verdict' = 'block',
    format('code=%s msg=%s; verdicts %s/%s', r->>'code', r->>'message', r->'rows'->0->>'verdict', r->'rows'->1->>'verdict'));
  -- per-service: row 1 -> 10%, row 2 -> 0 clears, row 3 untouched (not listed)
  r := visit_apply_discount(vk, jsonb_build_array(jsonb_build_object('booking_id', ids[1], 'type', '%', 'value', 10), jsonb_build_object('booking_id', ids[2], 'type', 'NPR', 'value', 0)), 'per service', false);
  PERFORM pg_temp.rec('S5-7d', 'per-service: row 1 = 10% (150), row 2 value 0 clears its discount, row 3 untouched', (r->>'ok')::boolean
    AND (SELECT discount_amount FROM bookings WHERE id = ids[1]) = 150 AND (SELECT discount_amount FROM bookings WHERE id = ids[2]) = 0 AND (SELECT discount_amount FROM bookings WHERE id = ids[3]) = 161,
    (SELECT string_agg(discount_amount::text || '/' || discount_reason, '; ' ORDER BY start_time) FROM bookings WHERE id = ANY (ids)));
  -- a paid row 3 refuses: row 1 stays as it is
  UPDATE bookings SET payment_status = 'paid' WHERE id = ids[3];
  h0 := pg_temp.h(vk);
  r := visit_apply_discount(vk, jsonb_build_array(jsonb_build_object('booking_id', ids[1], 'type', '%', 'value', 20), jsonb_build_object('booking_id', ids[3], 'type', '%', 'value', 20)), 'x', false);
  PERFORM pg_temp.rec('S5-7e', 'a paid row refuses; row 1 unchanged', NOT (r->>'ok')::boolean AND h0 = pg_temp.h(vk), format('code=%s msg=%s', r->>'code', r->>'message'));
  UPDATE bookings SET payment_status = 'unpaid' WHERE id = ids[3];
  -- no reason
  r := visit_apply_discount(vk, jsonb_build_array(jsonb_build_object('booking_id', ids[1], 'type', '%', 'value', 5)), '', false);
  PERFORM pg_temp.rec('S5-7f', 'reason is required to apply', NOT (r->>'ok')::boolean AND r->>'code' = 'DISCOUNT_REASON_REQUIRED', r->>'message');
  -- admin 100% settles at once with a zero No Charge payment
  SELECT pg_temp.as_user('admin@samis-import-qc.test') INTO r;
  r := visit_apply_discount(vk, jsonb_build_array(jsonb_build_object('booking_id', ids[2], 'type', '%', 'value', 100)), 'gift', false);
  PERFORM pg_temp.rec('S5-7g', 'admin 100%: approved, zero No Charge payment written, row paid', (r->>'ok')::boolean AND (SELECT payment_status FROM bookings WHERE id = ids[2]) = 'paid'
    AND EXISTS (SELECT 1 FROM payments WHERE booking_id = ids[2] AND amount = 0), format('ok=%s code=%s status=%s', r->>'ok', r->>'code', (SELECT payment_status FROM bookings WHERE id = ids[2])));
END $$;

-- S5-8 visit_set_staff ------------------------------------------------------------------------------------------------------------------------
DO $$ DECLARE f fx; r jsonb; v jsonb; ids uuid[]; vk uuid; h0 text;
BEGIN
  SELECT * INTO f FROM fx;
  v := jsonb_build_array(jsonb_build_object('service_id', f.svc_a, 'date', '2027-03-23', 'start_time', '10:00', 'therapist_id', f.t1),
                         jsonb_build_object('service_id', f.svc_b, 'date', '2027-03-23', 'start_time', '10:45', 'therapist_id', f.t2));
  PERFORM visit_create(f.on_branch, '{"name":"Test S5 Staff","phone":"+9779800099009"}', v, NULL, false);
  SELECT array_agg(id ORDER BY start_time) INTO ids FROM bookings WHERE customer_name = 'Test S5 Staff';
  vk := ids[1]; h0 := pg_temp.h(vk);
  r := visit_set_staff(vk, jsonb_build_array(jsonb_build_object('booking_id', ids[1], 'therapist_id', f.t3), jsonb_build_object('booking_id', ids[2], 'therapist_id', f.t1)), 'prefers quiet', true);
  PERFORM pg_temp.rec('S5-8a', 'set_staff dry_run: nothing changes', pg_temp.h(vk) = h0 AND (r->>'ok')::boolean AND (r->'totals'->>'change')::int = 2, format('hash same=%s totals %s', pg_temp.h(vk) = h0, r->'totals'));
  r := visit_set_staff(vk, jsonb_build_array(jsonb_build_object('booking_id', ids[1], 'therapist_id', f.t3), jsonb_build_object('booking_id', ids[2], 'therapist_id', f.t1)), 'prefers quiet', false);
  PERFORM pg_temp.rec('S5-8b', 'set_staff: both rows reassigned, junction rows follow, notes on both', (r->>'ok')::boolean
    AND (SELECT therapist_id FROM bookings WHERE id = ids[1]) = f.t3 AND (SELECT therapist_id FROM bookings WHERE id = ids[2]) = f.t1
    AND (SELECT therapist_id FROM booking_therapists WHERE booking_id = ids[1]) = f.t3 AND (SELECT count(*) FROM bookings WHERE id = ANY (ids) AND special_requests = 'prefers quiet') = 2,
    (SELECT string_agg(therapist_name_snapshot, ' / ' ORDER BY start_time) FROM bookings WHERE id = ANY (ids)));
  -- rows created under overlap OFF; row 2 -> a staff member already booked then => row 1 must stay
  UPDATE organizations SET allow_staff_overlap = false WHERE slug = 'samis-import-qc';
  r := visit_create(f.on_branch, '{"name":"Test S5 Staff2","phone":"+9779800099019"}', (SELECT jsonb_agg(e || '{"date":"2027-04-05"}'::jsonb) FROM jsonb_array_elements(v) e), NULL, false);
  SELECT array_agg(id ORDER BY start_time) INTO ids FROM bookings WHERE customer_name = 'Test S5 Staff2';
  vk := ids[1];
  IF vk IS NULL THEN RAISE EXCEPTION 'fixture failed: %', r; END IF;
  PERFORM visit_create(f.on_branch, '{"name":"Test S5 Busy","phone":"+9779800099010"}', jsonb_build_array(jsonb_build_object('service_id', f.svc_c, 'date', '2027-04-05', 'start_time', '10:50', 'therapist_id', f.t3)), NULL, false);
  h0 := pg_temp.h(vk);
  r := visit_set_staff(vk, jsonb_build_array(jsonb_build_object('booking_id', ids[1], 'therapist_id', f.t2), jsonb_build_object('booking_id', ids[2], 'therapist_id', f.t3)), NULL, false);
  PERFORM pg_temp.rec('S5-8c', 'set_staff: row 2 clashes (staff busy, overlap OFF) => row 1 unchanged', NOT (r->>'ok')::boolean AND h0 = pg_temp.h(vk) AND r->'rows'->1->>'verdict' = 'block',
    format('code=%s msg=%s; verdicts %s/%s; hash same=%s', r->>'code', r->>'message', r->'rows'->0->>'verdict', r->'rows'->1->>'verdict', h0 = pg_temp.h(vk)));
  UPDATE organizations SET allow_staff_overlap = true WHERE slug = 'samis-import-qc';
END $$;

-- S5-9 visit_update ----------------------------------------------------------------------------------------------------------------------------
DO $$ DECLARE f fx; r jsonb; v jsonb; ids uuid[]; vk uuid; h0 text; ch jsonb;
BEGIN
  SELECT * INTO f FROM fx;
  v := jsonb_build_array(jsonb_build_object('service_id', f.svc_a, 'date', '2027-03-24', 'start_time', '10:00', 'therapist_id', f.t1),
                         jsonb_build_object('service_id', f.svc_b, 'date', '2027-03-24', 'start_time', '10:45', 'therapist_id', f.t2));
  PERFORM visit_create(f.on_branch, '{"name":"Test S5 Upd","phone":"+9779800099011"}', v, NULL, false);
  SELECT array_agg(id ORDER BY start_time) INTO ids FROM bookings WHERE customer_name = 'Test S5 Upd';
  vk := ids[1]; h0 := pg_temp.h(vk);
  ch := jsonb_build_object('special_requests', 'window seat', 'services', jsonb_build_array(
          jsonb_build_object('booking_id', ids[1], 'start_time', '10:15', 'therapist_ids', jsonb_build_array(f.t1)),
          jsonb_build_object('booking_id', ids[2], 'start_time', '11:00', 'therapist_ids', jsonb_build_array(f.t3)),
          jsonb_build_object('booking_id', NULL, 'service_id', f.svc_c, 'start_time', '12:00', 'date', '2027-03-24', 'therapist_ids', jsonb_build_array(f.t1))));
  r := visit_update(vk, ch, NULL, true);
  PERFORM pg_temp.rec('S5-9a', 'update dry_run: nothing changes, preview lists 2 changes + 1 add', pg_temp.h(vk) = h0 AND (r->>'ok')::boolean AND jsonb_array_length(r->'rows') = 3, format('hash same=%s totals %s', pg_temp.h(vk) = h0, r->'totals'));
  r := visit_update(vk, ch, NULL, false);
  PERFORM pg_temp.rec('S5-9b', 'update: times/staff moved, third service added to the SAME visit, junction follows, notes set', (r->>'ok')::boolean
    AND (SELECT start_time FROM bookings WHERE id = ids[1]) = '10:15' AND (SELECT therapist_id FROM bookings WHERE id = ids[2]) = f.t3
    AND (SELECT start_time FROM booking_therapists WHERE booking_id = ids[1]) = '10:15' AND (SELECT therapist_id FROM booking_therapists WHERE booking_id = ids[2]) = f.t3
    AND (SELECT count(*) FROM bookings WHERE visit_id = (SELECT visit_id FROM bookings WHERE id = vk)) = 3 AND (SELECT count(*) FROM bookings WHERE customer_name = 'Test S5 Upd' AND special_requests = 'window seat') >= 2,
    (SELECT string_agg(booking_number || ' ' || start_time || ' ' || COALESCE(therapist_name_snapshot, '-'), '; ' ORDER BY start_time) FROM bookings WHERE customer_name = 'Test S5 Upd'));
  -- row 2 started: changing it is refused and the (valid) change to row 1 is rolled back with it
  SELECT array_agg(id ORDER BY start_time) INTO ids FROM bookings WHERE customer_name = 'Test S5 Upd' AND status::text <> 'Cancelled';
  PERFORM pg_temp.start(ids[2]);
  h0 := pg_temp.h(vk);
  r := visit_update(vk, jsonb_build_object('services', jsonb_build_array(
          jsonb_build_object('booking_id', ids[1], 'start_time', '10:20'), jsonb_build_object('booking_id', ids[2], 'start_time', '11:30'))), NULL, false);
  PERFORM pg_temp.rec('S5-9c', 'update: started row altered => refused with a reason on that row; row 1 change not kept', NOT (r->>'ok')::boolean AND h0 = pg_temp.h(vk) AND r->'rows'->1->>'verdict' = 'block' AND r->'rows'->1->>'reason' = 'Already started',
    format('code=%s msg=%s; row verdicts %s', r->>'code', r->>'message', (SELECT string_agg(e->>'verdict', '/') FROM jsonb_array_elements(r->'rows') e)));
  -- unchanged locked row listed as-is is fine
  r := visit_update(vk, jsonb_build_object('services', jsonb_build_array(
          jsonb_build_object('booking_id', ids[1], 'start_time', '10:20'), jsonb_build_object('booking_id', ids[2], 'start_time', '11:00', 'therapist_ids', jsonb_build_array(f.t3)))), NULL, false);
  PERFORM pg_temp.rec('S5-9d', 'update: a started row sent UNCHANGED does not block the rest', (r->>'ok')::boolean AND (SELECT start_time FROM bookings WHERE id = ids[1]) = '10:20', format('ok=%s code=%s', r->>'ok', r->>'code'));
  -- remove the third service, the rest stay
  r := visit_update(vk, jsonb_build_object('services', jsonb_build_array(jsonb_build_object('booking_id', ids[3], 'remove', true, 'remove_reason', 'not needed'))), NULL, false);
  PERFORM pg_temp.rec('S5-9e', 'update: remove a service (cancelled with reason, history kept)', (r->>'ok')::boolean AND (SELECT status::text || '/' || cancellation_reason FROM bookings WHERE id = ids[3]) = 'Cancelled/not needed', (SELECT status::text || '/' || cancellation_reason FROM bookings WHERE id = ids[3]));
  -- two consecutive rows of the SAME staff, org rule OFF: shifting both +15 min must work (no row lands on its sibling's old slot)
  UPDATE organizations SET allow_staff_overlap = false WHERE slug = 'samis-import-qc';
  r := visit_create(f.on_branch, '{"name":"Test S5 Shift15","phone":"+9779800099020"}', jsonb_build_array(
        jsonb_build_object('service_id', f.svc_a, 'date', '2027-04-06', 'start_time', '10:00', 'therapist_id', f.t1),
        jsonb_build_object('service_id', f.svc_b, 'date', '2027-04-06', 'start_time', '10:45', 'therapist_id', f.t1)), NULL, false);
  SELECT array_agg(id ORDER BY start_time) INTO ids FROM bookings WHERE customer_name = 'Test S5 Shift15';
  vk := ids[1];
  r := visit_update(vk, jsonb_build_object('services', jsonb_build_array(jsonb_build_object('booking_id', ids[1], 'start_time', '10:15'), jsonb_build_object('booking_id', ids[2], 'start_time', '11:00'))), NULL, false);
  PERFORM pg_temp.rec('S5-9h', 'update: both rows of the same staff shifted +15 min (org rule OFF) succeed, no self-clash', (r->>'ok')::boolean AND (SELECT string_agg(start_time::text, ',' ORDER BY start_time) FROM bookings WHERE id = ANY (ids)) = '10:15:00,11:00:00', format('ok=%s code=%s msg=%s', r->>'ok', r->>'code', r->>'message'));
  UPDATE organizations SET allow_staff_overlap = true WHERE slug = 'samis-import-qc';
  -- combo row: refused with a specific code (the api.js wrapper then routes it to today's single edit), nothing changed
  INSERT INTO booking_combo_items (booking_id, service_id) VALUES (ids[1], f.svc_b);
  h0 := pg_temp.h(vk);
  r := visit_update(vk, jsonb_build_object('services', jsonb_build_array(jsonb_build_object('booking_id', ids[1], 'start_time', '10:40'))), NULL, false);
  PERFORM pg_temp.rec('S5-9f', 'update: a combo row returns COMBO_USE_SINGLE_EDIT and changes nothing', NOT (r->>'ok')::boolean AND r->>'code' = 'COMBO_USE_SINGLE_EDIT' AND h0 = pg_temp.h(vk), format('code=%s msg=%s', r->>'code', r->>'message'));
  r := visit_set_staff(vk, jsonb_build_array(jsonb_build_object('booking_id', ids[1], 'therapist_id', f.t2)), NULL, false);
  PERFORM pg_temp.rec('S5-9g', 'set_staff: a combo row returns COMBO_USE_SINGLE_EDIT and changes nothing', NOT (r->>'ok')::boolean AND r->>'code' = 'COMBO_USE_SINGLE_EDIT' AND h0 = pg_temp.h(vk), format('code=%s', r->>'code'));
END $$;

-- S5-10 combo + roles + grants + OFF org single row --------------------------------------------------------------------------------------------
DO $$ DECLARE f fx; r jsonb; ids uuid[]; vk uuid;
BEGIN
  SELECT * INTO f FROM fx;
  PERFORM pg_temp.rec('S5-10a', 'grants: authenticated may execute, anon may not (all 7)',
    (SELECT bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) FROM pg_proc p WHERE p.proname IN
      ('visit_create','visit_update','visit_set_status','visit_remove_service','visit_reschedule','visit_apply_discount','visit_set_staff')),
    (SELECT count(*) FROM pg_proc p WHERE p.proname LIKE 'visit\_%')::text || ' functions');
  PERFORM pg_temp.rec('S5-10b', 'helpers _visit_* are not callable by authenticated/anon',
    (SELECT bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) FROM pg_proc p WHERE p.proname LIKE '\_visit\_%'), '');
  -- OFF org: the booking is the single row (visit_id NULL), the same calls work
  PERFORM pg_temp.as_user('admin@smoke.test');
  SELECT id INTO vk FROM bookings WHERE customer_name = 'Test S5 Solo';
  r := visit_set_status(vk, 'Cancelled', 'test', true);
  PERFORM pg_temp.rec('S5-10c', 'OFF org single row (visit_id NULL): visit_set_status works on it', (r->>'ok')::boolean AND jsonb_array_length(r->'rows') = 1, (r->'totals')::text);
  r := visit_remove_service(vk, 'test', true);
  PERFORM pg_temp.rec('S5-10d', 'OFF org single row: remove_service says last', r->>'verdict' = 'last', r->>'verdict');
  -- org scoping: ON-org admin cannot see an OFF-org booking
  PERFORM pg_temp.as_user('admin@samis-import-qc.test');
  r := visit_set_status(vk, 'Cancelled', 'test', true);
  PERFORM pg_temp.rec('S5-10e', 'other org: booking not found (org scope)', NOT (r->>'ok')::boolean AND r->>'code' = 'BOOKING_NOT_FOUND', r->>'code');
  -- viewer / no login
  PERFORM pg_temp.as_user('viewer@smoke.test');
  r := visit_set_status(vk, 'Cancelled', 'test', true);
  PERFORM pg_temp.rec('S5-10f', 'admin_viewer is refused', NOT (r->>'ok')::boolean AND r->>'code' = 'NOT_ALLOWED', r->>'code');
END $$;

-- S5-11 availability: a warn for a manager (override with reason), a block for staff ----------------------------------------------------------------
SELECT pg_temp.as_user('admin@samis-import-qc.test');
UPDATE public.organizations SET enforce_staff_availability = true WHERE slug = 'samis-import-qc';
DO $$ DECLARE f fx; r jsonb; r2 jsonb; v jsonb; c0 int; sh record;
BEGIN
  SELECT * INTO f FROM fx;
  -- a time far outside any shift: 03:00 on a normal day
  v := jsonb_build_array(jsonb_build_object('service_id', f.svc_a, 'date', '2027-03-25', 'start_time', '03:00', 'therapist_id', f.t1));
  SELECT count(*) INTO c0 FROM bookings WHERE date = '2027-03-25';
  r := visit_create(f.on_branch, '{"name":"Test S5 Shift","phone":"+9779800099012"}', v, NULL, true);
  PERFORM pg_temp.rec('S5-11a', 'admin, outside shift, no reason: verdict warn (overridable), nothing created', NOT (r->>'ok')::boolean AND r->'rows'->0->>'verdict' = 'warn' AND r->>'code' = 'NEEDS_OVERRIDE',
    format('code=%s underlying=%s msg=%s', r->>'code', r->'error'->>'underlying_code', r->>'message'));
  r2 := visit_create(f.on_branch, '{"name":"Test S5 Shift","phone":"+9779800099012"}', v, 'Early booking agreed', false);
  PERFORM pg_temp.rec('S5-11b', 'admin with a reason: created; reason not left on the row', (r2->>'ok')::boolean AND (SELECT count(*) FROM bookings WHERE customer_name = 'Test S5 Shift' AND availability_override_reason IS NULL) = 1, format('ok=%s %s', r2->>'ok', r2->>'message'));
  PERFORM pg_temp.as_user('staff@samis-import-qc.test');
  r := visit_create(f.on_branch, '{"name":"Test S5 Shift2","phone":"+9779800099013"}', v, 'trying', false);
  PERFORM pg_temp.rec('S5-11c', 'staff outside shift (even with a reason): block, never warn', NOT (r->>'ok')::boolean AND r->'rows'->0->>'verdict' = 'block' AND (SELECT count(*) FROM bookings WHERE customer_name = 'Test S5 Shift2') = 0,
    format('code=%s msg=%s', r->>'code', r->>'message'));
END $$;

-- S5-sec: ids from ANOTHER business (or another branch) are refused by every function; nothing changes ------------------------------------------------------
SELECT pg_temp.as_user('admin@samis-import-qc.test');
UPDATE public.organizations SET enforce_staff_availability = false WHERE slug = 'samis-import-qc';
DO $$ DECLARE f fx; r jsonb; v jsonb; ids uuid[]; vk uuid; h0 text; c0 int; foreign_id uuid; foreign_cust uuid; fh text; oc text[]; cat text; ot3 uuid;
BEGIN
  SELECT * INTO f FROM fx;
  SELECT id INTO foreign_id FROM bookings WHERE customer_name = 'Test S5 Solo';
  SELECT id INTO foreign_cust FROM customers WHERE org_id = (SELECT id FROM organizations WHERE slug = 'nuad-thai-spa') LIMIT 1;
  PERFORM visit_create(f.on_branch, '{"name":"Test S5 Sec","phone":"+9779800099030"}', jsonb_build_array(
      jsonb_build_object('service_id', f.svc_a, 'date', '2027-05-03', 'start_time', '10:00', 'therapist_id', f.t1),
      jsonb_build_object('service_id', f.svc_b, 'date', '2027-05-03', 'start_time', '10:45', 'therapist_id', f.t2)), NULL, false);
  SELECT array_agg(id ORDER BY start_time) INTO ids FROM bookings WHERE customer_name = 'Test S5 Sec';
  vk := ids[1]; h0 := pg_temp.h(vk); fh := pg_temp.h(foreign_id);
  SELECT count(*) INTO c0 FROM bookings WHERE date = '2027-05-04';
  -- visit_create
  r := visit_create(f.on_branch, '{"name":"Test S5 SecX","phone":"+9779800099031"}', jsonb_build_array(jsonb_build_object('service_id', f.off_svc1, 'date', '2027-05-04', 'start_time', '10:00')), NULL, false);
  PERFORM pg_temp.rec('S5-sec-1', 'visit_create: a service of ANOTHER business is refused, nothing created', NOT (r->>'ok')::boolean AND r->>'code' = 'SERVICE_NOT_IN_BUSINESS' AND (SELECT count(*) FROM bookings WHERE date = '2027-05-04') = c0 AND NOT EXISTS (SELECT 1 FROM customers WHERE phone = '+9779800099031'), format('code=%s msg=%s', r->>'code', r->>'message'));
  r := visit_create(f.on_branch, '{"name":"Test S5 SecX","phone":"+9779800099031"}', jsonb_build_array(jsonb_build_object('service_id', f.svc_a, 'date', '2027-05-04', 'start_time', '10:00', 'therapist_id', f.ot1)), NULL, false);
  PERFORM pg_temp.rec('S5-sec-2', 'visit_create: a staff member of ANOTHER business is refused', NOT (r->>'ok')::boolean AND r->>'code' = 'STAFF_NOT_IN_BUSINESS' AND (SELECT count(*) FROM bookings WHERE date = '2027-05-04') = c0, format('code=%s msg=%s', r->>'code', r->>'message'));
  r := visit_create(f.on_branch, jsonb_build_object('customer_id', foreign_cust, 'name', 'x'), jsonb_build_array(jsonb_build_object('service_id', f.svc_a, 'date', '2027-05-04', 'start_time', '10:00')), NULL, false);
  PERFORM pg_temp.rec('S5-sec-3', 'visit_create: a customer_id of ANOTHER business is refused', NOT (r->>'ok')::boolean AND r->>'code' = 'CUSTOMER_NOT_IN_BUSINESS' AND (SELECT count(*) FROM bookings WHERE date = '2027-05-04') = c0, format('code=%s msg=%s', r->>'code', r->>'message'));
  -- service restricted to another branch / excluded category
  INSERT INTO branch_service_links (branch_id, service_id) VALUES (f.off_branch, f.svc_a);
  r := visit_create(f.on_branch, '{"name":"Test S5 SecX","phone":"+9779800099031"}', jsonb_build_array(jsonb_build_object('service_id', f.svc_a, 'date', '2027-05-04', 'start_time', '10:00')), NULL, false);
  PERFORM pg_temp.rec('S5-sec-4', 'visit_create: a service restricted to ANOTHER branch (branch_service_links) is refused', NOT (r->>'ok')::boolean AND r->>'code' = 'SERVICE_NOT_AT_BRANCH' AND (SELECT count(*) FROM bookings WHERE date = '2027-05-04') = c0, format('code=%s msg=%s', r->>'code', r->>'message'));
  DELETE FROM branch_service_links WHERE branch_id = f.off_branch AND service_id = f.svc_a;
  SELECT category INTO cat FROM services WHERE id = f.svc_a;
  SELECT excluded_service_categories INTO oc FROM branches WHERE id = f.on_branch;
  UPDATE branches SET excluded_service_categories = ARRAY[cat] WHERE id = f.on_branch;
  r := visit_create(f.on_branch, '{"name":"Test S5 SecX","phone":"+9779800099031"}', jsonb_build_array(jsonb_build_object('service_id', f.svc_a, 'date', '2027-05-04', 'start_time', '10:00')), NULL, false);
  PERFORM pg_temp.rec('S5-sec-5', 'visit_create: a service whose category the branch excludes is refused', NOT (r->>'ok')::boolean AND r->>'code' = 'SERVICE_NOT_AT_BRANCH', format('category=%s code=%s', cat, r->>'code'));
  UPDATE branches SET excluded_service_categories = oc WHERE id = f.on_branch;
  -- visit_update: change service / staff / add service from another business; row 1 change must not stay
  r := visit_update(vk, jsonb_build_object('services', jsonb_build_array(jsonb_build_object('booking_id', ids[1], 'start_time', '10:10'), jsonb_build_object('booking_id', ids[2], 'service_id', f.off_svc1))), NULL, false);
  PERFORM pg_temp.rec('S5-sec-6a', 'visit_update: changing a row to a service of ANOTHER business is refused, row 1 unchanged', NOT (r->>'ok')::boolean AND r->>'code' = 'SERVICE_NOT_IN_BUSINESS' AND pg_temp.h(vk) = h0, format('code=%s hash same=%s', r->>'code', pg_temp.h(vk) = h0));
  r := visit_update(vk, jsonb_build_object('services', jsonb_build_array(jsonb_build_object('booking_id', ids[1], 'start_time', '10:10'), jsonb_build_object('booking_id', ids[2], 'therapist_ids', jsonb_build_array(f.ot1)))), NULL, false);
  PERFORM pg_temp.rec('S5-sec-6b', 'visit_update: assigning a staff member of ANOTHER business is refused, row 1 unchanged', NOT (r->>'ok')::boolean AND r->>'code' = 'STAFF_NOT_IN_BUSINESS' AND pg_temp.h(vk) = h0, format('code=%s hash same=%s', r->>'code', pg_temp.h(vk) = h0));
  r := visit_update(vk, jsonb_build_object('services', jsonb_build_array(jsonb_build_object('booking_id', NULL, 'service_id', f.off_svc1, 'date', '2027-05-03', 'start_time', '14:00'))), NULL, false);
  PERFORM pg_temp.rec('S5-sec-6c', 'visit_update: ADDING a service of ANOTHER business is refused', NOT (r->>'ok')::boolean AND r->>'code' = 'SERVICE_NOT_IN_BUSINESS' AND pg_temp.h(vk) = h0, format('code=%s', r->>'code'));
  -- visit_set_staff
  r := visit_set_staff(vk, jsonb_build_array(jsonb_build_object('booking_id', ids[1], 'therapist_id', f.t3), jsonb_build_object('booking_id', ids[2], 'therapist_id', f.ot1)), NULL, false);
  PERFORM pg_temp.rec('S5-sec-7', 'visit_set_staff: a staff member of ANOTHER business is refused, row 1 unchanged', NOT (r->>'ok')::boolean AND r->>'code' = 'STAFF_NOT_IN_BUSINESS' AND pg_temp.h(vk) = h0, format('code=%s hash same=%s', r->>'code', pg_temp.h(vk) = h0));
  -- every function on a booking id of ANOTHER business: not found, the foreign booking untouched
  r := visit_reschedule(foreign_id, '2027-05-05', '10:00', false);
  PERFORM pg_temp.rec('S5-sec-8a', 'visit_reschedule: booking of ANOTHER business = BOOKING_NOT_FOUND, untouched', r->>'code' = 'BOOKING_NOT_FOUND' AND pg_temp.h(foreign_id) = fh, r->>'code');
  r := visit_remove_service(foreign_id, 'x', false);
  PERFORM pg_temp.rec('S5-sec-8b', 'visit_remove_service: booking of ANOTHER business = BOOKING_NOT_FOUND, untouched', r->>'code' = 'BOOKING_NOT_FOUND' AND pg_temp.h(foreign_id) = fh, r->>'code');
  r := visit_apply_discount(foreign_id, jsonb_build_array(jsonb_build_object('booking_id', foreign_id, 'type', '%', 'value', 10)), 'x', false);
  PERFORM pg_temp.rec('S5-sec-8c', 'visit_apply_discount: booking of ANOTHER business = BOOKING_NOT_FOUND, untouched', r->>'code' = 'BOOKING_NOT_FOUND' AND pg_temp.h(foreign_id) = fh, r->>'code');
  r := visit_apply_discount(vk, jsonb_build_array(jsonb_build_object('booking_id', foreign_id, 'type', '%', 'value', 10)), 'x', false);
  PERFORM pg_temp.rec('S5-sec-8d', 'visit_apply_discount: own booking key + a line naming a booking of ANOTHER business = refused, untouched', NOT (r->>'ok')::boolean AND pg_temp.h(foreign_id) = fh AND pg_temp.h(vk) = h0, r->>'code');
  r := visit_set_staff(foreign_id, jsonb_build_array(jsonb_build_object('booking_id', foreign_id, 'therapist_id', f.t1)), NULL, false);
  PERFORM pg_temp.rec('S5-sec-8e', 'visit_set_staff: booking of ANOTHER business = BOOKING_NOT_FOUND, untouched', r->>'code' = 'BOOKING_NOT_FOUND' AND pg_temp.h(foreign_id) = fh, r->>'code');
  r := visit_update(foreign_id, '{"special_requests":"hacked"}', NULL, false);
  PERFORM pg_temp.rec('S5-sec-8f', 'visit_update: booking of ANOTHER business = BOOKING_NOT_FOUND, untouched', r->>'code' = 'BOOKING_NOT_FOUND' AND pg_temp.h(foreign_id) = fh, r->>'code');
  r := visit_set_status(foreign_id, 'Cancelled', 'x', false);
  PERFORM pg_temp.rec('S5-sec-8g', 'visit_set_status: booking of ANOTHER business = BOOKING_NOT_FOUND, untouched', r->>'code' = 'BOOKING_NOT_FOUND' AND pg_temp.h(foreign_id) = fh, r->>'code');
  -- staff of the same business but ANOTHER branch (Nuad has two branches): refused
  PERFORM pg_temp.as_user('admin@smoke.test');
  r := visit_create('f495ef5b-b8a7-470c-b81a-e022c7b27ead', '{"name":"Test S5 SecY","phone":"+9779800099032"}', jsonb_build_array(jsonb_build_object('service_id', f.off_svc1, 'date', '2027-05-04', 'start_time', '10:00', 'therapist_id', f.ot1, 'room_id', 'none')), NULL, false);
  PERFORM pg_temp.rec('S5-sec-9', 'visit_create: staff of the same business but ANOTHER branch (no transfer) is refused', NOT (r->>'ok')::boolean AND r->>'code' = 'STAFF_NOT_IN_BRANCH' AND NOT EXISTS (SELECT 1 FROM bookings WHERE customer_name = 'Test S5 SecY'), format('code=%s msg=%s', r->>'code', r->>'message'));
  -- approver of ANOTHER business: staff limit lowered to 15% for this test only (rolls back), so a 30% line becomes a request
  PERFORM pg_temp.as_user('admin@samis-import-qc.test');
  CREATE OR REPLACE FUNCTION public._visit_discount_limit(p_role user_role) RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public'
    AS $f$ SELECT CASE p_role::text WHEN 'staff' THEN 0.15 WHEN 'manager' THEN 1.00 WHEN 'admin' THEN 1.00 ELSE 0 END $f$;
  UPDATE users SET pin = '1234' WHERE email IN ('admin@samis-import-qc.test', 'admin@smoke.test');
  PERFORM pg_temp.as_user('staff@samis-import-qc.test');
  r := visit_apply_discount(vk, jsonb_build_array(jsonb_build_object('booking_id', ids[1], 'type', '%', 'value', 30)), 'big', false, (SELECT id FROM users WHERE email = 'admin@smoke.test'));
  PERFORM pg_temp.rec('S5-sec-10a', 'visit_apply_discount: an approver of ANOTHER business is refused (APPROVER_NOT_VALID), nothing changes', NOT (r->>'ok')::boolean AND r->>'code' = 'APPROVER_NOT_VALID' AND pg_temp.h(vk) = h0, format('code=%s msg=%s', r->>'code', r->>'message'));
  r := visit_apply_discount(vk, jsonb_build_array(jsonb_build_object('booking_id', ids[1], 'type', '%', 'value', 30)), 'big', false, (SELECT id FROM users WHERE email = 'admin@samis-import-qc.test'));
  PERFORM pg_temp.rec('S5-sec-10b', 'visit_apply_discount: the same-business admin approver is accepted, the line goes pending to them', (r->>'ok')::boolean AND (SELECT discount_status::text FROM bookings WHERE id = ids[1]) = 'pending'
    AND (SELECT discount_requested_to FROM bookings WHERE id = ids[1]) = (SELECT id FROM users WHERE email = 'admin@samis-import-qc.test'), format('ok=%s code=%s status=%s', r->>'ok', r->>'code', (SELECT discount_status::text FROM bookings WHERE id = ids[1])));
END $$;

SELECT n || ' | ' || what || ' | ' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' | ' || COALESCE(evidence, '') FROM res ORDER BY n;
SELECT 'FAILS: ' || count(*) FILTER (WHERE NOT ok) || ' of ' || count(*) FROM res;
ROLLBACK;
