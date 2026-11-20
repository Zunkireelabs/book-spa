-- ZNLY-275: no Start / Complete / No-show for a booking on a later day (migration 403). ROLLS BACK, safe on any database.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  b uuid; fut date := (now() AT TIME ZONE 'Asia/Kathmandu')::date + 3; today date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  st booking_status; ok boolean; msg text;
BEGIN
  SELECT id INTO b FROM bookings WHERE status = 'Confirmed' AND therapist_id IS NOT NULL ORDER BY created_at DESC LIMIT 1;
  ASSERT b IS NOT NULL, 'need a Confirmed booking in the local data';
  ALTER TABLE bookings DISABLE TRIGGER USER;  -- move the row's date without the other guards (capacity, window); re-enabled right after
  UPDATE bookings SET date = fut WHERE id = b;
  ALTER TABLE bookings ENABLE TRIGGER USER;
  -- 1-3: future booking can't start / complete / no-show
  FOREACH st IN ARRAY ARRAY['In-Progress','Completed','No Show']::booking_status[] LOOP
    ok := false;
    BEGIN UPDATE bookings SET status = st WHERE id = b;
    EXCEPTION WHEN SQLSTATE 'P0275' THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT; ok := true; END;
    ASSERT ok, format('future booking must not move to %s', st);
    ASSERT msg LIKE 'FUTURE_BOOKING: This booking is for %. Move it to today to %.', 'message shape: ' || msg;
  END LOOP;
  -- 4: cancel passes; a non-status edit of an existing future Completed row passes
  UPDATE bookings SET status = 'Cancelled', cancellation_reason = 'test' WHERE id = b;
  ALTER TABLE bookings DISABLE TRIGGER USER;
  UPDATE bookings SET status = 'Completed' WHERE id = b;   -- an existing future-dated Completed row
  ALTER TABLE bookings ENABLE TRIGGER USER;
  UPDATE bookings SET special_requests = 'edited' WHERE id = b;
  RAISE NOTICE 'ZNLY-275 future: blocked x3, cancel ok, edit of future Completed ok';
  -- 5: today's booking passes
  ALTER TABLE bookings DISABLE TRIGGER USER;
  UPDATE bookings SET date = today, status = 'Confirmed' WHERE id = b;
  ALTER TABLE bookings ENABLE TRIGGER USER;
  UPDATE bookings SET status = 'In-Progress' WHERE id = b;
  UPDATE bookings SET status = 'Completed' WHERE id = b;
  RAISE NOTICE 'ZNLY-275 today: start + complete ok';
END $$;
ROLLBACK;
