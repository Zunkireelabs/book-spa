-- Real per-service, duration-aware availability for the customer booking flow.
--
-- The existing public_check_slot_availability() (migration-097) only covers a single date, omits
-- room_id (so the customer-facing UI can't check real room capacity, only a generic
-- gender-headcount estimate), and inner-joins therapists — silently dropping bookings with no
-- therapist_id, which is the norm for customer-flow bookings. This adds a new sibling function
-- (left the original untouched — changing its return shape would need a DROP+CREATE, and other
-- callers may still rely on its current shape) that returns room_id and accepts a date range, so
-- the client can fetch a rolling multi-day window in one call and compute real, duration-aware
-- room availability per service client-side.
--
-- Occupied duration is derived from each booking's OWN start_time/end_time, not from a live join
-- to services.duration_minutes — a booking's actual time span is the source of truth (it can
-- differ from the service's current duration if the service was edited after the booking was
-- made, or the time was manually adjusted), and joining services here would silently under-count
-- occupancy whenever those two drift apart.

CREATE OR REPLACE FUNCTION public.public_check_branch_bookings_range(
  p_branch_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  booking_date date,
  start_time time,
  duration_minutes int,
  room_id uuid,
  therapist_gender text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    b.date AS booking_date,
    b.start_time,
    GREATEST(1, (EXTRACT(EPOCH FROM (b.end_time - b.start_time)) / 60)::int) AS duration_minutes,
    b.room_id,
    t.gender AS therapist_gender
  FROM public.bookings b
  LEFT JOIN public.therapists t ON t.id = b.therapist_id
  WHERE b.branch_id = p_branch_id
    AND b.date BETWEEN p_start_date AND p_end_date
    AND b.status NOT IN ('Cancelled', 'No Show');
$$;

REVOKE ALL ON FUNCTION public.public_check_branch_bookings_range(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_check_branch_bookings_range(uuid, date, date) TO anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('126', 'branch-range-availability') ON CONFLICT (version) DO NOTHING;
