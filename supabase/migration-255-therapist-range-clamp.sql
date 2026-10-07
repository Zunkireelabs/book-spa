-- Migration 255: fail loudly on an over-range public_check_therapist_bookings_range call
--
-- migration-253 clamped the range with `AND (p_end_date - p_start_date) <= 90` as a WHERE
-- predicate in each of the function's seven UNION ALL sections. That clamp is correct for
-- cost (an anon-callable function can't be handed an unbounded generate_series), but it
-- fails open: a 120-day call doesn't error, it returns zero rows, and zero rows reads as
-- "nobody is busy" (therapistAvailability.js's buildTherapistOccupancy has nothing to mark
-- as busy). The same shape of fail-open bug hits during deploy skew too — migration-253:48
-- dropped the old 3-arg signature, so an old bundle still in a client's hands gets
-- PGRST202, DateTimeSelection.jsx swallows it into a console.error, and therapistWindow
-- stays null, which (before this session's DateTimeSelection.jsx fix) also read as "every
-- slot free".
--
-- Fix: move the LANGUAGE from sql to plpgsql so an explicit guard can RAISE EXCEPTION
-- before the query ever runs, instead of filtering silently. The seven UNION ALL sections
-- are otherwise byte-identical to migration-253 (same tables, same joins, same per-section
-- <= 90 predicates, left in place as defense in depth -- the guard above them is what
-- actually surfaces the failure now).
--
-- Same signature as migration-253 (text, uuid, date, date), so CREATE OR REPLACE is
-- sufficient -- no DROP needed, and this can't be reached by a client still calling the
-- pre-253 3-arg signature (that one's already gone).
--
-- Reversible: CREATE OR REPLACE back to migration-253's LANGUAGE sql body (drops the guard,
-- restores the fail-open WHERE-only clamp).

BEGIN;

CREATE OR REPLACE FUNCTION public.public_check_therapist_bookings_range(
  p_org_slug text,
  p_branch_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  therapist_id      uuid,
  busy_date         date,
  start_time        time,
  duration_minutes  integer,
  source            text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
BEGIN
  IF p_end_date - p_start_date > 90 THEN
    RAISE EXCEPTION 'public_check_therapist_bookings_range: range may not exceed 90 days';
  END IF;

  RETURN QUERY
  -- a) Directly-assigned bookings
  SELECT
    b.therapist_id,
    b.date AS busy_date,
    b.start_time,
    GREATEST(1, (EXTRACT(EPOCH FROM (b.end_time - b.start_time)) / 60)::int) AS duration_minutes,
    'booking'::text AS source
  FROM public.bookings b
  JOIN public.branches br ON br.id = p_branch_id
  JOIN public.organizations org ON org.id = br.org_id AND org.slug = p_org_slug
  WHERE b.branch_id = p_branch_id
    AND b.therapist_id IS NOT NULL
    AND b.date BETWEEN p_start_date AND p_end_date
    AND (p_end_date - p_start_date) <= 90
    AND b.status NOT IN ('Cancelled', 'No Show')

  UNION ALL

  -- b) booking_therapists junction rows (couple/companion assignments) — per-therapist
  -- start/end within the booking window.
  SELECT
    bt.therapist_id,
    b.date AS busy_date,
    bt.start_time,
    GREATEST(1, (EXTRACT(EPOCH FROM (bt.end_time - bt.start_time)) / 60)::int) AS duration_minutes,
    'booking'::text AS source
  FROM public.booking_therapists bt
  JOIN public.bookings b ON b.id = bt.booking_id
  JOIN public.branches br ON br.id = p_branch_id
  JOIN public.organizations org ON org.id = br.org_id AND org.slug = p_org_slug
  WHERE b.branch_id = p_branch_id
    AND bt.start_time IS NOT NULL
    AND bt.end_time IS NOT NULL
    AND b.date BETWEEN p_start_date AND p_end_date
    AND (p_end_date - p_start_date) <= 90
    AND b.status NOT IN ('Cancelled', 'No Show')

  UNION ALL

  -- c) Unassigned online bookings — NULL therapist_id on purpose: this is what lets
  -- "Any professional" see pending, not-yet-assigned demand instead of ignoring it.
  SELECT
    NULL::uuid AS therapist_id,
    b.date AS busy_date,
    b.start_time,
    GREATEST(1, (EXTRACT(EPOCH FROM (b.end_time - b.start_time)) / 60)::int) AS duration_minutes,
    'unassigned'::text AS source
  FROM public.bookings b
  JOIN public.branches br ON br.id = p_branch_id
  JOIN public.organizations org ON org.id = br.org_id AND org.slug = p_org_slug
  WHERE b.branch_id = p_branch_id
    AND b.therapist_id IS NULL
    AND b.created_by IS NULL
    AND b.date BETWEEN p_start_date AND p_end_date
    AND (p_end_date - p_start_date) <= 90
    AND b.status NOT IN ('Cancelled', 'No Show')

  UNION ALL

  -- d) Therapist-scoped manual blocks (migration-212's recurrence expansion, reused —
  -- migration-213 explicitly excludes these from the room-capacity RPC).
  SELECT
    mb.therapist_id,
    occ.occ_date AS busy_date,
    mb.start_time,
    mb.duration_minutes,
    'block'::text AS source
  FROM public.manual_blocks mb
  JOIN public.branches br ON br.id = p_branch_id
  JOIN public.organizations org ON org.id = br.org_id AND org.slug = p_org_slug
  CROSS JOIN LATERAL (
    SELECT public.manual_block_occurrence_date(mb.block_date, mb.recurrence_freq, mb.recurrence_interval, n) AS occ_date
    FROM generate_series(0, CASE WHEN mb.recurrence_freq IS NULL THEN 0 ELSE LEAST(COALESCE(mb.recurrence_count, 500) - 1, 500) END) AS n
  ) occ
  WHERE mb.branch_id = p_branch_id
    AND mb.therapist_id IS NOT NULL
    AND mb.prevent_online_booking = true
    AND mb.is_cancelled = false
    AND occ.occ_date BETWEEN p_start_date AND p_end_date
    AND (p_end_date - p_start_date) <= 90
    AND (mb.recurrence_end_date IS NULL OR occ.occ_date <= mb.recurrence_end_date)
    AND NOT EXISTS (
      SELECT 1 FROM public.manual_block_exceptions mbe
      WHERE mbe.series_id = mb.series_id AND mbe.exception_date = occ.occ_date
    )

  UNION ALL

  -- e) Whole-location blocks (no room, no therapist) fanned across every active
  -- service-staff therapist at the branch — same mechanism as (d), different scope.
  SELECT
    t.id AS therapist_id,
    occ.occ_date AS busy_date,
    mb.start_time,
    mb.duration_minutes,
    'block'::text AS source
  FROM public.manual_blocks mb
  JOIN public.therapists t
    ON t.branch_id = mb.branch_id AND t.is_active = true AND t.is_service_staff = true
  JOIN public.branches br ON br.id = p_branch_id
  JOIN public.organizations org ON org.id = br.org_id AND org.slug = p_org_slug
  CROSS JOIN LATERAL (
    SELECT public.manual_block_occurrence_date(mb.block_date, mb.recurrence_freq, mb.recurrence_interval, n) AS occ_date
    FROM generate_series(0, CASE WHEN mb.recurrence_freq IS NULL THEN 0 ELSE LEAST(COALESCE(mb.recurrence_count, 500) - 1, 500) END) AS n
  ) occ
  WHERE mb.branch_id = p_branch_id
    AND mb.room_id IS NULL
    AND mb.therapist_id IS NULL
    AND mb.prevent_online_booking = true
    AND mb.is_cancelled = false
    AND occ.occ_date BETWEEN p_start_date AND p_end_date
    AND (p_end_date - p_start_date) <= 90
    AND (mb.recurrence_end_date IS NULL OR occ.occ_date <= mb.recurrence_end_date)
    AND NOT EXISTS (
      SELECT 1 FROM public.manual_block_exceptions mbe
      WHERE mbe.series_id = mb.series_id AND mbe.exception_date = occ.occ_date
    )

  UNION ALL

  -- f) Attendance: leave-like statuses block the whole day (half-day statuses
  -- deliberately not modeled — same gap as createBooking's existing JS guard).
  SELECT
    ta.therapist_id,
    ta.date AS busy_date,
    '00:00'::time AS start_time,
    1440 AS duration_minutes,
    'absence'::text AS source
  FROM public.therapist_attendance ta
  JOIN public.branches br ON br.id = p_branch_id
  JOIN public.organizations org ON org.id = br.org_id AND org.slug = p_org_slug
  WHERE ta.branch_id = p_branch_id
    AND ta.date BETWEEN p_start_date AND p_end_date
    AND (p_end_date - p_start_date) <= 90
    AND ta.status IN ('Absent', 'Leave', 'Annual Leave', 'Sick Leave', 'Day Off')

  UNION ALL

  -- f2) Checkout tail: from the moment they checked out to the end of that day.
  SELECT
    ta.therapist_id,
    ta.date AS busy_date,
    (ta.check_out_time AT TIME ZONE 'Asia/Kathmandu')::time AS start_time,
    GREATEST(1, 1440 - (EXTRACT(HOUR FROM (ta.check_out_time AT TIME ZONE 'Asia/Kathmandu')) * 60
      + EXTRACT(MINUTE FROM (ta.check_out_time AT TIME ZONE 'Asia/Kathmandu')))::int) AS duration_minutes,
    'checkout'::text AS source
  FROM public.therapist_attendance ta
  JOIN public.branches br ON br.id = p_branch_id
  JOIN public.organizations org ON org.id = br.org_id AND org.slug = p_org_slug
  WHERE ta.branch_id = p_branch_id
    AND ta.date BETWEEN p_start_date AND p_end_date
    AND (p_end_date - p_start_date) <= 90
    AND ta.check_out_time IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.public_check_therapist_bookings_range(text, uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_check_therapist_bookings_range(text, uuid, date, date) TO anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('255', 'therapist-range-clamp')
ON CONFLICT (version) DO NOTHING;

COMMIT;
