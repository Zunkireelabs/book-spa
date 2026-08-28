-- Branch online-booking capacity enforcement
--
-- The customer-facing online booking flow (customer-booking-flow / -v2) never picks a
-- therapist — it only picks a service + time slot; therapist_id is inserted as NULL and a
-- staff member assigns a therapist later. Because of that, neither of the two existing
-- race-safe protections (the room-capacity trigger, and the excl_therapist_overlap GIST
-- exclusion constraint) actually limits how many online bookings can land on the same
-- slot: excl_therapist_overlap only applies WHERE therapist_id IS NOT NULL, and room
-- capacity is a separate, unrelated limit. So two (or more) customers booking online at the
-- same branch/time can all succeed even though the branch only has a handful of therapists
-- to eventually assign, as long as a room happens to be free for each of them.
--
-- This adds a per-branch "how many therapists do we have for online scheduling" cap
-- (branches.online_booking_capacity, unset/NULL = no cap, unchanged behavior) and a trigger
-- — modeled directly on check_room_capacity() from migration-125 — that only looks at
-- therapist-less (online) bookings and rejects one past that cap. Like the room-capacity
-- trigger, it uses pg_advisory_xact_lock to serialize concurrent writers for the same
-- branch/date, which is what actually resolves "two people booked at the same instant":
-- whichever transaction acquires the lock first gets counted first and wins; the other sees
-- the now-updated count and is rejected. This is enforced by Postgres transaction ordering,
-- not by comparing client timestamps, so it's correct down to the millisecond without the
-- app needing to do anything clock-related itself.

-- 1. Capacity column. NULL = unrestricted (today's behavior, unchanged) for any branch this
-- isn't configured for yet.
ALTER TABLE branches ADD COLUMN IF NOT EXISTS online_booking_capacity integer CHECK (online_booking_capacity > 0);

-- 2. Seed the branches this rule applies to "for now". Matched by name (not id) so this is
-- portable across the staging/production databases per PROMOTION.md.
UPDATE branches SET online_booking_capacity = 2 WHERE name ILIKE '%bhaisepati%' AND online_booking_capacity IS NULL;
UPDATE branches SET online_booking_capacity = 3 WHERE name ILIKE '%thamel%' AND online_booking_capacity IS NULL;
UPDATE branches SET online_booking_capacity = 3 WHERE name ILIKE '%sanepa%' AND online_booking_capacity IS NULL;
UPDATE branches SET online_booking_capacity = 5 WHERE name ILIKE '%lazimpat%' AND online_booking_capacity IS NULL;

-- 3. Race-safe capacity check for therapist-less (online) bookings only. Trigger name is
-- alphabetically after 'trg_compute_datetimes' so NEW.start_datetime/end_datetime are already
-- populated when this runs (same reasoning as trg_room_capacity_check in migration-125).
CREATE OR REPLACE FUNCTION check_branch_online_capacity()
RETURNS TRIGGER AS $$
DECLARE
  v_capacity integer;
  v_occupied integer;
BEGIN
  IF NEW.therapist_id IS NOT NULL OR NEW.status IN ('Cancelled', 'No Show') THEN
    RETURN NEW;
  END IF;

  SELECT online_booking_capacity INTO v_capacity FROM branches WHERE id = NEW.branch_id;
  IF v_capacity IS NULL THEN
    RETURN NEW; -- no cap configured for this branch
  END IF;

  -- Serialize all concurrent writers targeting this branch/date for the rest of this
  -- transaction — closes the count-then-insert race window a plain SELECT count() can't.
  -- Distinct hash input from the room-capacity lock (room_id vs branch_id) so the two never
  -- collide on the same lock key.
  PERFORM pg_advisory_xact_lock(hashtext('online:' || NEW.branch_id::text || ':' || NEW.date::text));

  SELECT count(*) INTO v_occupied
  FROM bookings b
  WHERE b.branch_id = NEW.branch_id
    AND b.therapist_id IS NULL
    AND b.status NOT IN ('Cancelled', 'No Show')
    AND (TG_OP = 'INSERT' OR b.id != NEW.id)
    AND tstzrange(b.start_datetime, b.end_datetime) && tstzrange(NEW.start_datetime, NEW.end_datetime);

  IF v_occupied >= v_capacity THEN
    RAISE EXCEPTION 'BRANCH_ONLINE_CAPACITY: No therapists available at this branch for the selected time.'
      USING ERRCODE = 'P0005';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

DROP TRIGGER IF EXISTS trg_online_capacity_check ON bookings;
CREATE TRIGGER trg_online_capacity_check
  BEFORE INSERT OR UPDATE OF branch_id, therapist_id, date, start_time, service_id, status ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION check_branch_online_capacity();

INSERT INTO public.schema_migrations (version, name)
VALUES ('129', 'branch-online-capacity') ON CONFLICT (version) DO NOTHING;
