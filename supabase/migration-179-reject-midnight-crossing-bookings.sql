-- ============================================================
-- Migration 179: reject bookings whose service crosses midnight
-- ============================================================
--
-- compute_booking_datetimes() (BEFORE INSERT/UPDATE trigger on bookings)
-- computes `end_time := start_time + duration` using plain `time`
-- arithmetic, which wraps modulo 24h instead of rolling into the next
-- calendar day. A booking whose start_time + service duration pushes past
-- midnight (e.g. 23:30 + 90min -> 01:00) got an end_time NUMERICALLY
-- SMALLER than start_time, so end_datetime ended up before start_datetime
-- (same `date`) — which then broke the room/therapist overlap exclusion
-- constraints (`EXCLUDE USING GIST (... tstzrange(start_datetime,
-- end_datetime) ...)`) with a raw, unfriendly Postgres error: "range lower
-- bound must be less than or equal to range upper bound".
--
-- This business operates fixed daytime hours (branches.open_time/
-- close_time, migration-079 — default 09:00-21:00, no overnight service
-- precedent anywhere in the schema), so a midnight-crossing booking is
-- invalid input, not a legitimate late-night booking. Fix: reject it
-- up front with a clear, friendly error — same RAISE EXCEPTION
-- 'CODE: message' convention already used elsewhere in this schema
-- (migration-002's ATTENDANCE_DAY_LOCKED, migration-044's
-- PAYROLL_FINALIZED, etc.) — instead of letting it silently corrupt the
-- computed range and fail later, confusingly, on the exclusion constraint.
--
-- Safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.compute_booking_datetimes()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  svc_duration integer;
BEGIN
  -- Fetch service duration
  SELECT duration_minutes INTO svc_duration
  FROM services
  WHERE id = NEW.service_id;

  IF svc_duration IS NULL THEN
    RAISE EXCEPTION 'Service not found: %', NEW.service_id;
  END IF;

  -- Compute end_time from start_time + duration
  NEW.end_time := NEW.start_time + (svc_duration * interval '1 minute');

  -- `time + interval` wraps at 24h rather than rolling to the next day —
  -- if that happened, end_time is now <= start_time, which would silently
  -- build an inverted (and therefore invalid) start_datetime/end_datetime
  -- range below. Reject explicitly instead.
  IF NEW.end_time <= NEW.start_time THEN
    RAISE EXCEPTION 'BOOKING_CROSSES_MIDNIGHT: A %-minute service starting at % would extend past midnight — please choose an earlier start time.',
      svc_duration, to_char(NEW.start_time, 'HH12:MI AM');
  END IF;

  -- Compute timestamptz values (Nepal timezone: Asia/Kathmandu = UTC+5:45)
  NEW.start_datetime := (NEW.date + NEW.start_time) AT TIME ZONE 'Asia/Kathmandu';
  NEW.end_datetime := (NEW.date + NEW.end_time) AT TIME ZONE 'Asia/Kathmandu';

  RETURN NEW;
END;
$function$;

-- ============================================================
-- MIGRATION 179 COMPLETE
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('179', 'reject-midnight-crossing-bookings')
ON CONFLICT (version) DO NOTHING;
