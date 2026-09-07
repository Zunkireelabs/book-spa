-- Migration 155: exempt staff-created bookings from the online-capacity cap (additive, REVERSIBLE)
--
-- migration-138's check_branch_online_capacity() was written for the customer-facing
-- self-booking flow (which never picks a therapist — see its own header comment), but the
-- trigger condition only checked `NEW.therapist_id IS NULL`, so it also caught staff walk-in
-- group bookings created from the manager dashboard's Calendar/New Booking flow whenever
-- staff left a person's therapist as "No therapist" (the normal case for a walk-in group
-- where therapists get assigned after the fact). Both flows insert through the same
-- createBooking() (src/services/api.js).
--
-- Surfaced 2026-09-03: a 6-person walk-in group at Thamel (online_booking_capacity = 3) only
-- got 2 of 6 bookings through before hitting "This time is fully booked — no therapists
-- available", even though the branch manager creating them was standing right there able to
-- assign real therapists. Per explicit product decision: this cap should only constrain
-- anonymous end-customer self-bookings, not staff who are already authenticated and present.
--
-- Fix: skip the cap whenever NEW.created_by IS NOT NULL — createBooking() sets created_by to
-- the authenticated staff user's id for every staff-initiated booking (dashboard walk-ins,
-- phone bookings, etc.) and leaves it NULL for the public customer-booking-flow, which has no
-- authenticated user. This is the same signal already used elsewhere in the app to
-- distinguish staff- from customer-initiated bookings — no new column needed.
--
-- Reversible: re-run migration-138's original check_branch_online_capacity() body (drop the
-- new `OR NEW.created_by IS NOT NULL` branch below).

CREATE OR REPLACE FUNCTION check_branch_online_capacity()
RETURNS TRIGGER AS $$
DECLARE
  v_capacity integer;
  v_occupied integer;
BEGIN
  IF NEW.therapist_id IS NOT NULL OR NEW.created_by IS NOT NULL OR NEW.status IN ('Cancelled', 'No Show') THEN
    RETURN NEW;
  END IF;

  SELECT online_booking_capacity INTO v_capacity FROM branches WHERE id = NEW.branch_id;
  IF v_capacity IS NULL THEN
    RETURN NEW; -- no cap configured for this branch
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('online:' || NEW.branch_id::text || ':' || NEW.date::text));

  SELECT count(*) INTO v_occupied
  FROM bookings b
  WHERE b.branch_id = NEW.branch_id
    AND b.therapist_id IS NULL
    AND b.created_by IS NULL
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

-- Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('155', 'online-capacity-exempt-staff')
ON CONFLICT (version) DO NOTHING;
