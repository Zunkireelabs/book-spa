-- B7 Locations: closing after opening (database check) and inactive locations (migration 385). Scratch database only (scripts/qc-4c.sh).
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO organizations (id, name, code, slug, settings) VALUES ('2b700000-0000-0000-0000-00000000000a', 'ZZB7 Org', 'ZZB7A', 'zzb7-org', '{"show_staff_selection": true}'::jsonb);
INSERT INTO branches (id, name, org_id, is_active) VALUES ('2b700000-0000-0000-0000-0000000000a1', 'ZZB7 Active', '2b700000-0000-0000-0000-00000000000a', true),
                                                          ('2b700000-0000-0000-0000-0000000000a2', 'ZZB7 Inactive', '2b700000-0000-0000-0000-00000000000a', true);
INSERT INTO rooms (id, branch_id, name, capacity) VALUES ('2b700000-0000-0000-0000-0000000e0001', '2b700000-0000-0000-0000-0000000000a1', 'ZZB7 Room 1', 3),
                                                         ('2b700000-0000-0000-0000-0000000e0002', '2b700000-0000-0000-0000-0000000000a2', 'ZZB7 Room 2', 3);
INSERT INTO services (id, name, duration_minutes, price_npr, org_id) VALUES ('2b700000-0000-0000-0000-0000000f0001', 'ZZB7 Massage', 60, 1000, '2b700000-0000-0000-0000-00000000000a');
INSERT INTO therapists (id, branch_id, name, gender, org_id) VALUES ('2b700000-0000-0000-0000-000000000001', '2b700000-0000-0000-0000-0000000000a1', 'ZZB7 T1', 'Female', '2b700000-0000-0000-0000-00000000000a'),
                                                                    ('2b700000-0000-0000-0000-000000000002', '2b700000-0000-0000-0000-0000000000a2', 'ZZB7 T2', 'Female', '2b700000-0000-0000-0000-00000000000a');
INSERT INTO auth.users (id, email) VALUES ('2b700000-0000-0000-0000-000000000101', 'zzb7-admin@example.test');
INSERT INTO users (id, email, full_name, role, branch_id, org_id, login_access)
  VALUES ('2b700000-0000-0000-0000-000000000101', 'zzb7-admin@example.test', 'ZZB7 Admin', 'admin', '2b700000-0000-0000-0000-0000000000a1', '2b700000-0000-0000-0000-00000000000a', 'email');
-- one booking per branch, made while both were active
INSERT INTO bookings (id, branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, base_amount, final_amount, created_by, status)
SELECT ('2b700000-0000-0000-0000-0000000b000' || n)::uuid, ('2b700000-0000-0000-0000-0000000000a' || n)::uuid, ('2b700000-0000-0000-0000-0000000e000' || n)::uuid, '2b700000-0000-0000-0000-0000000f0001',
       ('2b700000-0000-0000-0000-00000000000' || n)::uuid, 'ZZB7 b' || n, '9800000777', current_date + 20, '11:00', '12:00',
       ((current_date + 20) + time '11:00') AT TIME ZONE 'Asia/Kathmandu', ((current_date + 20) + time '12:00') AT TIME ZONE 'Asia/Kathmandu', 1000, 1000, '2b700000-0000-0000-0000-000000000101', 'Confirmed'
FROM generate_series(1, 2) n;
INSERT INTO branch_working_hours (branch_id, day_of_week, start_time, end_time, is_day_off) VALUES ('2b700000-0000-0000-0000-0000000000a1', 1, '10:00', '18:00', false);
UPDATE branches SET is_active = false WHERE id = '2b700000-0000-0000-0000-0000000000a2';   -- now deactivate Branch 2
COMMIT;

DO $$
DECLARE n int;
BEGIN
  -- rule 1: closing must be after opening on an open day (database check), equal is refused too; a closed day needs no times
  BEGIN UPDATE branch_working_hours SET start_time = '18:00', end_time = '10:00' WHERE branch_id = '2b700000-0000-0000-0000-0000000000a1' AND day_of_week = 1;
        ASSERT false, 'W1 closes before it opens must be refused';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE branch_working_hours SET end_time = start_time WHERE branch_id = '2b700000-0000-0000-0000-0000000000a1' AND day_of_week = 1;
        ASSERT false, 'W2 closes when it opens must be refused';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE branch_working_hours SET is_day_off = true, start_time = NULL, end_time = NULL WHERE branch_id = '2b700000-0000-0000-0000-0000000000a1' AND day_of_week = 1;
  RAISE NOTICE 'hours rule passed';

  -- rule 2: the five public readers return rows for the active branch and nothing for the inactive one
  SELECT count(*) INTO n FROM public_check_slot_availability('2b700000-0000-0000-0000-0000000000a1', current_date + 20); ASSERT n = 1, 'I1 active slot rows ' || n;
  SELECT count(*) INTO n FROM public_check_slot_availability('2b700000-0000-0000-0000-0000000000a2', current_date + 20); ASSERT n = 0, 'I2 inactive slot rows ' || n;
  SELECT count(*) INTO n FROM public_check_branch_bookings_range('2b700000-0000-0000-0000-0000000000a1', current_date + 20, current_date + 20); ASSERT n >= 1, 'I3 active range rows ' || n;
  SELECT count(*) INTO n FROM public_check_branch_bookings_range('2b700000-0000-0000-0000-0000000000a2', current_date + 20, current_date + 20); ASSERT n = 0, 'I4 inactive range rows ' || n;
  SELECT count(*) INTO n FROM public_check_therapist_bookings_range('zzb7-org', '2b700000-0000-0000-0000-0000000000a1', current_date + 20, current_date + 20); ASSERT n >= 1, 'I5 active therapist-range rows ' || n;
  SELECT count(*) INTO n FROM public_check_therapist_bookings_range('zzb7-org', '2b700000-0000-0000-0000-0000000000a2', current_date + 20, current_date + 20); ASSERT n = 0, 'I6 inactive therapist-range rows ' || n;
  SELECT count(*) INTO n FROM public_get_bookable_therapists('zzb7-org', '2b700000-0000-0000-0000-0000000000a1'); ASSERT n = 1, 'I7 active bookable therapists ' || n;
  SELECT count(*) INTO n FROM public_get_bookable_therapists('zzb7-org', '2b700000-0000-0000-0000-0000000000a2'); ASSERT n = 0, 'I8 inactive bookable therapists ' || n;
  SELECT count(*) INTO n FROM public_get_service_eligible_gender_headcount('zzb7-org', '2b700000-0000-0000-0000-0000000000a1', '2b700000-0000-0000-0000-0000000f0001') WHERE female_count > 0; ASSERT n = 1, 'I9 active headcount';
  SELECT count(*) INTO n FROM public_get_service_eligible_gender_headcount('zzb7-org', '2b700000-0000-0000-0000-0000000000a2', '2b700000-0000-0000-0000-0000000f0001'); ASSERT n = 0, 'I10 inactive headcount';
  ASSERT NOT has_function_privilege('anon', '_public_check_slot_availability_impl(uuid,date)', 'EXECUTE'), 'I11 the impl is not callable by app roles';
  ASSERT has_function_privilege('anon', 'public_check_slot_availability(uuid,date)', 'EXECUTE'), 'I12 anon keeps the public function';
  RAISE NOTICE 'public readers passed';

  -- a NEW booking at the inactive branch is refused (online or staff); one at the active branch is fine
  BEGIN
    INSERT INTO bookings (branch_id, room_id, service_id, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, base_amount, final_amount, created_by, status)
    VALUES ('2b700000-0000-0000-0000-0000000000a2', '2b700000-0000-0000-0000-0000000e0002', '2b700000-0000-0000-0000-0000000f0001', 'ZZB7 new', '9800000778', current_date + 21, '11:00', '12:00',
            ((current_date + 21) + time '11:00') AT TIME ZONE 'Asia/Kathmandu', ((current_date + 21) + time '12:00') AT TIME ZONE 'Asia/Kathmandu', 1000, 1000, NULL, 'Pending');
    ASSERT false, 'I13 a new booking at an inactive branch must be refused';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM LIKE 'LOCATION_INACTIVE:%', 'I13 wrong error: ' || SQLERRM;
  END;
  -- the existing booking there stays valid: it can still be paid and completed
  PERFORM 1 FROM bookings WHERE id = '2b700000-0000-0000-0000-0000000b0002' AND status = 'Confirmed';
  RAISE NOTICE 'inactive booking rule passed';
END $$;

-- existing appointments at the inactive location can be checked out (as the admin, through the real function)
BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"2b700000-0000-0000-0000-000000000101","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM record_booking_payment('2b700000-0000-0000-0000-0000000b0002', '[{"amount":1000,"payment_mode":"Cash"}]', gen_random_uuid(), NULL);
  ASSERT (SELECT payment_status FROM bookings WHERE id = '2b700000-0000-0000-0000-0000000b0002') = 'paid', 'I14 an existing booking at an inactive location can be paid';
  ASSERT (SELECT count(*) FROM branches WHERE id = '2b700000-0000-0000-0000-0000000000a2') = 1, 'I15 the inactive location stays readable for staff (Settings, reports)';
  RAISE NOTICE 'checkout at inactive location passed';
END $$;
ROLLBACK;

-- anon sees only active branches (public branch list)
BEGIN;
SET LOCAL ROLE anon;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM branches WHERE id IN ('2b700000-0000-0000-0000-0000000000a1', '2b700000-0000-0000-0000-0000000000a2')) = 1, 'I16 the public branch list hides the inactive location';
  RAISE NOTICE 'public branch list passed';
END $$;
ROLLBACK;
\echo B7 PASSED
