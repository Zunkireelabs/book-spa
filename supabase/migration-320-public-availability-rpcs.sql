-- Migration 320: customer-facing availability (ZNLY-100, V29a)
--  * public_check_therapist_bookings_range gains rows with source off / break / leave / other_branch / block for
--    tenants with enforce_staff_availability on (unchanged for tenants with it off).
--  * public_check_branch_bookings_range ("Any professional"): new optional p_service_id + p_duration_minutes. When both
--    are given and the tenant switch is on it also returns source='no_staff' rows: each row's start_time is a 15-minute
--    grid start that is NOT offered because no eligible therapist is on shift and free for the whole duration
--    (match on start_time equality, not overlap). New column "source" ('booking' | 'block' | 'no_staff').
-- Reversible (manual): restore the migration-255 / migration-213 bodies.
BEGIN;

CREATE OR REPLACE FUNCTION public.public_check_therapist_bookings_range(p_org_slug text, p_branch_id uuid, p_start_date date, p_end_date date)
 RETURNS TABLE(therapist_id uuid, busy_date date, start_time time without time zone, duration_minutes integer, source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND ta.check_out_time IS NOT NULL

  UNION ALL

  -- g) Staff availability (migration 319's rule), only for tenants with enforce_staff_availability on:
  -- off shift / day off, breaks, half-day leave, other-branch transfer windows and every manual block.
  -- Full-day leave stays on the 'absence' row above; booked time on the booking rows above.
  SELECT
    t.id AS therapist_id,
    d.d::date AS busy_date,
    make_time(u.start_min / 60, u.start_min % 60, 0) AS start_time,
    GREATEST(1, u.end_min - u.start_min) AS duration_minutes,
    CASE u.code WHEN 'OFF_SHIFT' THEN 'off' WHEN 'ON_BREAK' THEN 'break' WHEN 'ON_LEAVE' THEN 'leave'
                WHEN 'OTHER_BRANCH' THEN 'other_branch' ELSE 'block' END AS source
  FROM public.branches br
  JOIN public.organizations org ON org.id = br.org_id AND org.slug = p_org_slug AND org.enforce_staff_availability
  JOIN public.therapists t ON t.branch_id = br.id AND t.is_active = true AND t.is_service_staff = true
  CROSS JOIN generate_series(p_start_date::timestamp, p_end_date::timestamp, interval '1 day') AS d(d)
  CROSS JOIN LATERAL public.therapist_unavailable_ranges(t.id, d.d::date, br.id) u
  WHERE br.id = p_branch_id
    AND (p_end_date - p_start_date) <= 90
    AND u.code <> 'OVERLAP'
    AND u.reason <> 'leave_full'
    AND u.start_min < 1440;
END;
$function$;

-- CONTRACT for the "Any professional" slot picker (V29b):
--   * rows with source 'booking' / 'block' are busy intervals (start_time + duration_minutes, per room): use overlap logic.
--   * rows with source 'no_staff' are NOT intervals. Each one says: "a booking of p_duration_minutes starting exactly at
--     start_time is not offered (no eligible therapist is on shift and free for the whole duration)". They sit on a
--     15-minute grid; their duration_minutes is always 15 and must be ignored. Match on START-TIME EQUALITY, never overlap.
--   * they appear only when the tenant switch is on AND both p_service_id and p_duration_minutes are given.
DROP FUNCTION IF EXISTS public.public_check_branch_bookings_range(uuid, date, date);

CREATE OR REPLACE FUNCTION public.public_check_branch_bookings_range(
  p_branch_id uuid, p_start_date date, p_end_date date,
  p_service_id uuid DEFAULT NULL, p_duration_minutes integer DEFAULT NULL)
RETURNS TABLE(booking_date date, start_time time without time zone, duration_minutes integer, room_id uuid, therapist_gender text, source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    b.date AS booking_date,
    b.start_time,
    GREATEST(1, (EXTRACT(EPOCH FROM (b.end_time - b.start_time)) / 60)::int) AS duration_minutes,
    b.room_id,
    t.gender AS therapist_gender,
    'booking'::text AS source
  FROM public.bookings b
  LEFT JOIN public.therapists t ON t.id = b.therapist_id
  WHERE b.branch_id = p_branch_id
    AND b.date BETWEEN p_start_date AND p_end_date
    AND b.status NOT IN ('Cancelled', 'No Show')

  UNION ALL

  SELECT
    occ.occ_date AS booking_date,
    mb.start_time,
    mb.duration_minutes,
    mb.room_id,
    NULL::text AS therapist_gender,
    'block'::text AS source
  FROM public.manual_blocks mb
  CROSS JOIN LATERAL (
    SELECT public.manual_block_occurrence_date(mb.block_date, mb.recurrence_freq, mb.recurrence_interval, n) AS occ_date
    FROM generate_series(0, CASE WHEN mb.recurrence_freq IS NULL THEN 0 ELSE LEAST(COALESCE(mb.recurrence_count, 500) - 1, 500) END) AS n
  ) occ
  WHERE mb.branch_id = p_branch_id
    AND mb.room_id IS NOT NULL
    AND mb.prevent_online_booking = true
    AND mb.is_cancelled = false
    AND occ.occ_date BETWEEN p_start_date AND p_end_date
    AND (mb.recurrence_end_date IS NULL OR occ.occ_date <= mb.recurrence_end_date)
    AND NOT EXISTS (
      SELECT 1 FROM public.manual_block_exceptions mbe
      WHERE mbe.series_id = mb.series_id AND mbe.exception_date = occ.occ_date
    )

  UNION ALL

  -- Whole-location blocks (no room, no therapist) reduce capacity for every active room.
  SELECT
    occ.occ_date AS booking_date,
    mb.start_time,
    mb.duration_minutes,
    r.id AS room_id,
    NULL::text AS therapist_gender,
    'block'::text AS source
  FROM public.manual_blocks mb
  JOIN public.rooms r ON r.branch_id = mb.branch_id AND r.is_active = true
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
    AND (mb.recurrence_end_date IS NULL OR occ.occ_date <= mb.recurrence_end_date)
    AND NOT EXISTS (
      SELECT 1 FROM public.manual_block_exceptions mbe
      WHERE mbe.series_id = mb.series_id AND mbe.exception_date = occ.occ_date
    )

  UNION ALL

  -- "Any professional": a start is offered only if at least one eligible therapist is on shift and free for the
  -- whole duration (shift, breaks, leave, blocks, transfers and other bookings all count).
  SELECT
    d.d::date AS booking_date,
    make_time(s.s / 60, s.s % 60, 0) AS start_time,
    15 AS duration_minutes,
    NULL::uuid AS room_id,
    NULL::text AS therapist_gender,
    'no_staff'::text AS source
  FROM public.branches br
  JOIN public.organizations o ON o.id = br.org_id AND o.enforce_staff_availability
  CROSS JOIN generate_series(p_start_date::timestamp, LEAST(p_end_date, p_start_date + 90)::timestamp, interval '1 day') AS d(d)
  CROSS JOIN LATERAL generate_series(
    COALESCE((EXTRACT(EPOCH FROM br.open_time) / 60)::int, 0),
    COALESCE((EXTRACT(EPOCH FROM br.close_time) / 60)::int, 1440) - p_duration_minutes, 15) AS s(s)
  WHERE br.id = p_branch_id
    AND p_service_id IS NOT NULL AND p_duration_minutes IS NOT NULL AND p_duration_minutes > 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.therapists t
      WHERE t.branch_id = br.id AND t.is_active = true AND t.is_service_staff = true
        AND (NOT EXISTS (SELECT 1 FROM public.service_therapists st JOIN public.therapists tt ON tt.id = st.therapist_id
                          WHERE st.service_id = p_service_id AND tt.branch_id = br.id)
             OR EXISTS (SELECT 1 FROM public.service_therapists st WHERE st.service_id = p_service_id AND st.therapist_id = t.id))
        AND NOT EXISTS (
          SELECT 1 FROM public.therapist_unavailable_ranges(t.id, d.d::date, br.id) u
          WHERE u.start_min < s.s + p_duration_minutes AND u.end_min > s.s)
    );
$$;

GRANT EXECUTE ON FUNCTION public.public_check_branch_bookings_range(uuid, date, date, uuid, integer) TO anon, authenticated;
COMMENT ON FUNCTION public.public_check_branch_bookings_range(uuid, date, date, uuid, integer) IS
  'Busy intervals for the branch (source booking/block: overlap logic). Rows with source no_staff are 15-minute-grid START TIMES that are not offered for p_duration_minutes: match on start_time equality, not overlap; duration_minutes (15) is meaningless there. Only when the tenant switch is on and p_service_id + p_duration_minutes are given.';

-- One read RPC for the UI: shift, breaks and off ranges per therapist per date (org-scoped). The UI keeps no copy
-- of the rule; this returns exactly what the guard applies.
CREATE OR REPLACE FUNCTION public.therapist_shifts_for_range(p_branch_id uuid, p_from_date date, p_to_date date)
RETURNS TABLE(therapist_id uuid, shift_date date, works boolean, start_time time without time zone, end_time time without time zone,
              source text, breaks jsonb, off jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_to_date - p_from_date > 92 THEN
    RAISE EXCEPTION 'therapist_shifts_for_range: range may not exceed 92 days';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = p_branch_id AND br.org_id = (SELECT get_user_org_id())) THEN
    RETURN;  -- not this caller's organization
  END IF;

  RETURN QUERY
  SELECT t.id, d.d::date,
         (sh->>'works')::boolean,
         CASE WHEN sh->>'start' IS NULL THEN NULL ELSE (sh->>'start')::time END,
         CASE WHEN sh->>'end' IS NULL THEN NULL WHEN sh->>'end' = '24:00' THEN '23:59:59'::time ELSE (sh->>'end')::time END,
         sh->>'source',
         sh->'breaks',
         COALESCE((SELECT jsonb_agg(jsonb_build_object('code', u.code, 'reason', u.reason, 'label', u.label,
                          'start', public.minutes_to_hhmm(u.start_min), 'end', public.minutes_to_hhmm(u.end_min),
                          'start_min', u.start_min, 'end_min', u.end_min) ORDER BY u.start_min)
                     FROM public.therapist_unavailable_ranges(t.id, d.d::date, p_branch_id) u
                    WHERE u.code IN ('ON_LEAVE', 'BLOCKED', 'OTHER_BRANCH')), '[]'::jsonb)
  FROM public.therapists t
  CROSS JOIN generate_series(p_from_date::timestamp, p_to_date::timestamp, interval '1 day') AS d(d)
  CROSS JOIN LATERAL public.therapist_shift_for(t.id, d.d::date, p_branch_id) AS sh
  WHERE t.branch_id = p_branch_id AND t.is_active = true
  ORDER BY t.id, d.d;
END;
$$;
REVOKE ALL ON FUNCTION public.therapist_shifts_for_range(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.therapist_shifts_for_range(uuid, date, date) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('320', 'public-availability-rpcs')
ON CONFLICT (version) DO NOTHING;

COMMIT;
