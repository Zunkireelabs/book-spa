-- Room capacity enforcement
--
-- Today, `excl_room_overlap` (a GIST exclusion constraint on bookings) hardcodes capacity=1 for
-- every room: it forbids ANY two overlapping bookings sharing a room_id, full stop. Meanwhile the
-- app computes a room's capacity in JS by regex-parsing a leading number out of
-- rooms.amenities[0] (e.g. "3 Chair" -> 3) and believes multi-seat rooms (salon chairs, nail bar
-- stations, etc.) can hold several concurrent bookings. In production, the 2nd concurrent booking
-- into a "3 Chair" room is already silently rejected by the database today.
--
-- This migration adds a real `rooms.capacity` column (backfilled from the same regex the app
-- already uses, so behavior is unchanged for already-configured rooms), drops the capacity=1
-- exclusion constraint, and replaces it with a trigger that allows up to `capacity` concurrent
-- overlapping bookings per room while remaining race-safe under concurrent transactions via an
-- advisory lock keyed on (room_id, date).

-- 1. Real capacity column, backfilled from today's amenities-parsing convention.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS capacity integer NOT NULL DEFAULT 1 CHECK (capacity > 0);

UPDATE rooms
SET capacity = COALESCE(substring(amenities[1] FROM '^(\d+)')::integer, 1)
WHERE capacity = 1;

-- 2. Drop the capacity=1-hardcoded exclusion constraint.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS excl_room_overlap;

-- 3. Capacity-aware replacement. Fires after trg_compute_datetimes (alphabetical trigger
-- ordering: 'trg_compute_datetimes' < 'trg_room_capacity_check'), so NEW.start_datetime /
-- NEW.end_datetime are already populated when this trigger runs.
CREATE OR REPLACE FUNCTION check_room_capacity()
RETURNS TRIGGER AS $$
DECLARE
  v_capacity integer;
  v_occupied integer;
BEGIN
  IF NEW.room_id IS NULL OR NEW.status IN ('Cancelled', 'No Show') THEN
    RETURN NEW;
  END IF;

  -- Serialize all concurrent writers targeting this room/date for the rest of this transaction —
  -- this is what closes the count-then-insert race window a plain SELECT count() can't.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.room_id::text || NEW.date::text));

  SELECT capacity INTO v_capacity FROM rooms WHERE id = NEW.room_id;

  SELECT count(*) INTO v_occupied
  FROM bookings b
  WHERE b.room_id = NEW.room_id
    AND b.status NOT IN ('Cancelled', 'No Show')
    AND (TG_OP = 'INSERT' OR b.id != NEW.id)
    AND tstzrange(b.start_datetime, b.end_datetime) && tstzrange(NEW.start_datetime, NEW.end_datetime);

  IF v_occupied >= COALESCE(v_capacity, 1) THEN
    RAISE EXCEPTION 'ROOM_AT_CAPACITY: Room is fully booked for this time range.'
      USING ERRCODE = 'P0003';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

DROP TRIGGER IF EXISTS trg_room_capacity_check ON bookings;
CREATE TRIGGER trg_room_capacity_check
  BEFORE INSERT OR UPDATE OF room_id, date, start_time, service_id, status ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION check_room_capacity();

INSERT INTO public.schema_migrations (version, name)
VALUES ('125', 'room-capacity-enforcement') ON CONFLICT (version) DO NOTHING;
