-- SQL checks for migrations 316-323 (staff availability rule, ZNLY-100). LOCAL DB only; everything rolls back. Run:
--   psql "postgresql://postgres:postgres@127.0.0.1:56422/postgres" -v ON_ERROR_STOP=1 -f supabase/checks/check-staff-availability.sql
-- Needs the local users from supabase/seed.sql + temp_ss/seed/local-demo-seed.sql (admin/manager/staff @local.test, branch b...01).
-- Bookings take their end from the service, so the fixtures use a 60-minute service with no staff allowlist.
-- All dates are in 2030 (Mon 2030-03-04). Each check raises 'FAIL <label>' on the first mismatch.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE _r(label text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.as_user(p_id uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated')::text, true) $$;

-- run SQL that must succeed
CREATE FUNCTION pg_temp.ok(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL %: expected success, got % (%)', p_label, SQLERRM, SQLSTATE;
  END;
  DELETE FROM public.bookings WHERE customer_name = 'ZZ Avail';
  INSERT INTO _r VALUES (p_label);
END $$;

-- run SQL that must fail with a message starting with p_code (or SQLSTATE = p_code)
CREATE FUNCTION pg_temp.err(p_label text, p_code text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_failed boolean := false;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    IF SQLERRM NOT LIKE p_code || '%' AND SQLSTATE <> p_code THEN
      RAISE EXCEPTION 'FAIL %: expected %, got % (%)', p_label, p_code, SQLERRM, SQLSTATE;
    END IF;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL %: expected %, but it succeeded', p_label, p_code; END IF;
  DELETE FROM public.bookings WHERE customer_name = 'ZZ Avail';
  INSERT INTO _r VALUES (p_label);
END $$;

CREATE FUNCTION pg_temp.assert(p_label text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', p_label; END IF;
  INSERT INTO _r VALUES (p_label);
END $$;

CREATE FUNCTION pg_temp.bk(th uuid, d date, s time, e time, reason text DEFAULT NULL,
                           br uuid DEFAULT 'b0000000-0000-0000-0000-000000000001') RETURNS text LANGUAGE sql AS $$
  SELECT format($f$INSERT INTO public.bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date,
      start_time, end_time, status, base_amount, discount_amount, final_amount, payment_status, created_by, availability_override_reason)
    VALUES (%L, 'a0000000-0000-0000-0000-000000000005', %L, %L, 'ZZ Avail', '+9779800099999', %L, %L, %L, 'Confirmed', 1000, 0, 1000, 'unpaid', %L, %L)$f$,
    br, current_setting('t.svc'), th, d, s, e, 'e0000000-0000-0000-0000-000000000001', reason) $$;

CREATE FUNCTION pg_temp.mk_th(p_name text) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.therapists (branch_id, name, gender, org_id, is_active, is_service_staff)
  SELECT 'b0000000-0000-0000-0000-000000000001', p_name, gender, org_id, true, true FROM public.therapists LIMIT 1
  RETURNING id $$;

CREATE FUNCTION pg_temp.mk_hours(p_th uuid, p_dow int, p_s time, p_e time, p_brk_s time DEFAULT NULL, p_brk_e time DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.therapist_working_hours (therapist_id, branch_id, day_of_week, start_time, end_time, is_day_off)
  VALUES (p_th, 'b0000000-0000-0000-0000-000000000001', p_dow, p_s, p_e, p_s IS NULL) RETURNING id INTO v_id;
  IF p_brk_s IS NOT NULL THEN
    INSERT INTO public.therapist_working_hours_breaks (working_hours_id, name, start_time, end_time) VALUES (v_id, 'Lunch', p_brk_s, p_brk_e);
  END IF;
END $$;

-- ================= setup =================
SELECT pg_temp.as_user('e0000000-0000-0000-0000-000000000001');
SELECT set_config('t.svc', (SELECT id::text FROM public.services WHERE duration_minutes = 60 AND id NOT IN (SELECT service_id FROM public.service_therapists) ORDER BY id LIMIT 1), true);
SELECT set_config('t.org', (SELECT org_id::text FROM public.branches WHERE id = 'b0000000-0000-0000-0000-000000000001'), true);
SELECT set_config('t.th', pg_temp.mk_th('ZZ Avail Main')::text, true);       -- weekly hours + breaks
SELECT set_config('t.th0', pg_temp.mk_th('ZZ Avail NoHours')::text, true);   -- no hours rows at all
SELECT set_config('t.thx', pg_temp.mk_th('ZZ Avail Other')::text, true);     -- companion / overlap partner
UPDATE public.organizations SET enforce_staff_availability = true WHERE id = current_setting('t.org')::uuid;
UPDATE public.rooms SET capacity = 100 WHERE id = 'a0000000-0000-0000-0000-000000000005';  -- room capacity must not mask the availability codes

-- Main: Mon 10:00-20:00 break 14:00-14:30 | Tue day off | Wed nothing set | Thu 08:00-22:00 (branch is 09:00-21:00)
SELECT pg_temp.mk_hours(current_setting('t.th')::uuid, 0, '10:00', '20:00', '14:00', '14:30');
SELECT pg_temp.mk_hours(current_setting('t.th')::uuid, 1, NULL, NULL);
SELECT pg_temp.mk_hours(current_setting('t.th')::uuid, 3, '08:00', '22:00');
-- roster change Mon 2030-03-11: 11:00-20:00 with break 15:00-15:30; day-off roster Mon 2030-03-18
WITH ro AS (INSERT INTO public.staff_roster_overrides (therapist_id, branch_id, override_date, start_time, end_time, is_day_off)
            VALUES (current_setting('t.th')::uuid, 'b0000000-0000-0000-0000-000000000001', '2030-03-11', '11:00', '20:00', false) RETURNING id)
INSERT INTO public.staff_roster_override_breaks (roster_override_id, name, start_time, end_time) SELECT id, 'Late lunch', '15:00', '15:30' FROM ro;
INSERT INTO public.staff_roster_overrides (therapist_id, branch_id, override_date, is_day_off)
VALUES (current_setting('t.th')::uuid, 'b0000000-0000-0000-0000-000000000001', '2030-03-18', true);

-- ================= 1. shift, breaks, edges =================
SELECT pg_temp.ok('shift: inside the shift',        pg_temp.bk(current_setting('t.th')::uuid, '2030-03-04', '10:00', '11:00'));
SELECT pg_temp.err('shift: before start',           'OFF_SHIFT', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-04', '09:00', '10:30'));
SELECT pg_temp.ok('shift: ends exactly at shift end', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-04', '19:00', '20:00'));
SELECT pg_temp.err('shift: runs past shift end',    'OFF_SHIFT', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-04', '19:30', '20:30'));
SELECT pg_temp.ok('break: ends exactly at break start (14:00)', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-04', '13:00', '14:00'));
SELECT pg_temp.err('break: 14:00 start',           'ON_BREAK', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-04', '14:00', '15:00'));
SELECT pg_temp.err('break: 13:59 start',           'ON_BREAK', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-04', '13:59', '14:59'));
SELECT pg_temp.err('break: ends 14:01',            'ON_BREAK', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-04', '13:01', '14:01'));
SELECT pg_temp.ok('break: starts exactly at break end (14:30)', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-04', '14:30', '15:30'));
SELECT pg_temp.err('break: 14:29 start',          'ON_BREAK', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-04', '14:29', '15:30'));
SELECT pg_temp.err('weekly day off (Tue)',         'OFF_SHIFT', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-05', '12:00', '13:00'));
SELECT pg_temp.ok('no row for the weekday (Wed) = branch hours only: 09:00 open', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-06', '09:00', '10:00'));
SELECT pg_temp.err('no row for the weekday (Wed): before branch opening', 'OFF_SHIFT', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-06', '08:00', '09:00'));
SELECT pg_temp.ok('no hours rows at all = branch hours only: 20:00-21:00 open', pg_temp.bk(current_setting('t.th0')::uuid, '2030-03-04', '20:00', '21:00'));
SELECT pg_temp.err('no hours rows at all: before branch opening', 'OFF_SHIFT', pg_temp.bk(current_setting('t.th0')::uuid, '2030-03-04', '08:00', '09:00'));
SELECT pg_temp.err('no hours rows at all: past branch closing',   'OFF_SHIFT', pg_temp.bk(current_setting('t.th0')::uuid, '2030-03-04', '20:30', '21:30'));
SELECT pg_temp.err('branch hours intersect: Thu 08:00 shift vs 09:00 branch open', 'OFF_SHIFT', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-07', '08:00', '09:30'));
SELECT pg_temp.err('branch hours intersect: Thu past 21:00 close', 'OFF_SHIFT', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-07', '20:30', '21:30'));
SELECT pg_temp.ok('branch hours intersect: Thu 09:00-10:00', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-07', '09:00', '10:00'));

-- ================= 2. roster change wins =================
SELECT pg_temp.err('roster: before the changed start',       'OFF_SHIFT', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-11', '10:30', '11:30'));
SELECT pg_temp.ok('roster: weekly break ignored on a roster date', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-11', '14:00', '15:00'));
SELECT pg_temp.err('roster: its own break',                  'ON_BREAK', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-11', '15:00', '16:00'));
SELECT pg_temp.ok('roster: inside the changed shift',        pg_temp.bk(current_setting('t.th')::uuid, '2030-03-11', '11:00', '12:00'));
SELECT pg_temp.err('roster: day off wins over weekly hours', 'OFF_SHIFT', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-18', '12:00', '13:00'));

-- ================= 3. leave: full, half (split rule, midpoint rule, explicit times) =================
INSERT INTO public.therapist_attendance (branch_id, therapist_id, date, status)
VALUES ('b0000000-0000-0000-0000-000000000001', current_setting('t.th')::uuid, '2030-03-08', 'Leave'),
       ('b0000000-0000-0000-0000-000000000001', current_setting('t.th')::uuid, '2030-03-25', '1st-Half Day'),
       ('b0000000-0000-0000-0000-000000000001', current_setting('t.th')::uuid, '2030-04-01', '2nd-Half Day');
SELECT pg_temp.err('leave: full day',                       'ON_LEAVE', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-08', '12:00', '13:00'));
SELECT pg_temp.err('half day 1st: off 10:00-14:00 (split = longest break start)', 'ON_LEAVE', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-25', '11:00', '12:00'));
SELECT pg_temp.err('half day 1st: overlaps the split',      'ON_LEAVE', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-25', '13:00', '14:30'));
SELECT pg_temp.ok('half day 1st: afternoon is open',        pg_temp.bk(current_setting('t.th')::uuid, '2030-03-25', '14:30', '15:30'));
SELECT pg_temp.ok('half day 2nd: morning is open',          pg_temp.bk(current_setting('t.th')::uuid, '2030-04-01', '11:00', '12:00'));
SELECT pg_temp.err('half day 2nd: off 14:00-20:00',         'ON_LEAVE', pg_temp.bk(current_setting('t.th')::uuid, '2030-04-01', '15:00', '16:00'));
-- midpoint rule (no break): roster 10:00-19:00 -> split 14:30
INSERT INTO public.staff_roster_overrides (therapist_id, branch_id, override_date, start_time, end_time, is_day_off)
VALUES (current_setting('t.th')::uuid, 'b0000000-0000-0000-0000-000000000001', '2030-04-08', '10:00', '19:00', false);
INSERT INTO public.therapist_attendance (branch_id, therapist_id, date, status)
VALUES ('b0000000-0000-0000-0000-000000000001', current_setting('t.th')::uuid, '2030-04-08', '1st-Half Day');
SELECT pg_temp.assert('half day midpoint rule: off 10:00-14:30',
  (SELECT off->0->>'start' = '10:00' AND off->0->>'end' = '14:30' FROM (SELECT public.therapist_shift_for(current_setting('t.th')::uuid, '2030-04-08')->'off' AS off) s));
SELECT pg_temp.ok('half day midpoint rule: 14:30 open',     pg_temp.bk(current_setting('t.th')::uuid, '2030-04-08', '14:30', '15:30'));
-- explicit times win and must sit inside the shift
UPDATE public.therapist_attendance SET off_start = '12:00', off_end = '13:00'
 WHERE therapist_id = current_setting('t.th')::uuid AND date = '2030-04-08';
SELECT pg_temp.err('half day explicit: 12:15 is off',       'ON_LEAVE', pg_temp.bk(current_setting('t.th')::uuid, '2030-04-08', '12:15', '12:45'));
SELECT pg_temp.ok('half day explicit: split-rule hours no longer off', pg_temp.bk(current_setting('t.th')::uuid, '2030-04-08', '10:00', '11:00'));
SELECT pg_temp.err('half day explicit: outside the shift refused', 'HALF_DAY_OUTSIDE_SHIFT',
  $q$UPDATE public.therapist_attendance SET off_start = '08:00', off_end = '12:00' WHERE therapist_id = current_setting('t.th')::uuid AND date = '2030-04-08'$q$);

-- ================= 4. manual blocks (therapist + whole location) =================
INSERT INTO public.manual_blocks (org_id, branch_id, therapist_id, block_date, start_time, duration_minutes, description)
VALUES (current_setting('t.org')::uuid, 'b0000000-0000-0000-0000-000000000001', current_setting('t.th')::uuid, '2030-04-15', '16:00', 60, 'training');
INSERT INTO public.manual_blocks (org_id, branch_id, block_date, start_time, duration_minutes, description)
VALUES (current_setting('t.org')::uuid, 'b0000000-0000-0000-0000-000000000001', '2030-04-22', '18:00', 60, 'whole location');
INSERT INTO public.manual_blocks (org_id, branch_id, therapist_id, block_date, start_time, duration_minutes, is_cancelled)
VALUES (current_setting('t.org')::uuid, 'b0000000-0000-0000-0000-000000000001', current_setting('t.th')::uuid, '2030-04-29', '12:00', 60, true);
SELECT pg_temp.err('block: therapist block',                'BLOCKED', pg_temp.bk(current_setting('t.th')::uuid, '2030-04-15', '15:30', '16:30'));
SELECT pg_temp.ok('block: just after it',                   pg_temp.bk(current_setting('t.th')::uuid, '2030-04-15', '17:00', '18:00'));
SELECT pg_temp.err('block: whole-location block',           'BLOCKED', pg_temp.bk(current_setting('t.th')::uuid, '2030-04-22', '18:30', '19:30'));
SELECT pg_temp.ok('block: cancelled block ignored',         pg_temp.bk(current_setting('t.th')::uuid, '2030-04-29', '12:00', '13:00'));

-- ================= 5. transfer window: home vs destination =================
SELECT set_config('t.thT', pg_temp.mk_th('ZZ Avail Transfer')::text, true);
INSERT INTO public.staff_transfers (therapist_id, org_id, from_branch_id, to_branch_id, effective_date, start_time, revert_at, applied)
VALUES (current_setting('t.thT')::uuid, current_setting('t.org')::uuid, 'b0000000-0000-0000-0000-000000000001',
        '0cdcc3e7-9e86-45f7-a282-6062b729d1e6', '2030-05-06', '12:00', '2030-05-06 18:00+05:45', true);
SELECT pg_temp.ok('transfer: home before the window',       pg_temp.bk(current_setting('t.thT')::uuid, '2030-05-06', '11:00', '12:00'));
SELECT pg_temp.err('transfer: home during the window',      'OTHER_BRANCH', pg_temp.bk(current_setting('t.thT')::uuid, '2030-05-06', '13:00', '14:00'));
SELECT pg_temp.ok('transfer: destination during the window', pg_temp.bk(current_setting('t.thT')::uuid, '2030-05-06', '13:00', '14:00', NULL, '0cdcc3e7-9e86-45f7-a282-6062b729d1e6'));
SELECT pg_temp.ok('transfer: home after the revert',        pg_temp.bk(current_setting('t.thT')::uuid, '2030-05-06', '18:30', '19:30'));

-- ================= 6. overlap, companion, combo =================
INSERT INTO public.bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, status, base_amount, discount_amount, final_amount, payment_status, created_by)
VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', current_setting('t.svc')::uuid, current_setting('t.thx')::uuid, 'ZZ Keep', '+9779800099998',
        '2030-06-03', '10:00', '11:00', 'Confirmed', 1000, 0, 1000, 'unpaid', 'e0000000-0000-0000-0000-000000000001');
SELECT pg_temp.err('overlap: own booking',                  'OVERLAP', pg_temp.bk(current_setting('t.thx')::uuid, '2030-06-03', '10:30', '11:30'));
SELECT pg_temp.ok('overlap: back to back',                  pg_temp.bk(current_setting('t.thx')::uuid, '2030-06-03', '11:00', '12:00'));
UPDATE public.bookings SET status = 'Cancelled' WHERE customer_name = 'ZZ Keep';
SELECT pg_temp.ok('overlap: cancelled booking ignored',     pg_temp.bk(current_setting('t.thx')::uuid, '2030-06-03', '10:30', '11:30'));
UPDATE public.bookings SET status = 'Confirmed' WHERE customer_name = 'ZZ Keep';
-- companion therapist on another booking (th0 main, thx companion)
INSERT INTO public.bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, status, base_amount, discount_amount, final_amount, payment_status, created_by)
VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', current_setting('t.svc')::uuid, current_setting('t.th0')::uuid, 'ZZ Couple', '+9779800099997',
        '2030-06-03', '10:30', '11:30', 'Confirmed', 1000, 0, 1000, 'unpaid', 'e0000000-0000-0000-0000-000000000001');
SELECT pg_temp.err('companion junction insert: overlap', 'OVERLAP',
  format($q$INSERT INTO public.booking_therapists (booking_id, therapist_id) SELECT id, %L FROM public.bookings WHERE customer_name = 'ZZ Couple'$q$, current_setting('t.thx')));
SELECT pg_temp.err('companion junction insert: in a break (main therapist, Mon 14:00)', 'ON_BREAK',
  format($q$INSERT INTO public.booking_therapists (booking_id, therapist_id, start_time, end_time) SELECT id, %L, '14:00', '14:30' FROM public.bookings WHERE customer_name = 'ZZ Couple'$q$, current_setting('t.th')));
-- junction UPDATE: a valid companion row moved into an overlap
DELETE FROM public.bookings WHERE customer_name = 'ZZ Keep';
INSERT INTO public.booking_therapists (booking_id, therapist_id, start_time, end_time)
SELECT id, current_setting('t.thx')::uuid, '12:00', '12:30' FROM public.bookings WHERE customer_name = 'ZZ Couple';
INSERT INTO public.bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, status, base_amount, discount_amount, final_amount, payment_status, created_by)
VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', current_setting('t.svc')::uuid, current_setting('t.thx')::uuid, 'ZZ Keep', '+9779800099998',
        '2030-06-03', '13:00', '14:00', 'Confirmed', 1000, 0, 1000, 'unpaid', 'e0000000-0000-0000-0000-000000000001');
SELECT pg_temp.err('companion junction update: moved into an overlap', 'OVERLAP',
  $q$UPDATE public.booking_therapists SET start_time = '13:15', end_time = '13:45' WHERE therapist_id = current_setting('t.thx')::uuid AND booking_id = (SELECT id FROM public.bookings WHERE customer_name = 'ZZ Couple')$q$);
-- combo item
SELECT pg_temp.err('combo item insert: overlap', 'OVERLAP',
  format($q$INSERT INTO public.booking_combo_items (booking_id, service_id, therapist_id, date, start_time, end_time)
    SELECT id, %L, %L, '2030-06-03', '13:30', '14:30' FROM public.bookings WHERE customer_name = 'ZZ Couple'$q$, current_setting('t.svc'), current_setting('t.thx')));
SELECT pg_temp.err('combo item insert: off shift (Mon 09:00)', 'OFF_SHIFT',
  format($q$INSERT INTO public.booking_combo_items (booking_id, service_id, therapist_id, date, start_time, end_time)
    SELECT id, %L, %L, '2030-03-04', '09:00', '09:30' FROM public.bookings WHERE customer_name = 'ZZ Couple'$q$, current_setting('t.svc'), current_setting('t.th')));
INSERT INTO public.booking_combo_items (booking_id, service_id, therapist_id, date, start_time, end_time)
SELECT id, current_setting('t.svc')::uuid, current_setting('t.th')::uuid, '2030-03-04', '15:00', '15:30' FROM public.bookings WHERE customer_name = 'ZZ Couple';
SELECT pg_temp.err('combo item update: into a break', 'ON_BREAK',
  $q$UPDATE public.booking_combo_items SET start_time = '14:00', end_time = '14:30' WHERE therapist_id = current_setting('t.th')::uuid$q$);
DELETE FROM public.bookings WHERE customer_name IN ('ZZ Keep', 'ZZ Couple');

-- ================= 7. every write path on bookings =================
INSERT INTO public.bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, status, base_amount, discount_amount, final_amount, payment_status, created_by)
VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', current_setting('t.svc')::uuid, current_setting('t.th')::uuid, 'ZZ Move', '+9779800099996',
        '2030-03-04', '11:00', '12:00', 'Confirmed', 1000, 0, 1000, 'unpaid', 'e0000000-0000-0000-0000-000000000001');
SELECT pg_temp.err('update date to a leave day',        'ON_LEAVE',  $q$UPDATE public.bookings SET date = '2030-03-08' WHERE customer_name = 'ZZ Move'$q$);
SELECT pg_temp.err('update start/end into a break',     'ON_BREAK',  $q$UPDATE public.bookings SET start_time = '14:00', end_time = '15:00' WHERE customer_name = 'ZZ Move'$q$);
SELECT pg_temp.err('update start so the end runs past the shift',    'OFF_SHIFT', $q$UPDATE public.bookings SET end_time = '20:30', start_time = '19:30' WHERE customer_name = 'ZZ Move'$q$);
SELECT pg_temp.err('update therapist to one with overlap/other rule', 'OFF_SHIFT',
  format($q$UPDATE public.bookings SET therapist_id = %L, date = '2030-03-05' WHERE customer_name = 'ZZ Move'$q$, current_setting('t.th')));
SELECT pg_temp.err('update branch into the transfer window', 'OTHER_BRANCH',
  format($q$UPDATE public.bookings SET therapist_id = %L, date = '2030-05-06', start_time = '13:00', end_time = '14:00' WHERE customer_name = 'ZZ Move'$q$, current_setting('t.thT')));
-- switch off -> out-of-hours booking exists; switch on -> only status/payment/notes/discount updates must still pass
UPDATE public.organizations SET enforce_staff_availability = false WHERE id = current_setting('t.org')::uuid;
UPDATE public.bookings SET start_time = '14:00', end_time = '15:00' WHERE customer_name = 'ZZ Move';
UPDATE public.organizations SET enforce_staff_availability = true WHERE id = current_setting('t.org')::uuid;
SELECT pg_temp.ok('out-of-hours booking: status change', $q$UPDATE public.bookings SET status = 'In-Progress' WHERE customer_name = 'ZZ Move'$q$);
SELECT pg_temp.ok('out-of-hours booking: notes',          $q$UPDATE public.bookings SET special_requests = 'note' WHERE customer_name = 'ZZ Move'$q$);
SELECT pg_temp.ok('out-of-hours booking: discount',       $q$UPDATE public.bookings SET discount_amount = 100, final_amount = 900 WHERE customer_name = 'ZZ Move'$q$);
SELECT pg_temp.ok('out-of-hours booking: payment status', $q$UPDATE public.bookings SET payment_status = 'paid' WHERE customer_name = 'ZZ Move'$q$);
SELECT pg_temp.ok('out-of-hours booking: re-saving the same date/time (no-op)', $q$UPDATE public.bookings SET date = date, start_time = start_time, end_time = end_time WHERE customer_name = 'ZZ Move'$q$);
DELETE FROM public.bookings WHERE customer_name = 'ZZ Move';
INSERT INTO public.bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, status, base_amount, discount_amount, final_amount, payment_status, created_by)
VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', current_setting('t.svc')::uuid, current_setting('t.th')::uuid, 'ZZ Stay', '+9779800099995',
        '2030-03-04', '10:00', '11:00', 'Confirmed', 1000, 0, 1000, 'unpaid', 'e0000000-0000-0000-0000-000000000001');
SELECT pg_temp.err('moving the booking again re-checks (still in a break)', 'ON_BREAK',
  $q$UPDATE public.bookings SET start_time = '14:10', end_time = '14:20' WHERE customer_name = 'ZZ Stay'$q$);
DELETE FROM public.bookings WHERE customer_name IN ('ZZ Move', 'ZZ Stay');

-- ================= 8. override (manager/admin + reason; never OVERLAP / ON_LEAVE) =================
SELECT pg_temp.as_user('e0000000-0000-0000-0000-000000000002');  -- manager
SELECT pg_temp.ok('override: manager in a break with a reason', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-04', '14:00', '15:00', 'regular client, agreed to take lunch later'));
SELECT pg_temp.err('override: manager without a reason (NULL)', 'ON_BREAK',    pg_temp.bk(current_setting('t.th')::uuid, '2030-03-04', '14:00', '15:00', NULL));
SELECT pg_temp.err('override: manager with an empty reason',    'ON_BREAK',    pg_temp.bk(current_setting('t.th')::uuid, '2030-03-04', '14:00', '15:00', ''));
SELECT pg_temp.err('override: manager with a blank reason',     'ON_BREAK',    pg_temp.bk(current_setting('t.th')::uuid, '2030-03-04', '14:00', '15:00', '   '));
SELECT pg_temp.ok('override: off shift',                        pg_temp.bk(current_setting('t.th')::uuid, '2030-03-04', '08:00', '09:00', 'opening early for a group'));
SELECT pg_temp.ok('override: blocked time',                     pg_temp.bk(current_setting('t.th')::uuid, '2030-04-15', '15:30', '16:30', 'training moved'));
SELECT pg_temp.ok('override: other branch window',              pg_temp.bk(current_setting('t.thT')::uuid, '2030-05-06', '13:00', '14:00', 'she is back early'));
SELECT pg_temp.err('override: ON_LEAVE is never overridable',   'ON_LEAVE',    pg_temp.bk(current_setting('t.th')::uuid, '2030-03-08', '12:00', '13:00', 'please'));
SELECT pg_temp.err('override: half-day leave is never overridable', 'ON_LEAVE', pg_temp.bk(current_setting('t.th')::uuid, '2030-04-08', '12:15', '12:45', 'please'));
INSERT INTO public.bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, status, base_amount, discount_amount, final_amount, payment_status, created_by)
VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', current_setting('t.svc')::uuid, current_setting('t.thx')::uuid, 'ZZ Keep', '+9779800099998',
        '2030-06-03', '10:00', '11:00', 'Confirmed', 1000, 0, 1000, 'unpaid', 'e0000000-0000-0000-0000-000000000001');
SELECT pg_temp.err('override: OVERLAP is never overridable',    'OVERLAP',     pg_temp.bk(current_setting('t.thx')::uuid, '2030-06-03', '10:30', '11:30', 'please'));
SELECT pg_temp.err('override: OVERLAP wins even when a break is also hit', 'OVERLAP', pg_temp.bk(current_setting('t.thx')::uuid, '2030-06-03', '10:30', '11:30', 'please'));
DELETE FROM public.bookings WHERE customer_name = 'ZZ Keep';
SELECT pg_temp.as_user('e0000000-0000-0000-0000-000000000001');  -- admin
SELECT pg_temp.ok('override: admin with a reason',              pg_temp.bk(current_setting('t.th')::uuid, '2030-03-04', '14:00', '15:00', 'owner request'));
SELECT pg_temp.as_user('e0000000-0000-0000-0000-000000000003');  -- staff
SELECT pg_temp.err('override: staff setting the column is refused (violation)', 'OVERRIDE_NOT_ALLOWED', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-04', '14:00', '15:00', 'sneaky'));
SELECT pg_temp.err('override: staff setting the column is refused (no violation)', 'OVERRIDE_NOT_ALLOWED', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-04', '11:00', '12:00', 'sneaky'));
SELECT pg_temp.err('override: staff, plain violation still blocked', 'ON_BREAK', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-04', '14:00', '15:00'));

-- audit row + stale reason + inheritance
SELECT pg_temp.as_user('e0000000-0000-0000-0000-000000000002');
INSERT INTO public.bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, status, base_amount, discount_amount, final_amount, payment_status, created_by, availability_override_reason)
VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', current_setting('t.svc')::uuid, current_setting('t.th')::uuid, 'ZZ Avail', '+9779800099999',
        '2030-03-04', '14:00', '15:00', 'Confirmed', 1000, 0, 1000, 'unpaid', 'e0000000-0000-0000-0000-000000000002', 'regular client');
SELECT pg_temp.assert('override: audit row written with code and reason',
  EXISTS (SELECT 1 FROM public.audit_logs a JOIN public.bookings b ON b.id = a.record_id
           WHERE b.customer_name = 'ZZ Avail' AND a.action_type = 'AVAILABILITY_OVERRIDE' AND a.new_data->>'code' = 'ON_BREAK'
             AND a.reason = 'regular client' AND a.new_data->>'override_reason' = 'regular client' AND a.changed_by = 'e0000000-0000-0000-0000-000000000002'));
SELECT pg_temp.assert('override: the sync-created companion row did not duplicate the audit row',
  (SELECT count(*) FROM public.audit_logs a JOIN public.bookings b ON b.id = a.record_id
    WHERE b.customer_name = 'ZZ Avail' AND a.action_type = 'AVAILABILITY_OVERRIDE') = 1);
-- stale: the old reason is still on the row; a later move into another break time must NOT ride on it
SELECT pg_temp.err('stale reason: later move into the break is refused', 'ON_BREAK',
  $q$UPDATE public.bookings SET start_time = '14:10', end_time = '14:20' WHERE customer_name = 'ZZ Avail'$q$);
SELECT pg_temp.ok('stale reason: a newly set reason in the same update counts',
  $q$UPDATE public.bookings SET start_time = '14:10', end_time = '14:20', availability_override_reason = 'second override' WHERE customer_name = 'ZZ Avail'$q$);
-- status-only update of an overridden booking never fails
INSERT INTO public.bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, status, base_amount, discount_amount, final_amount, payment_status, created_by, availability_override_reason)
VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', current_setting('t.svc')::uuid, current_setting('t.th')::uuid, 'ZZ Avail', '+9779800099999',
        '2030-03-04', '14:00', '15:00', 'Confirmed', 1000, 0, 1000, 'unpaid', 'e0000000-0000-0000-0000-000000000002', 'regular client');
SELECT pg_temp.ok('overridden booking: status update passes (no re-check)', $q$UPDATE public.bookings SET status = 'In-Progress' WHERE customer_name = 'ZZ Avail'$q$);
-- companion therapists and combo items carry their OWN reason column (same rules; no inheritance from the booking)
CREATE FUNCTION pg_temp.parent(p_th uuid, p_date date, p_s time) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, status,
                               base_amount, discount_amount, final_amount, payment_status, created_by)
  VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', current_setting('t.svc')::uuid, p_th, 'ZZ Avail',
          '+9779800099999', p_date, p_s, p_s + interval '1 hour', 'Confirmed', 1000, 0, 1000, 'unpaid', 'e0000000-0000-0000-0000-000000000001') $$;
CREATE FUNCTION pg_temp.bt(p_reason text, p_th uuid, p_s time, p_e time) RETURNS text LANGUAGE sql AS $$
  SELECT format($f$INSERT INTO public.booking_therapists (booking_id, therapist_id, start_time, end_time, availability_override_reason)
    SELECT id, %L, %L, %L, %L FROM public.bookings WHERE customer_name = 'ZZ Avail'$f$, p_th, p_s, p_e, p_reason) $$;
CREATE FUNCTION pg_temp.ci(p_reason text, p_th uuid, p_s time, p_e time, p_date date DEFAULT '2030-03-04') RETURNS text LANGUAGE sql AS $$
  SELECT format($f$INSERT INTO public.booking_combo_items (booking_id, service_id, therapist_id, date, start_time, end_time, availability_override_reason)
    SELECT id, %L, %L, %L, %L, %L, %L FROM public.bookings WHERE customer_name = 'ZZ Avail'$f$, current_setting('t.svc'), p_th, p_date, p_s, p_e, p_reason) $$;

SELECT pg_temp.parent(current_setting('t.th0')::uuid, '2030-03-04', '11:00');
SELECT pg_temp.err('companion: break without a reason', 'ON_BREAK', pg_temp.bt(NULL, current_setting('t.th')::uuid, '14:00', '14:30'));
SELECT pg_temp.parent(current_setting('t.th0')::uuid, '2030-03-04', '11:00');
SELECT pg_temp.err('companion: blank reason', 'ON_BREAK', pg_temp.bt('  ', current_setting('t.th')::uuid, '14:00', '14:30'));
CREATE FUNCTION pg_temp.run(p_sql text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; END $$;
CREATE FUNCTION pg_temp.audited(p_code text, p_th uuid, p_reason text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.audit_logs a JOIN public.bookings b ON b.id = a.record_id
                  WHERE b.customer_name = 'ZZ Avail' AND a.action_type = 'AVAILABILITY_OVERRIDE' AND a.new_data->>'code' = p_code
                    AND a.new_data->>'therapist_id' = p_th::text AND a.reason = p_reason) $$;

-- companion: manager + reason in the same request (or any later one)
SELECT pg_temp.parent(current_setting('t.th0')::uuid, '2030-03-04', '11:00');
SELECT pg_temp.run(pg_temp.bt('companion agreed', current_setting('t.th')::uuid, '14:00', '14:30'));
SELECT pg_temp.assert('companion: manager override in a break is audited with code, therapist and reason', pg_temp.audited('ON_BREAK', current_setting('t.th')::uuid, 'companion agreed'));
SELECT pg_temp.err('companion: stale reason does not carry over to a later move', 'ON_BREAK',
  $q$UPDATE public.booking_therapists SET start_time = '14:05', end_time = '14:25' WHERE therapist_id = current_setting('t.th')::uuid AND booking_id = (SELECT id FROM public.bookings WHERE customer_name = 'ZZ Avail')$q$);
SELECT pg_temp.parent(current_setting('t.th0')::uuid, '2030-03-04', '11:00');
SELECT pg_temp.run(pg_temp.bt('companion agreed', current_setting('t.th')::uuid, '14:00', '14:30'));
SELECT pg_temp.ok('companion: a newly set reason on the update counts',
  $q$UPDATE public.booking_therapists SET start_time = '14:05', end_time = '14:25', availability_override_reason = 'moved again' WHERE therapist_id = current_setting('t.th')::uuid AND booking_id = (SELECT id FROM public.bookings WHERE customer_name = 'ZZ Avail')$q$);
SELECT pg_temp.parent(current_setting('t.th0')::uuid, '2030-03-04', '11:00');
SELECT pg_temp.err('companion: no reason (NULL)', 'ON_BREAK', pg_temp.bt(NULL, current_setting('t.th')::uuid, '14:00', '14:30'));
SELECT pg_temp.parent(current_setting('t.th0')::uuid, '2030-03-04', '11:00');
SELECT pg_temp.err('companion: blank reason', 'ON_BREAK', pg_temp.bt('  ', current_setting('t.th')::uuid, '14:00', '14:30'));
SELECT pg_temp.parent(current_setting('t.th0')::uuid, '2030-03-08', '11:00');
SELECT pg_temp.err('companion: ON_LEAVE is never overridable', 'ON_LEAVE', pg_temp.bt('please', current_setting('t.th')::uuid, '12:00', '12:30'));
INSERT INTO public.bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, status, base_amount, discount_amount, final_amount, payment_status, created_by)
VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', current_setting('t.svc')::uuid, current_setting('t.thx')::uuid, 'ZZ Keep', '+9779800099998',
        '2030-03-04', '14:00', '15:00', 'Confirmed', 1000, 0, 1000, 'unpaid', 'e0000000-0000-0000-0000-000000000001');
SELECT pg_temp.parent(current_setting('t.th0')::uuid, '2030-03-04', '11:00');
SELECT pg_temp.err('companion: OVERLAP is never overridable', 'OVERLAP', pg_temp.bt('please', current_setting('t.thx')::uuid, '14:15', '14:45'));
SELECT pg_temp.parent(current_setting('t.th0')::uuid, '2030-03-04', '11:00');
SELECT pg_temp.err('combo item: OVERLAP is never overridable', 'OVERLAP', pg_temp.ci('please', current_setting('t.thx')::uuid, '14:15', '14:45'));
DELETE FROM public.bookings WHERE customer_name = 'ZZ Keep';
-- combo item
SELECT pg_temp.parent(current_setting('t.th0')::uuid, '2030-03-04', '11:00');
SELECT pg_temp.run(pg_temp.ci('combo agreed', current_setting('t.th')::uuid, '14:00', '14:30'));
SELECT pg_temp.assert('combo item: manager override in a break is audited', pg_temp.audited('ON_BREAK', current_setting('t.th')::uuid, 'combo agreed'));
SELECT pg_temp.err('combo item: stale reason does not carry over to a later move', 'ON_BREAK',
  $q$UPDATE public.booking_combo_items SET start_time = '14:05', end_time = '14:25' WHERE therapist_id = current_setting('t.th')::uuid$q$);
SELECT pg_temp.parent(current_setting('t.th0')::uuid, '2030-03-04', '11:00');
SELECT pg_temp.err('combo item: no reason', 'ON_BREAK', pg_temp.ci(NULL, current_setting('t.th')::uuid, '14:00', '14:30'));
SELECT pg_temp.parent(current_setting('t.th0')::uuid, '2030-03-08', '11:00');
SELECT pg_temp.err('combo item: ON_LEAVE is never overridable', 'ON_LEAVE', pg_temp.ci('please', current_setting('t.th')::uuid, '12:00', '12:30', '2030-03-08'));
-- staff may not set either column
SELECT pg_temp.parent(current_setting('t.th0')::uuid, '2030-03-04', '11:00');
SELECT pg_temp.as_user('e0000000-0000-0000-0000-000000000003');
SELECT pg_temp.err('companion: staff setting the column is refused', 'OVERRIDE_NOT_ALLOWED', pg_temp.bt('sneaky', current_setting('t.th')::uuid, '14:00', '14:30'));
SELECT pg_temp.parent(current_setting('t.th0')::uuid, '2030-03-04', '11:00');
SELECT pg_temp.err('companion: staff setting the column is refused even with no violation', 'OVERRIDE_NOT_ALLOWED', pg_temp.bt('sneaky', current_setting('t.th')::uuid, '11:00', '11:30'));
SELECT pg_temp.parent(current_setting('t.th0')::uuid, '2030-03-04', '11:00');
SELECT pg_temp.err('combo item: staff setting the column is refused', 'OVERRIDE_NOT_ALLOWED', pg_temp.ci('sneaky', current_setting('t.th')::uuid, '14:00', '14:30'));
SELECT pg_temp.as_user('e0000000-0000-0000-0000-000000000001');
DELETE FROM public.bookings WHERE customer_name = 'ZZ Avail';

-- ================= 9. switch off = old behaviour; admin correction bypass =================
UPDATE public.organizations SET enforce_staff_availability = false WHERE id = current_setting('t.org')::uuid;
SELECT pg_temp.ok('switch off: break/off-shift booking allowed', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-04', '14:00', '15:00'));
SELECT pg_temp.err('switch off: leave still blocked (legacy THERAPIST_ABSENT)', 'THERAPIST_ABSENT', pg_temp.bk(current_setting('t.th')::uuid, '2030-03-08', '12:00', '13:00'));
SELECT pg_temp.err('switch off: overlap still stopped by the exclusion constraint', '23P01',
  pg_temp.bk(current_setting('t.th0')::uuid, '2030-06-10', '10:00', '11:00') || ';' || pg_temp.bk(current_setting('t.th0')::uuid, '2030-06-10', '10:30', '11:30'));
UPDATE public.organizations SET enforce_staff_availability = true WHERE id = current_setting('t.org')::uuid;
INSERT INTO public.bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, status, base_amount, discount_amount, final_amount, payment_status, created_by)
VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', current_setting('t.svc')::uuid, current_setting('t.th')::uuid, 'ZZ Avail', '+9779800099999',
        '2030-03-04', '11:00', '12:00', 'Confirmed', 1000, 0, 1000, 'unpaid', 'e0000000-0000-0000-0000-000000000001');
SELECT public.admin_correct_booking((SELECT id FROM public.bookings WHERE customer_name = 'ZZ Avail'),
        '{"start_time":"14:00","end_time":"15:00"}'::jsonb, 'availability check');
SELECT pg_temp.assert('admin correction: logged bypass moved the booking into a break',
  EXISTS (SELECT 1 FROM public.bookings WHERE customer_name = 'ZZ Avail' AND start_time = '14:00'));
SELECT pg_temp.assert('admin correction: ADMIN_CORRECTION audit row exists',
  EXISTS (SELECT 1 FROM public.audit_logs a JOIN public.bookings b ON b.id = a.record_id WHERE b.customer_name = 'ZZ Avail' AND a.action_type = 'ADMIN_CORRECTION'));
DELETE FROM public.bookings WHERE customer_name = 'ZZ Avail';

-- ================= 10. public RPCs (mockup panel E, "Rojina") =================
SELECT set_config('t.thR', pg_temp.mk_th('ZZ Rojina')::text, true);
SELECT pg_temp.mk_hours(current_setting('t.thR')::uuid, 0, '10:00', '20:00', '14:00', '14:30');
INSERT INTO public.bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, status, base_amount, discount_amount, final_amount, payment_status, created_by)
VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', current_setting('t.svc')::uuid, current_setting('t.thR')::uuid, 'ZZ Rojina client', '+9779800099994',
        '2030-03-04', '13:00', '14:00', 'Confirmed', 1000, 0, 1000, 'unpaid', 'e0000000-0000-0000-0000-000000000001');
CREATE TEMP TABLE _pr ON COMMIT DROP AS
  SELECT r.* FROM public.public_check_therapist_bookings_range((SELECT slug FROM public.organizations WHERE id = current_setting('t.org')::uuid),
        'b0000000-0000-0000-0000-000000000001', '2030-03-04', '2030-03-04') r WHERE r.therapist_id = current_setting('t.thR')::uuid;
SELECT pg_temp.assert('public therapist rpc: off (before shift), break, off (after shift), booking rows',
  EXISTS (SELECT 1 FROM _pr WHERE source = 'off' AND start_time = '00:00' AND duration_minutes = 600)
  AND EXISTS (SELECT 1 FROM _pr WHERE source = 'break' AND start_time = '14:00' AND duration_minutes = 30)
  AND EXISTS (SELECT 1 FROM _pr WHERE source = 'off' AND start_time = '20:00' AND duration_minutes = 240)
  AND EXISTS (SELECT 1 FROM _pr WHERE source = 'booking' AND start_time = '13:00' AND duration_minutes = 60));
SELECT pg_temp.assert('public therapist rpc: no-hours therapist gets only branch-hours off rows (no break/leave/other_branch)',
  NOT EXISTS (SELECT 1 FROM public.public_check_therapist_bookings_range((SELECT slug FROM public.organizations WHERE id = current_setting('t.org')::uuid),
        'b0000000-0000-0000-0000-000000000001', '2030-03-04', '2030-03-04') r
        WHERE r.therapist_id = current_setting('t.th0')::uuid AND r.source IN ('break', 'leave', 'other_branch')));
SELECT pg_temp.assert('public therapist rpc: leave (half day) and other_branch rows appear',
  EXISTS (SELECT 1 FROM public.public_check_therapist_bookings_range((SELECT slug FROM public.organizations WHERE id = current_setting('t.org')::uuid),
        'b0000000-0000-0000-0000-000000000001', '2030-03-25', '2030-03-25') r
        WHERE r.therapist_id = current_setting('t.th')::uuid AND r.source = 'leave' AND r.start_time = '10:00' AND r.duration_minutes = 240)
  AND EXISTS (SELECT 1 FROM public.public_check_therapist_bookings_range((SELECT slug FROM public.organizations WHERE id = current_setting('t.org')::uuid),
        'b0000000-0000-0000-0000-000000000001', '2030-05-06', '2030-05-06') r
        WHERE r.therapist_id = current_setting('t.thT')::uuid AND r.source = 'other_branch'));
UPDATE public.organizations SET enforce_staff_availability = false WHERE id = current_setting('t.org')::uuid;
SELECT pg_temp.assert('public therapist rpc: switch off = no availability rows',
  NOT EXISTS (SELECT 1 FROM public.public_check_therapist_bookings_range((SELECT slug FROM public.organizations WHERE id = current_setting('t.org')::uuid),
        'b0000000-0000-0000-0000-000000000001', '2030-03-04', '2030-03-04') r WHERE r.source IN ('off', 'break', 'leave', 'other_branch')));
UPDATE public.organizations SET enforce_staff_availability = true WHERE id = current_setting('t.org')::uuid;

SELECT pg_temp.assert('public_check_branch_bookings_range keeps anon + authenticated EXECUTE after the drop/recreate',
  has_function_privilege('anon', 'public.public_check_branch_bookings_range(uuid,date,date,uuid,integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.public_check_branch_bookings_range(uuid,date,date,uuid,integer)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.public_check_therapist_bookings_range(text,uuid,date,date)', 'EXECUTE'));
-- "Any professional": only Rojina is eligible (everyone else deactivated for this check)
UPDATE public.therapists SET is_active = false WHERE branch_id = 'b0000000-0000-0000-0000-000000000001' AND id <> current_setting('t.thR')::uuid;
CREATE TEMP TABLE _ns ON COMMIT DROP AS
  SELECT to_char(start_time, 'HH24:MI') AS t FROM public.public_check_branch_bookings_range(
    'b0000000-0000-0000-0000-000000000001', '2030-03-04', '2030-03-04', current_setting('t.svc')::uuid, 60) WHERE source = 'no_staff';
SELECT pg_temp.assert('any professional: open slots 10:00, 14:30, 15:30, 19:00',
  NOT EXISTS (SELECT 1 FROM _ns WHERE t IN ('10:00', '14:30', '15:30', '19:00')));
SELECT pg_temp.assert('any professional: closed 09:00 (before shift), 13:00 (booked), 13:30/14:00 (break), 19:30 (ends after 20:00)',
  (SELECT count(*) FROM _ns WHERE t IN ('09:00', '13:00', '13:30', '14:00', '19:30')) = 5);
SELECT pg_temp.assert('any professional: without service/duration there are no no_staff rows',
  NOT EXISTS (SELECT 1 FROM public.public_check_branch_bookings_range('b0000000-0000-0000-0000-000000000001', '2030-03-04', '2030-03-04') WHERE source = 'no_staff'));
-- a second eligible therapist who is free keeps the slot open
UPDATE public.therapists SET is_active = true WHERE id = current_setting('t.th0')::uuid;
SELECT pg_temp.assert('any professional: a free no-hours therapist keeps every slot open',
  NOT EXISTS (SELECT 1 FROM public.public_check_branch_bookings_range('b0000000-0000-0000-0000-000000000001', '2030-03-04', '2030-03-04',
        current_setting('t.svc')::uuid, 60) WHERE source = 'no_staff' AND start_time = '14:00'));
UPDATE public.therapists SET is_active = false WHERE id = current_setting('t.th0')::uuid;

-- ================= 11. therapist_shifts_for_range matches the guard =================
UPDATE public.therapists SET is_active = true WHERE id IN (current_setting('t.th')::uuid, current_setting('t.thT')::uuid, current_setting('t.th0')::uuid);
SELECT pg_temp.as_user('e0000000-0000-0000-0000-000000000002');
DELETE FROM public.bookings WHERE customer_name IN ('ZZ Avail', 'ZZ Rojina client');
SELECT pg_temp.assert('shifts range: Monday weekly shift',
  EXISTS (SELECT 1 FROM public.therapist_shifts_for_range('b0000000-0000-0000-0000-000000000001', '2030-03-04', '2030-03-04') s
           WHERE s.therapist_id = current_setting('t.th')::uuid AND s.works AND s.start_time = '10:00' AND s.end_time = '20:00'
             AND s.source = 'weekly' AND s.breaks->0->>'start' = '14:00' AND s.breaks->0->>'end' = '14:30'));
SELECT pg_temp.assert('shifts range: roster date shows roster source + its own break',
  EXISTS (SELECT 1 FROM public.therapist_shifts_for_range('b0000000-0000-0000-0000-000000000001', '2030-03-11', '2030-03-11') s
           WHERE s.therapist_id = current_setting('t.th')::uuid AND s.source = 'roster' AND s.start_time = '11:00' AND s.breaks->0->>'start' = '15:00'));
SELECT pg_temp.assert('shifts range: day off, none, leave, block and transfer ranges',
  EXISTS (SELECT 1 FROM public.therapist_shifts_for_range('b0000000-0000-0000-0000-000000000001', '2030-03-05', '2030-03-05') s WHERE s.therapist_id = current_setting('t.th')::uuid AND NOT s.works)
  AND EXISTS (SELECT 1 FROM public.therapist_shifts_for_range('b0000000-0000-0000-0000-000000000001', '2030-03-06', '2030-03-06') s WHERE s.therapist_id = current_setting('t.th')::uuid AND s.works AND s.source = 'none')
  AND EXISTS (SELECT 1 FROM public.therapist_shifts_for_range('b0000000-0000-0000-0000-000000000001', '2030-03-08', '2030-03-08') s WHERE s.therapist_id = current_setting('t.th')::uuid AND s.off @> '[{"code":"ON_LEAVE"}]')
  AND EXISTS (SELECT 1 FROM public.therapist_shifts_for_range('b0000000-0000-0000-0000-000000000001', '2030-04-15', '2030-04-15') s WHERE s.therapist_id = current_setting('t.th')::uuid AND s.off @> '[{"code":"BLOCKED","start":"16:00","end":"17:00"}]')
  AND EXISTS (SELECT 1 FROM public.therapist_shifts_for_range('b0000000-0000-0000-0000-000000000001', '2030-05-06', '2030-05-06') s WHERE s.therapist_id = current_setting('t.thT')::uuid AND s.off @> '[{"code":"OTHER_BRANCH","start":"12:00","end":"18:00"}]'));
-- parity: for every fixture therapist/date and every 30-min start, the guard refuses exactly when the range data says it should
DO $$
DECLARE
  r record; m int; v_viol boolean; v_pred boolean; n int := 0;
BEGIN
  FOR r IN
    SELECT s.*, d.d AS dt
      FROM public.therapist_shifts_for_range('b0000000-0000-0000-0000-000000000001', '2030-03-04', '2030-05-06') s
      JOIN LATERAL (SELECT s.shift_date AS d) d ON true
     WHERE s.therapist_id IN (current_setting('t.th')::uuid, current_setting('t.thT')::uuid, current_setting('t.th0')::uuid)
       AND s.shift_date IN ('2030-03-04','2030-03-05','2030-03-06','2030-03-07','2030-03-08','2030-03-11','2030-03-18','2030-03-25','2030-04-01','2030-04-08','2030-04-15','2030-04-22','2030-05-06')
  LOOP
    FOR m IN SELECT g FROM generate_series(6 * 60, 22 * 60 - 30, 30) g LOOP
      v_pred := (NOT r.works)
             OR (r.works AND r.start_time IS NOT NULL AND (m < (EXTRACT(EPOCH FROM r.start_time) / 60)::int OR m + 30 > CEIL(EXTRACT(EPOCH FROM r.end_time) / 60)::int))
             OR EXISTS (SELECT 1 FROM jsonb_array_elements(r.breaks) b WHERE r.works AND (b->>'start_min')::int < m + 30 AND (b->>'end_min')::int > m)
             OR EXISTS (SELECT 1 FROM jsonb_array_elements(r.off) o WHERE (o->>'start_min')::int < m + 30 AND (o->>'end_min')::int > m);
      v_viol := false;
      BEGIN
        PERFORM public.check_therapist_booking_guards(r.therapist_id, current_setting('t.svc')::uuid, r.shift_date,
          (r.shift_date::timestamp + make_interval(mins => m)) AT TIME ZONE 'Asia/Kathmandu', 'b0000000-0000-0000-0000-000000000001',
          (r.shift_date::timestamp + make_interval(mins => m + 30)) AT TIME ZONE 'Asia/Kathmandu');
      EXCEPTION WHEN OTHERS THEN
        v_viol := SQLERRM ~ '^(ON_LEAVE|OTHER_BRANCH|BLOCKED|ON_BREAK|OFF_SHIFT)';
      END;
      IF v_viol IS DISTINCT FROM v_pred THEN
        RAISE EXCEPTION 'FAIL parity: therapist % date % at % min: guard=% range-data=%', r.therapist_id, r.shift_date, m, v_viol, v_pred;
      END IF;
      n := n + 1;
    END LOOP;
  END LOOP;
  INSERT INTO _r VALUES ('shifts range matches the guard on ' || n || ' therapist/date/time combinations');
END $$;
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000dead');
SELECT pg_temp.assert('shifts range: another/unknown caller gets nothing (org-scoped)',
  NOT EXISTS (SELECT 1 FROM public.therapist_shifts_for_range('b0000000-0000-0000-0000-000000000001', '2030-03-04', '2030-03-05')));

-- ================= 12. read helper: bookings that fall outside a proposed change =================
SELECT pg_temp.as_user('e0000000-0000-0000-0000-000000000001');
SELECT set_config('t.thA', pg_temp.mk_th('ZZ Affected')::text, true);
UPDATE public.organizations SET enforce_staff_availability = false WHERE id = current_setting('t.org')::uuid;
INSERT INTO public.bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, status, base_amount, discount_amount, final_amount, payment_status, created_by)
SELECT 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', current_setting('t.svc')::uuid, current_setting('t.thA')::uuid, 'ZZ Avail', '+9779800099993',
       d, s::time, (s::time + interval '1 hour'), 'Confirmed', 1000, 0, 1000, 'unpaid', 'e0000000-0000-0000-0000-000000000001'
FROM (VALUES ('2030-07-01'::date, '10:00'), ('2030-07-01', '13:00'), ('2030-07-01', '15:00'), ('2030-07-08', '11:00'), ('2030-07-02', '10:00')) v(d, s);
SELECT pg_temp.assert('affected(hours): Monday 12:00-20:00 with a 13:30-14:30 break lists 3 bookings',
  (SELECT count(*) FROM public.availability_affected_bookings(current_setting('t.thA')::uuid,
     '{"type":"hours","day_of_week":0,"start":"12:00","end":"20:00","breaks":[{"start":"13:30","end":"14:30"}]}'::jsonb)) = 3);
SELECT pg_temp.assert('affected(hours): reasons are before_shift / break',
  (SELECT array_agg(reason ORDER BY booking_date, start_time) FROM public.availability_affected_bookings(current_setting('t.thA')::uuid,
     '{"type":"hours","day_of_week":0,"start":"12:00","end":"20:00","breaks":[{"start":"13:30","end":"14:30"}]}'::jsonb)) = ARRAY['before_shift','break','before_shift']);
SELECT pg_temp.assert('affected(hours): a day off lists every Monday booking and not Tuesday',
  (SELECT count(*) FROM public.availability_affected_bookings(current_setting('t.thA')::uuid, '{"type":"hours","day_of_week":0,"is_day_off":true}'::jsonb)) = 4);
SELECT pg_temp.assert('affected(block): 13:30-16:00 hits 13:00 and 15:00',
  (SELECT count(*) FROM public.availability_affected_bookings(current_setting('t.thA')::uuid,
     '{"type":"block","date":"2030-07-01","start":"13:30","duration_minutes":150}'::jsonb)) = 2);
SELECT pg_temp.assert('affected(leave): full days 07-01..07-02 hit 4; half day 14:00-20:00 hits 1',
  (SELECT count(*) FROM public.availability_affected_bookings(current_setting('t.thA')::uuid, '{"type":"leave","from":"2030-07-01","to":"2030-07-02"}'::jsonb)) = 4
  AND (SELECT count(*) FROM public.availability_affected_bookings(current_setting('t.thA')::uuid,
        '{"type":"leave","from":"2030-07-01","to":"2030-07-01","off_start":"14:00","off_end":"20:00"}'::jsonb)) = 1);
SELECT pg_temp.assert('affected(transfer): moving to another branch from 2030-07-01 12:00 hits the 13:00, 15:00 bookings and later ones',
  (SELECT count(*) FROM public.availability_affected_bookings(current_setting('t.thA')::uuid,
     jsonb_build_object('type','transfer','from_ts','2030-07-01 12:00+05:45','to_branch_id','0cdcc3e7-9e86-45f7-a282-6062b729d1e6'))) = 4);
SELECT pg_temp.assert('affected(roster): date change lists only that date',
  (SELECT count(*) FROM public.availability_affected_bookings(current_setting('t.thA')::uuid,
     '{"type":"roster","date":"2030-07-08","start":"12:00","end":"18:00"}'::jsonb)) = 1);
DELETE FROM public.bookings WHERE customer_name = 'ZZ Avail';

-- ================= 13. rollout check =================
SELECT set_config('t.thB', pg_temp.mk_th('ZZ Rollout')::text, true);
SELECT pg_temp.mk_hours(current_setting('t.thB')::uuid, 0, '10:00', '20:00', '14:00', '14:30');
INSERT INTO public.bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, status, base_amount, discount_amount, final_amount, payment_status, created_by)
VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', current_setting('t.svc')::uuid, current_setting('t.thB')::uuid, 'ZZ Avail', '+9779800099992',
        '2030-08-05', '09:00', '10:00', 'Confirmed', 1000, 0, 1000, 'unpaid', 'e0000000-0000-0000-0000-000000000001'),
       ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', current_setting('t.svc')::uuid, current_setting('t.thB')::uuid, 'ZZ Avail', '+9779800099992',
        '2030-08-05', '14:00', '14:30', 'Confirmed', 1000, 0, 1000, 'unpaid', 'e0000000-0000-0000-0000-000000000001');
INSERT INTO public.bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, status, base_amount, discount_amount, final_amount, payment_status, created_by)
VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', current_setting('t.svc')::uuid, current_setting('t.th0')::uuid, 'ZZ Avail', '+9779800099991',
        '2030-08-05', '07:00', '08:00', 'Confirmed', 1000, 0, 1000, 'unpaid', 'e0000000-0000-0000-0000-000000000001');
SELECT pg_temp.as_user('e0000000-0000-0000-0000-000000000001');
CREATE TEMP TABLE _ro ON COMMIT DROP AS SELECT public.availability_rollout_check(current_setting('t.org')::uuid) AS j;
SELECT pg_temp.assert('rollout: counts our off-shift and break bookings by reason',
  (SELECT (j->'outside_by_code'->>'OFF_SHIFT')::int >= 1 AND (j->'outside_by_code'->>'ON_BREAK')::int >= 1
      AND (j->>'total_outside')::int >= 2 FROM _ro));
SELECT pg_temp.assert('rollout: lists therapists with no hours (th0) and none of the full-week ones',
  (SELECT j->'therapists_without_hours' @> jsonb_build_array(jsonb_build_object('id', current_setting('t.th0'), 'name', 'ZZ Avail NoHours')) FROM _ro));
SELECT pg_temp.assert('rollout: lists therapists with only some weekdays set (main = 3 days)',
  (SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'therapists_with_partial_hours') x WHERE x->>'id' = current_setting('t.th') AND (x->>'days_set')::int = 3) FROM _ro));
SELECT pg_temp.assert('rollout: counts bookings newly outside branch hours for a therapist with nothing set',
  (SELECT (j->>'outside_branch_hours_no_shift_set')::int >= 1 FROM _ro));
SELECT pg_temp.assert('rollout: partial-hours therapist is listed by name with the missing weekdays',
  (SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'therapists_with_partial_hours') x
                   WHERE x->>'name' = 'ZZ Avail Main' AND x->'days_missing' = '[2,4,5,6]'::jsonb) FROM _ro));
SELECT pg_temp.as_user('e0000000-0000-0000-0000-000000000003');
SELECT pg_temp.err('rollout: staff refused', '42501', format($q$SELECT public.availability_rollout_check(%L)$q$, current_setting('t.org')));
SELECT pg_temp.as_user('e0000000-0000-0000-0000-000000000001');
SELECT pg_temp.err('rollout: another org refused', '42501', $q$SELECT public.availability_rollout_check('99999999-9999-9999-9999-999999999999')$q$);

-- ================= 14. reschedule_booking RPC takes the override reason (migration 322) =================
UPDATE public.organizations SET enforce_staff_availability = true WHERE id = current_setting('t.org')::uuid;
SELECT pg_temp.as_user('e0000000-0000-0000-0000-000000000001');
SELECT pg_temp.parent(current_setting('t.th0')::uuid, '2030-09-02', '11:00');
SELECT pg_temp.as_user('e0000000-0000-0000-0000-000000000002');
SELECT pg_temp.err('reschedule rpc: into a break without a reason', 'ON_BREAK',
  format($q$SELECT public.reschedule_booking((SELECT id FROM public.bookings WHERE customer_name = 'ZZ Avail'), '2030-03-04', '14:00', %L, NULL, 'moved')$q$, current_setting('t.th')));
SELECT pg_temp.parent(current_setting('t.th0')::uuid, '2030-09-02', '11:00');
SELECT pg_temp.as_user('e0000000-0000-0000-0000-000000000003');
SELECT pg_temp.err('reschedule rpc: staff with a reason is refused', 'OVERRIDE_NOT_ALLOWED',
  format($q$SELECT public.reschedule_booking((SELECT id FROM public.bookings WHERE customer_name = 'ZZ Avail'), '2030-03-04', '14:00', %L, NULL, 'moved', 'sneaky')$q$, current_setting('t.th')));
SELECT pg_temp.parent(current_setting('t.th0')::uuid, '2030-09-02', '11:00');
SELECT pg_temp.as_user('e0000000-0000-0000-0000-000000000002');
SELECT pg_temp.err('reschedule rpc: ON_LEAVE is not overridable', 'ON_LEAVE',
  format($q$SELECT public.reschedule_booking((SELECT id FROM public.bookings WHERE customer_name = 'ZZ Avail'), '2030-03-08', '12:00', %L, NULL, 'moved', 'please')$q$, current_setting('t.th')));
SELECT pg_temp.parent(current_setting('t.th0')::uuid, '2030-09-02', '11:00');
SELECT pg_temp.run(format($q$CREATE TEMP TABLE _rs ON COMMIT DROP AS SELECT public.reschedule_booking((SELECT id FROM public.bookings WHERE customer_name = 'ZZ Avail'), '2030-03-04', '14:00', %L, NULL, 'moved', 'client request') AS j$q$, current_setting('t.th')));
SELECT pg_temp.assert('reschedule rpc: manager + reason moves into the break, is audited, and the reason is not left on the row',
  EXISTS (SELECT 1 FROM public.bookings b JOIN _rs ON b.id = (_rs.j->>'id')::uuid WHERE b.availability_override_reason IS NULL AND b.start_time = '14:00')
  AND EXISTS (SELECT 1 FROM public.audit_logs a JOIN _rs ON a.record_id = (_rs.j->>'id')::uuid WHERE a.action_type = 'AVAILABILITY_OVERRIDE' AND a.reason = 'client request'));
DELETE FROM public.bookings WHERE customer_name = 'ZZ Avail';

-- ================= 15. admin-only switch write path (migration 323) =================
SELECT pg_temp.as_user('e0000000-0000-0000-0000-000000000001');
SELECT pg_temp.run($q$CREATE TEMP TABLE _sw ON COMMIT DROP AS SELECT public.set_enforce_staff_availability(false) AS off_v$q$);
SELECT pg_temp.assert('switch: admin turns it off', (SELECT off_v = false FROM _sw) AND NOT (SELECT enforce_staff_availability FROM public.organizations WHERE id = current_setting('t.org')::uuid));
SELECT pg_temp.ok('switch: admin turns it back on', $q$SELECT public.set_enforce_staff_availability(true)$q$);
SELECT pg_temp.assert('switch: on again', (SELECT enforce_staff_availability FROM public.organizations WHERE id = current_setting('t.org')::uuid));
SELECT pg_temp.as_user('e0000000-0000-0000-0000-000000000002');
SELECT pg_temp.err('switch: a manager cannot change it', '42501', $q$SELECT public.set_enforce_staff_availability(false)$q$);
SELECT pg_temp.as_user('e0000000-0000-0000-0000-000000000003');
SELECT pg_temp.err('switch: staff cannot change it', '42501', $q$SELECT public.set_enforce_staff_availability(false)$q$);

-- ================= report =================
SELECT count(*) || ' staff-availability checks passed' AS result FROM _r;
ROLLBACK;
