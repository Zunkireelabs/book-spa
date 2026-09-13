-- Couple massage: one booking, two separate rooms
--
-- Today a booking has exactly one room (bookings.room_id) but can have N therapists via
-- booking_therapists. Couple massage sometimes needs each person in a separate room with their
-- own therapist -- the schema has no way to express a second room on one booking row (the
-- alternative, splitting into two rows via booking_group_id, is a different existing flow the
-- product explicitly does not want used here).
--
-- This adds a nullable per-therapist room override on booking_therapists (NULL = "use the
-- booking's primary room", the zero-write default for the common single-room case) plus
-- companion (2nd guest) name/phone on bookings. Capacity for an override room is enforced by a
-- new trigger mirroring check_room_capacity() (migration-130), since that trigger only ever
-- looks at bookings.room_id and never sees a booking_therapists.room_id override.
--
-- Known pre-existing gap, not introduced or worsened here: the non-primary therapist in
-- booking_therapists has no GIST-level double-booking protection (excl_therapist_overlap only
-- covers the primary bookings.therapist_id). Out of scope for this migration.

-- 1. Companion (2nd guest) info -- optional, no CHECK forcing presence.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS companion_name text,
  ADD COLUMN IF NOT EXISTS companion_phone text;

-- 2. Per-therapist room override. NULL falls back to bookings.room_id everywhere in app code.
ALTER TABLE booking_therapists
  ADD COLUMN IF NOT EXISTS room_id uuid REFERENCES rooms(id);

CREATE INDEX IF NOT EXISTS idx_booking_therapists_room
  ON booking_therapists(room_id) WHERE room_id IS NOT NULL;

-- 3. Capacity enforcement for override rooms. Occupancy must union both bookings.room_id matches
-- (the primary-room case, already covered by check_room_capacity but re-counted here for rooms
-- used as an override) and other booking_therapists.room_id matches, since either can occupy an
-- override room. Time window comes from the parent booking's date + this row's own start_time/
-- end_time, falling back to the parent booking's start_time/end_time when this row's are null
-- (matching the existing backfill-on-write convention from migration-023).
CREATE OR REPLACE FUNCTION check_booking_therapist_room_capacity()
RETURNS TRIGGER AS $$
DECLARE
  v_capacity integer;
  v_occupied integer;
  v_date date;
  v_start_time time;
  v_end_time time;
  v_start_dt timestamptz;
  v_end_dt timestamptz;
  v_booking_status text;
BEGIN
  IF NEW.room_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT b.date, b.status,
         COALESCE(NEW.start_time, b.start_time),
         COALESCE(NEW.end_time, b.end_time)
    INTO v_date, v_booking_status, v_start_time, v_end_time
  FROM bookings b
  WHERE b.id = NEW.booking_id;

  IF v_booking_status IN ('Cancelled', 'No Show') THEN
    RETURN NEW;
  END IF;

  v_start_dt := (v_date + v_start_time) AT TIME ZONE 'Asia/Kathmandu';
  v_end_dt := (v_date + v_end_time) AT TIME ZONE 'Asia/Kathmandu';

  -- Same advisory-lock pattern as check_room_capacity(): serialize concurrent writers targeting
  -- this room/date for the rest of this transaction.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.room_id::text || v_date::text));

  SELECT capacity INTO v_capacity FROM rooms WHERE id = NEW.room_id;

  SELECT
    (SELECT count(*)
       FROM bookings b
       WHERE b.room_id = NEW.room_id
         AND b.status NOT IN ('Cancelled', 'No Show')
         AND tstzrange(b.start_datetime, b.end_datetime) && tstzrange(v_start_dt, v_end_dt))
    +
    (SELECT count(*)
       FROM booking_therapists bt
       JOIN bookings b2 ON b2.id = bt.booking_id
       WHERE bt.room_id = NEW.room_id
         AND b2.status NOT IN ('Cancelled', 'No Show')
         AND bt.booking_id != NEW.booking_id
         AND (TG_OP = 'INSERT' OR bt.id != NEW.id)
         AND tstzrange(
               (b2.date + COALESCE(bt.start_time, b2.start_time)) AT TIME ZONE 'Asia/Kathmandu',
               (b2.date + COALESCE(bt.end_time, b2.end_time)) AT TIME ZONE 'Asia/Kathmandu'
             ) && tstzrange(v_start_dt, v_end_dt))
  INTO v_occupied;

  IF v_occupied >= COALESCE(v_capacity, 1) THEN
    RAISE EXCEPTION 'ROOM_AT_CAPACITY: Room is fully booked for this time range.'
      USING ERRCODE = 'P0003';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

DROP TRIGGER IF EXISTS trg_booking_therapist_room_capacity_check ON booking_therapists;
CREATE TRIGGER trg_booking_therapist_room_capacity_check
  BEFORE INSERT OR UPDATE OF room_id ON booking_therapists
  FOR EACH ROW
  EXECUTE FUNCTION check_booking_therapist_room_capacity();

INSERT INTO public.schema_migrations (version, name)
VALUES ('171', 'couple-separate-rooms') ON CONFLICT (version) DO NOTHING;
