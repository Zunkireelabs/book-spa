-- Fix: branch online-booking capacity (migration-138) was blocking staff bookings too
--
-- check_branch_online_capacity() identified an "online" booking purely by
-- therapist_id IS NULL. But StaffBookingForm.jsx (branch-staff-dashboard) also creates
-- bookings without a therapist selected — a staff member picks service/time/customer and
-- assigns a therapist later, exactly like the customer flow. So a handful of unassigned
-- staff bookings at Thamel/Sanepa/Bhaisepati/Lazimpat could trip the same cap meant only
-- for the public customer-booking-flow, blocking staff from adding more bookings even
-- though plenty of therapist-assigned bookings existed that day.
--
-- createBooking() already records who created each booking: `created_by: authUser?.id ||
-- null` (src/services/api.js). The public customer-booking-flow is unauthenticated, so
-- created_by is NULL only for genuine online/customer self-bookings; every staff-side path
-- (StaffBookingForm, branch-manager-dashboard calendar) runs authenticated, so created_by is
-- always set. No new column needed — just tighten the existing check to require both
-- "no therapist yet" AND "created anonymously" before it counts as an online booking.

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

INSERT INTO public.schema_migrations (version, name)
VALUES ('159', 'online-capacity-created-by-fix') ON CONFLICT (version) DO NOTHING;
