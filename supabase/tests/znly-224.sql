-- ZNLY-224: closed days block ONLINE (anon) bookings, incl. recurring ones; open days and desk (created_by) bookings are unaffected;
-- the public RPC returns dates only. One transaction, rolled back. Prints "224 PASSED".
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  o uuid := gen_random_uuid(); b uuid := gen_random_uuid(); s uuid := gen_random_uuid(); u uuid;
  d0 date := current_date + 10;          -- one-off closed day (all dates stay inside the 30-day online booking window)
  w0 date := current_date + 14;          -- weekly closure, 3 occurrences: w0, w0+7, w0+14 (w0+14 has an exception)
  ser uuid := gen_random_uuid(); open_d date := current_date + 12;
  n int; refused boolean;
BEGIN
  INSERT INTO organizations (id, name, code, slug, industry_type) VALUES (o, 'ZZ224', 'Z224', 'zz224', 'beauty');
  INSERT INTO branches (id, org_id, name) VALUES (b, o, 'ZZ224 b');
  INSERT INTO services (id, org_id, name, duration_minutes, price_npr) VALUES (s, o, 'ZZ224 svc', 60, 1000);
  SELECT id INTO u FROM users LIMIT 1;
  INSERT INTO manual_blocks (org_id, branch_id, block_date, start_time, duration_minutes, prevent_online_booking, description) VALUES (o, b, d0, '00:00', 1440, true, 'private reason');
  INSERT INTO manual_blocks (org_id, branch_id, block_date, start_time, duration_minutes, prevent_online_booking, recurrence_freq, recurrence_interval, recurrence_count, series_id)
    VALUES (o, b, w0, '00:00', 1440, true, 'weekly', 1, 3, ser);
  INSERT INTO manual_block_exceptions (series_id, exception_date) VALUES (ser, w0 + 14);
  -- a closed day that does NOT block online booking, and a part-day block: neither may close the day
  INSERT INTO manual_blocks (org_id, branch_id, block_date, start_time, duration_minutes, prevent_online_booking) VALUES
    (o, b, current_date + 17, '00:00', 1440, false), (o, b, current_date + 18, '09:00', 120, true);

  SET LOCAL ROLE anon;
  SELECT count(*) INTO n FROM public.public_get_closed_dates(b, current_date, current_date + 100);
  ASSERT n = 3, 'public RPC returns d0, w0, w0+7 only (exception, non-online-blocking and part-day excluded), got ' || n;
  ASSERT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'public_get_closed_dates' AND column_name = 'description'), 'dates only';
  refused := false;
  BEGIN PERFORM 1 FROM manual_blocks LIMIT 1; EXCEPTION WHEN insufficient_privilege THEN refused := true; END;
  ASSERT refused OR NOT EXISTS (SELECT 1 FROM manual_blocks), 'anon still cannot read manual_blocks';

  -- anon insert on each kind of closed day is refused; on open days and on the exception date it saves
  FOREACH d0 IN ARRAY ARRAY[d0, w0, w0 + 7] LOOP
    refused := false;
    BEGIN
      INSERT INTO bookings (branch_id, room_id, service_id, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, status, base_amount, final_amount)
      VALUES (b, NULL, s, 'ZZ224 x', '9800000224', d0, '10:00', '11:00', (d0 + time '10:00') at time zone 'Asia/Kathmandu', (d0 + time '11:00') at time zone 'Asia/Kathmandu', 'Pending', 1000, 1000);
    EXCEPTION WHEN OTHERS THEN refused := SQLERRM LIKE 'BRANCH_CLOSED_ONLINE%'; IF NOT refused THEN RAISE NOTICE 'unexpected: %', SQLERRM; END IF; END;
    ASSERT refused, 'anon insert on closed day ' || d0 || ' must be refused with BRANCH_CLOSED_ONLINE';
  END LOOP;
  FOREACH d0 IN ARRAY ARRAY[open_d, w0 + 14, current_date + 17, current_date + 18] LOOP
    INSERT INTO bookings (branch_id, room_id, service_id, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, status, base_amount, final_amount)
    VALUES (b, NULL, s, 'ZZ224 ok', '9800000225', d0, '10:00', '11:00', (d0 + time '10:00') at time zone 'Asia/Kathmandu', (d0 + time '11:00') at time zone 'Asia/Kathmandu', 'Pending', 1000, 1000);
  END LOOP;
  RESET ROLE;
  -- desk/staff insert (created_by set) on the closed day is unchanged
  d0 := current_date + 10;
  INSERT INTO bookings (branch_id, room_id, service_id, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, status, base_amount, final_amount, created_by)
  VALUES (b, NULL, s, 'ZZ224 desk', '9800000226', d0, '10:00', '11:00', (d0 + time '10:00') at time zone 'Asia/Kathmandu', (d0 + time '11:00') at time zone 'Asia/Kathmandu', 'Confirmed', 1000, 1000, u);
  RAISE NOTICE 'closed days: anon refused (one-off, recurring), open/exception/part-day/non-blocking OK, desk unchanged: passed';
END $$;
ROLLBACK;
\echo 224 PASSED
