-- ZNLY-221: a room-less org saves bookings with room_id NULL; a room org's capacity trigger still refuses an overbooked room.
-- Everything runs in one transaction and is rolled back. Prints "221 PASSED".
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  o_beauty uuid := gen_random_uuid(); o_spa uuid := gen_random_uuid();
  b_beauty uuid := gen_random_uuid(); b_spa uuid := gen_random_uuid();
  r_spa uuid := gen_random_uuid();
  s_beauty uuid := gen_random_uuid(); s_spa uuid := gen_random_uuid();
  t_beauty uuid := gen_random_uuid(); t_beauty2 uuid := gen_random_uuid(); t_spa uuid := gen_random_uuid();
  d date := current_date + 30;
  refused boolean := false;
BEGIN
  INSERT INTO organizations (id, name, code, slug, industry_type) VALUES
    (o_beauty, 'ZZ221 beauty', 'Z221B', 'zz221-beauty', 'beauty'), (o_spa, 'ZZ221 spa', 'Z221S', 'zz221-spa', 'spa');
  INSERT INTO branches (id, org_id, name) VALUES (b_beauty, o_beauty, 'ZZ221 b'), (b_spa, o_spa, 'ZZ221 s');
  INSERT INTO rooms (id, branch_id, name) VALUES (r_spa, b_spa, 'ZZ221 room');          -- capacity 1; the beauty branch has ZERO rooms
  INSERT INTO services (id, org_id, name, duration_minutes, price_npr) VALUES (s_beauty, o_beauty, 'ZZ221 svc', 60, 1000), (s_spa, o_spa, 'ZZ221 svc', 60, 1000);
  INSERT INTO therapists (id, org_id, branch_id, name, gender) VALUES (t_beauty, o_beauty, b_beauty, 'ZZ221 t', 'Female'), (t_spa, o_spa, b_spa, 'ZZ221 t', 'Female'), (t_beauty2, o_beauty, b_beauty, 'ZZ221 t2', 'Female');
  ASSERT (SELECT count(*) FROM rooms WHERE branch_id = b_beauty) = 0, 'fixture: beauty branch must have zero rooms';

  -- room-less org: two overlapping bookings (different team members) with room_id NULL both save, incl. a status that needs a therapist
  INSERT INTO bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, status, base_amount, final_amount)
  VALUES (b_beauty, NULL, s_beauty, t_beauty, 'ZZ221 a', '9800000221', d, '10:00', '11:00', (d + time '10:00') at time zone 'Asia/Kathmandu', (d + time '11:00') at time zone 'Asia/Kathmandu', 'Confirmed', 1000, 1000),
         (b_beauty, NULL, s_beauty, t_beauty2, 'ZZ221 b', '9800000222', d, '10:00', '11:00', (d + time '10:00') at time zone 'Asia/Kathmandu', (d + time '11:00') at time zone 'Asia/Kathmandu', 'In-Progress', 1000, 1000);
  ASSERT (SELECT count(*) FROM bookings WHERE branch_id = b_beauty AND room_id IS NULL) = 2, 'room-less bookings saved';

  -- the team-member double-booking guard still holds without a room
  BEGIN
    INSERT INTO bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, status, base_amount, final_amount)
    VALUES (b_beauty, NULL, s_beauty, t_beauty, 'ZZ221 e', '9800000225', d, '10:30', '11:30', (d + time '10:30') at time zone 'Asia/Kathmandu', (d + time '11:30') at time zone 'Asia/Kathmandu', 'Confirmed', 1000, 1000);
  EXCEPTION WHEN OTHERS THEN
    refused := true;
  END;
  ASSERT refused, 'same team member double-booked must still be refused';
  refused := false;

  -- room org: first booking fills the 1-capacity room, an overlapping second one is refused by trg_room_capacity_check
  INSERT INTO bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, status, base_amount, final_amount)
  VALUES (b_spa, r_spa, s_spa, t_spa, 'ZZ221 c', '9800000223', d, '10:00', '11:00', (d + time '10:00') at time zone 'Asia/Kathmandu', (d + time '11:00') at time zone 'Asia/Kathmandu', 'Confirmed', 1000, 1000);
  BEGIN
    INSERT INTO bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, status, base_amount, final_amount)
    VALUES (b_spa, r_spa, s_spa, t_spa, 'ZZ221 d', '9800000224', d, '10:30', '11:30', (d + time '10:30') at time zone 'Asia/Kathmandu', (d + time '11:30') at time zone 'Asia/Kathmandu', 'Confirmed', 1000, 1000);
  EXCEPTION WHEN OTHERS THEN
    refused := SQLERRM LIKE 'ROOM_AT_CAPACITY%' OR SQLERRM LIKE '%capacity%';
  END;
  ASSERT refused, 'overbooked room must still be refused';
  RAISE NOTICE 'room-less save + room capacity: passed';
END $$;
ROLLBACK;
\echo 221 PASSED
