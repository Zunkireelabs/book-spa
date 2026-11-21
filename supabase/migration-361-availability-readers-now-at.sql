-- Migration 361: availability + direct users.branch_id readers follow "now at" instead of the old branch flip (ZNLY-113).
-- Rule (owner decision 2): at the receiving branch a lent therapist is bookable only INSIDE the open window and only for
-- services they already do at home (home allow-list; matched to the receiving branch's service by lower(trim(name))).
-- Away from home and outside every window into that branch they are unavailable (OTHER_BRANCH). The home branch stays
-- unavailable during the window (existing mig 351 rule).
--   _therapist_visits_branch_on / _visitor_service_ok     new internal helpers
--   therapist_unavailable_ranges, therapist_shifts_for_range, public_check_therapist_bookings_range, check_therapist_booking_guards
--   public_get_bookable_therapists, public_check_branch_bookings_range ('no_staff' capacity)
--   list_discount_approvers (029), notify_left_behind_bookings (040), notify_new_online_booking (335)
-- Not changed (home is correct): _inv_notify_low (345) notifies managers/admins by users.branch_id.
-- Idempotent. Applied: stage - / prod -.

BEGIN;

CREATE OR REPLACE FUNCTION public._therapist_visits_branch_on(p_therapist_id uuid, p_branch_id uuid, p_date date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public._staff_transfer_windows(ARRAY[p_therapist_id]) w
     WHERE w.to_branch_id = p_branch_id
       AND NOT w.is_return_leg AND NOT w.is_permanent
       AND w.ws < ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu')
       AND w.we > (p_date::timestamp AT TIME ZONE 'Asia/Kathmandu'));
$$;
REVOKE ALL ON FUNCTION public._therapist_visits_branch_on(uuid, uuid, date) FROM PUBLIC, anon, authenticated;

-- Eligible at the receiving branch iff the therapist does a same-named service at home: on that service's allow-list,
-- or that service has no allow-list among the therapist's home colleagues (empty list = everyone, as everywhere else).
CREATE OR REPLACE FUNCTION public._visitor_service_ok(p_therapist_id uuid, p_service_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.services s
      JOIN public.services s2 ON s2.org_id = s.org_id AND lower(btrim(s2.name)) = lower(btrim(s.name))
      JOIN public.therapists t ON t.id = p_therapist_id
     WHERE s.id = p_service_id
       AND (EXISTS (SELECT 1 FROM public.service_therapists x WHERE x.service_id = s2.id AND x.therapist_id = t.id)
            OR NOT EXISTS (SELECT 1 FROM public.service_therapists x JOIN public.therapists xt ON xt.id = x.therapist_id
                            WHERE x.service_id = s2.id AND xt.branch_id = t.branch_id)));
$$;
REVOKE ALL ON FUNCTION public._visitor_service_ok(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.therapist_unavailable_ranges(p_therapist_id uuid, p_date date, p_branch_id uuid DEFAULT NULL::uuid, p_exclude_booking_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(start_min integer, end_min integer, code text, reason text, label text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_branch uuid;
  v_shift  jsonb;
  v_day0   timestamptz := (p_date::timestamp AT TIME ZONE 'Asia/Kathmandu');
  v_day1   timestamptz := ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu');
BEGIN
  SELECT COALESCE(p_branch_id, t.branch_id) INTO v_branch FROM public.therapists t WHERE t.id = p_therapist_id;
  v_shift := public.therapist_shift_for(p_therapist_id, p_date, v_branch);

  -- full-day leave
  RETURN QUERY SELECT 0, 1440, 'ON_LEAVE'::text, 'leave_full'::text, ta.status::text
    FROM public.therapist_attendance ta
   WHERE ta.therapist_id = p_therapist_id AND ta.date = p_date
     AND ta.status::text IN ('Absent', 'Leave', 'Annual Leave', 'Sick Leave', 'Day Off');
  -- half-day leave
  RETURN QUERY SELECT (x->>'start_min')::int, (x->>'end_min')::int, 'ON_LEAVE'::text, 'leave_half'::text, NULL::text
    FROM jsonb_array_elements(v_shift->'off') x;

  -- shift
  IF NOT (v_shift->>'works')::boolean THEN
    RETURN QUERY SELECT 0, 1440, 'OFF_SHIFT'::text, 'day_off'::text, NULL::text;
  ELSIF v_shift->>'start_min' IS NOT NULL THEN
    IF (v_shift->>'start_min')::int > 0 THEN
      RETURN QUERY SELECT 0, (v_shift->>'start_min')::int, 'OFF_SHIFT'::text, 'before_shift'::text, NULL::text;
    END IF;
    IF (v_shift->>'end_min')::int < 1440 THEN
      RETURN QUERY SELECT (v_shift->>'end_min')::int, 1440, 'OFF_SHIFT'::text, 'after_shift'::text, NULL::text;
    END IF;
  END IF;

  -- breaks
  RETURN QUERY SELECT (x->>'start_min')::int, (x->>'end_min')::int, 'ON_BREAK'::text, 'break'::text, x->>'name'
    FROM jsonb_array_elements(v_shift->'breaks') x
   WHERE (v_shift->>'works')::boolean;

  -- manual blocks: this therapist's, and whole-location ones (no room, no therapist) at the booking branch
  RETURN QUERY
  SELECT (EXTRACT(EPOCH FROM mb.start_time) / 60)::int,
         LEAST(1440, (EXTRACT(EPOCH FROM mb.start_time) / 60)::int + mb.duration_minutes),
         'BLOCKED'::text, 'block'::text, mb.description
    FROM public.manual_blocks mb
   CROSS JOIN LATERAL (
     SELECT public.manual_block_occurrence_date(mb.block_date, mb.recurrence_freq, mb.recurrence_interval, n) AS occ_date
       FROM generate_series(0, CASE WHEN mb.recurrence_freq IS NULL THEN 0 ELSE LEAST(COALESCE(mb.recurrence_count, 500) - 1, 500) END) AS n
   ) occ
   WHERE (mb.therapist_id = p_therapist_id OR (mb.therapist_id IS NULL AND mb.room_id IS NULL AND mb.branch_id = v_branch))
     AND mb.is_cancelled = false
     AND mb.block_date <= p_date
     AND occ.occ_date = p_date
     AND (mb.recurrence_end_date IS NULL OR occ.occ_date <= mb.recurrence_end_date)
     AND NOT EXISTS (SELECT 1 FROM public.manual_block_exceptions mbe
                      WHERE mbe.series_id = mb.series_id AND mbe.exception_date = occ.occ_date);

  -- transfer windows: while a window is open the therapist is bookable only at its destination.
  -- A window ends at revert_at / reverted_at, or when the next transfer of the same therapist starts.
  RETURN QUERY
  WITH w AS (
    SELECT st.to_branch_id, st.revert_at, st.reverted, st.reverted_at,
           ((st.effective_date + COALESCE(st.start_time, '00:00'::time)) AT TIME ZONE 'Asia/Kathmandu') AS ws
      FROM public.staff_transfers st WHERE st.therapist_id = p_therapist_id
  ), w2 AS (
    SELECT w.*, LEAST(COALESCE(w.revert_at, 'infinity'::timestamptz),
                      CASE WHEN w.reverted THEN COALESCE(w.reverted_at, w.ws) ELSE 'infinity'::timestamptz END,
                      COALESCE(lead(w.ws) OVER (ORDER BY w.ws), 'infinity'::timestamptz)) AS we
      FROM w
  )
  SELECT GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (w2.ws - v_day0)) / 60)::int),
         LEAST(1440, CASE WHEN w2.we = 'infinity' THEN 1440 ELSE CEIL(EXTRACT(EPOCH FROM (w2.we - v_day0)) / 60)::int END),
         'OTHER_BRANCH'::text, 'other_branch'::text, (SELECT name FROM public.branches WHERE id = w2.to_branch_id)
    FROM w2
   WHERE w2.to_branch_id <> v_branch AND w2.ws < v_day1 AND w2.we > v_day0;

  -- ZNLY-113: away from home, they are bookable here only inside a window into this branch. Mark every other minute.
  IF v_branch IS DISTINCT FROM (SELECT t.branch_id FROM public.therapists t WHERE t.id = p_therapist_id) THEN
    RETURN QUERY
    -- Every minute of the day OUTSIDE the union of this branch's windows (two visits in one day leave the gap between them marked too).
    WITH wins AS (
      SELECT GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (w.ws - v_day0)) / 60)::int) AS s,
             CASE WHEN w.we = 'infinity' THEN 1440 ELSE LEAST(1440, CEIL(EXTRACT(EPOCH FROM (w.we - v_day0)) / 60)::int) END AS e
        FROM public._staff_transfer_windows(ARRAY[p_therapist_id]) w
       WHERE w.to_branch_id = v_branch AND NOT w.is_return_leg AND NOT w.is_permanent
         AND w.ws < v_day1 AND w.we > v_day0
    ), ordered AS (
      SELECT o.s, COALESCE(max(o.e) OVER (ORDER BY o.s, o.e ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prev_e FROM wins o
    ), gaps AS (
      SELECT ordered.prev_e AS s, ordered.s AS e FROM ordered WHERE ordered.s > ordered.prev_e
      UNION ALL
      SELECT COALESCE((SELECT max(wins.e) FROM wins), 0), 1440
    ), home AS (SELECT (SELECT name FROM public.branches WHERE id = t.branch_id) AS n FROM public.therapists t WHERE t.id = p_therapist_id)
    SELECT g.s, g.e, 'OTHER_BRANCH'::text, 'other_branch'::text, (SELECT n FROM home)
      FROM gaps g
     WHERE g.e > g.s;
  END IF;

  -- overlapping bookings: own, companion (junction) and combo items
  RETURN QUERY
  SELECT GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (b.start_datetime - v_day0)) / 60)::int),
         LEAST(1440, CEIL(EXTRACT(EPOCH FROM (b.end_datetime - v_day0)) / 60)::int),
         'OVERLAP'::text, 'booking'::text, b.booking_number
    FROM public.bookings b
   WHERE b.therapist_id = p_therapist_id AND b.status NOT IN ('Cancelled', 'No Show')
     AND (p_exclude_booking_id IS NULL OR b.id <> p_exclude_booking_id)
     AND b.start_datetime < v_day1 AND b.end_datetime > v_day0;
  RETURN QUERY
  SELECT GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (x.s - v_day0)) / 60)::int),
         LEAST(1440, CEIL(EXTRACT(EPOCH FROM (x.e - v_day0)) / 60)::int),
         'OVERLAP'::text, 'booking'::text, x.num
    FROM (
      SELECT (b2.date + COALESCE(bt.start_time, b2.start_time)) AT TIME ZONE 'Asia/Kathmandu' AS s,
             (b2.date + COALESCE(bt.end_time, b2.end_time)) AT TIME ZONE 'Asia/Kathmandu' AS e,
             b2.booking_number AS num
        FROM public.booking_therapists bt JOIN public.bookings b2 ON b2.id = bt.booking_id
       WHERE bt.therapist_id = p_therapist_id AND b2.status NOT IN ('Cancelled', 'No Show')
         AND (p_exclude_booking_id IS NULL OR bt.booking_id <> p_exclude_booking_id)
         AND b2.date BETWEEN p_date - 1 AND p_date + 1
      UNION ALL
      SELECT bci.start_datetime, bci.end_datetime, b3.booking_number
        FROM public.booking_combo_items bci JOIN public.bookings b3 ON b3.id = bci.booking_id
       WHERE bci.therapist_id = p_therapist_id AND b3.status NOT IN ('Cancelled', 'No Show')
         AND bci.start_datetime IS NOT NULL
         AND (p_exclude_booking_id IS NULL OR bci.booking_id <> p_exclude_booking_id)
    ) x
   WHERE x.s < v_day1 AND x.e > v_day0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.therapist_shifts_for_range(p_branch_id uuid, p_from_date date, p_to_date date)
 RETURNS TABLE(therapist_id uuid, shift_date date, works boolean, start_time time without time zone, end_time time without time zone, source text, breaks jsonb, off jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  WHERE t.is_active = true
    AND (t.branch_id = p_branch_id OR public._therapist_visits_branch_on(t.id, p_branch_id, d.d::date))  -- ZNLY-113: visitors only on window days
  ORDER BY t.id, d.d;
END;
$function$;

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
  JOIN public.branches br ON br.id = p_branch_id
  JOIN public.organizations org ON org.id = br.org_id AND org.slug = p_org_slug
  JOIN public.therapists t
    ON t.org_id = br.org_id AND t.is_active = true AND t.is_service_staff = true
  CROSS JOIN LATERAL (
    SELECT public.manual_block_occurrence_date(mb.block_date, mb.recurrence_freq, mb.recurrence_interval, n) AS occ_date
    FROM generate_series(0, CASE WHEN mb.recurrence_freq IS NULL THEN 0 ELSE LEAST(COALESCE(mb.recurrence_count, 500) - 1, 500) END) AS n
  ) occ
  WHERE mb.branch_id = p_branch_id
    AND (t.branch_id = mb.branch_id OR public._therapist_visits_branch_on(t.id, mb.branch_id, occ.occ_date))  -- ZNLY-113
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

  -- g) Staff availability (migration 353's rule), only for tenants with enforce_staff_availability on:
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
  JOIN public.therapists t ON t.org_id = br.org_id AND t.is_active = true AND t.is_service_staff = true
  CROSS JOIN generate_series(p_start_date::timestamp, p_end_date::timestamp, interval '1 day') AS d(d)
  CROSS JOIN LATERAL public.therapist_unavailable_ranges(t.id, d.d::date, br.id) u
  WHERE br.id = p_branch_id
    AND (t.branch_id = br.id OR public._therapist_visits_branch_on(t.id, br.id, d.d::date))  -- ZNLY-113
    AND (p_end_date - p_start_date) <= 90
    AND u.code <> 'OVERLAP'
    AND u.reason <> 'leave_full'
    AND u.start_min < 1440;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_therapist_booking_guards(p_therapist_id uuid, p_service_id uuid, p_date date, p_start_datetime timestamp with time zone, p_branch_id uuid, p_end_datetime timestamp with time zone DEFAULT NULL::timestamp with time zone, p_booking_id uuid DEFAULT NULL::uuid, p_override_reason text DEFAULT NULL::text, p_skip_availability boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_therapist_name text;
  v_service_name   text;
  v_has_allowlist  boolean;
  v_visitor        boolean;
  v_on_allowlist   boolean;
  v_attendance     record;
  v_enforce        boolean := false;
  v_day0           timestamptz := (p_date::timestamp AT TIME ZONE 'Asia/Kathmandu');
  v_s              int;
  v_e              int;
  v_reason         text := btrim(COALESCE(p_override_reason, ''));
  v_role           user_role;
  r                record;
  v_msg            text;
  v_detail         jsonb;
BEGIN
  SELECT name INTO v_therapist_name FROM public.therapists WHERE id = p_therapist_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'THERAPIST_NOT_FOUND: therapist % does not exist.', p_therapist_id
      USING ERRCODE = 'P0006';
  END IF;

  SELECT name INTO v_service_name FROM public.services WHERE id = p_service_id;

  -- Branch-scoped by the booking's own branch (p_branch_id), matching
  -- public_get_bookable_therapists -- not the therapist's live branch, which can
  -- legitimately differ from the booking's branch during a staff_transfers window.
  -- ZNLY-113: a lent therapist at the receiving branch (open window at the booking start) is judged on their HOME
  -- allow-list, matched by service name. Everyone else: the booking branch's allow-list, as before.
  v_visitor := p_branch_id IS DISTINCT FROM (SELECT t.branch_id FROM public.therapists t WHERE t.id = p_therapist_id)
               AND public._therapist_open_window_branch(p_therapist_id, p_start_datetime) = p_branch_id;
  IF v_visitor THEN
    IF p_service_id IS NOT NULL AND NOT public._visitor_service_ok(p_therapist_id, p_service_id) THEN
      RAISE EXCEPTION 'THERAPIST_NOT_ELIGIBLE: % does not do % at their home branch, so cannot cover it here.',
        COALESCE(v_therapist_name, 'This therapist'), COALESCE(v_service_name, 'this service')
        USING ERRCODE = 'P0006';
    END IF;
  ELSE
    SELECT EXISTS(
      SELECT 1
      FROM public.service_therapists st
      JOIN public.therapists st_t ON st_t.id = st.therapist_id
      WHERE st.service_id = p_service_id AND st_t.branch_id = p_branch_id
    ) INTO v_has_allowlist;
    IF v_has_allowlist THEN
      SELECT EXISTS(
        SELECT 1 FROM public.service_therapists
        WHERE service_id = p_service_id AND therapist_id = p_therapist_id
      ) INTO v_on_allowlist;

      IF NOT v_on_allowlist THEN
        RAISE EXCEPTION 'THERAPIST_NOT_ELIGIBLE: % is not on the eligible staff list for %. Update the service''s eligible staff in Service Management to allow this.',
          COALESCE(v_therapist_name, 'This therapist'), COALESCE(v_service_name, 'this service')
          USING ERRCODE = 'P0006';
      END IF;
    END IF;
  END IF;

  -- ---- availability rule (per-tenant switch)
  IF NOT p_skip_availability THEN
    SELECT o.enforce_staff_availability INTO v_enforce
      FROM public.branches br JOIN public.organizations o ON o.id = br.org_id WHERE br.id = p_branch_id;
  END IF;

  IF COALESCE(v_enforce, false) THEN
    v_s := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (p_start_datetime - v_day0)) / 60)::int);
    v_e := LEAST(1440, CEIL(EXTRACT(EPOCH FROM (COALESCE(p_end_datetime, p_start_datetime + interval '1 minute') - v_day0)) / 60)::int);
    IF v_e <= v_s THEN v_e := v_s + 1; END IF;

    FOR r IN
      SELECT x.* FROM (
        SELECT DISTINCT ON (u.code) u.*,
               CASE u.code WHEN 'ON_LEAVE' THEN 1 WHEN 'OVERLAP' THEN 2 WHEN 'OTHER_BRANCH' THEN 3
                           WHEN 'BLOCKED' THEN 4 WHEN 'ON_BREAK' THEN 5 ELSE 6 END AS prio
          FROM public.therapist_unavailable_ranges(p_therapist_id, p_date, p_branch_id, p_booking_id) u
         WHERE u.start_min < v_e AND u.end_min > v_s
         ORDER BY u.code, u.start_min
      ) x ORDER BY x.prio
    LOOP
      v_msg := CASE r.code
        WHEN 'ON_LEAVE' THEN COALESCE(v_therapist_name, 'This staff member') ||
             CASE r.reason WHEN 'leave_half' THEN ' is off ' || public.minutes_to_hhmm(r.start_min) || '–' || public.minutes_to_hhmm(r.end_min)
                           ELSE ' is on leave on this date' END
        WHEN 'OVERLAP' THEN COALESCE(v_therapist_name, 'This staff member') || ' already has a booking ' ||
             public.minutes_to_hhmm(r.start_min) || '–' || public.minutes_to_hhmm(r.end_min)
        WHEN 'OTHER_BRANCH' THEN COALESCE(v_therapist_name, 'This staff member') || ' is at ' || COALESCE(r.label, 'another branch') || ' at this time'
        WHEN 'BLOCKED' THEN COALESCE(v_therapist_name, 'This staff member') || ' is blocked ' ||
             public.minutes_to_hhmm(r.start_min) || '–' || public.minutes_to_hhmm(r.end_min) ||
             CASE WHEN r.label IS NULL OR r.label = '' THEN '' ELSE ' (' || r.label || ')' END
        WHEN 'ON_BREAK' THEN COALESCE(v_therapist_name, 'This staff member') || ' is on a break ' ||
             public.minutes_to_hhmm(r.start_min) || '–' || public.minutes_to_hhmm(r.end_min)
        ELSE COALESCE(v_therapist_name, 'This staff member') ||
             CASE r.reason WHEN 'before_shift' THEN ' is off until ' || public.minutes_to_hhmm(r.end_min)
                           WHEN 'after_shift' THEN '''s shift ends at ' || public.minutes_to_hhmm(r.start_min)
                           ELSE ' is not working on this date' END
      END;
      v_detail := jsonb_build_object('code', r.code, 'reason', r.reason, 'therapist_id', p_therapist_id,
        'therapist_name', v_therapist_name, 'date', p_date,
        'start', public.minutes_to_hhmm(v_s), 'end', public.minutes_to_hhmm(v_e),
        'range_start', public.minutes_to_hhmm(r.start_min), 'range_end', public.minutes_to_hhmm(r.end_min), 'label', r.label);

      IF r.code IN ('ON_LEAVE', 'OVERLAP') OR v_reason = '' THEN
        RAISE EXCEPTION '%: %', r.code, v_msg USING ERRCODE = 'PT409', DETAIL = v_detail::text;
      END IF;

      -- overridable code with a reason supplied: managers/admins only
      v_role := public.get_user_role();
      IF v_role IS DISTINCT FROM 'manager'::user_role AND v_role IS DISTINCT FROM 'admin'::user_role THEN
        RAISE EXCEPTION 'OVERRIDE_NOT_ALLOWED: Only a manager or admin can book outside a staff member''s availability.'
          USING ERRCODE = 'PT403', DETAIL = v_detail::text;
      END IF;
      INSERT INTO public.audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by, reason)
      SELECT p_branch_id, 'bookings', p_booking_id, 'AVAILABILITY_OVERRIDE', NULL,
             v_detail || jsonb_build_object('message', v_msg, 'override_reason', v_reason), auth.uid(), v_reason
       WHERE p_booking_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.audit_logs a
                          WHERE a.record_id = p_booking_id AND a.action_type = 'AVAILABILITY_OVERRIDE'
                            AND a.new_data->>'code' = r.code AND a.new_data->>'therapist_id' = p_therapist_id::text
                            AND a.new_data->>'start' = v_detail->>'start' AND a.changed_at = now());
    END LOOP;
  END IF;

  SELECT status, check_out_time INTO v_attendance
  FROM public.therapist_attendance
  WHERE therapist_id = p_therapist_id AND date = p_date;

  IF v_attendance.status IS NOT NULL AND v_attendance.status::text IN ('Absent', 'Leave', 'Annual Leave', 'Sick Leave', 'Day Off') THEN
    RAISE EXCEPTION 'THERAPIST_ABSENT: % is marked as % on this date.',
      COALESCE(v_therapist_name, 'This therapist'), v_attendance.status
      USING ERRCODE = 'P0006';
  END IF;

  IF v_attendance.check_out_time IS NOT NULL AND p_start_datetime >= v_attendance.check_out_time THEN
    RAISE EXCEPTION 'THERAPIST_CHECKED_OUT: % already checked out for this date.',
      COALESCE(v_therapist_name, 'This therapist')
      USING ERRCODE = 'P0006';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_discount_approvers()
 RETURNS TABLE(id uuid, full_name text, role user_role, branch_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT u.id, u.full_name, u.role, u.branch_id
  FROM public.users u
  WHERE u.is_active = true
    AND u.pin IS NOT NULL AND u.pin <> ''
    AND u.id <> auth.uid()
    AND u.org_id = (SELECT org_id FROM public.users WHERE id = auth.uid())
    AND (
      u.role = 'admin'
      OR (u.role = 'manager'
          AND u.branch_id = (SELECT public.get_user_branch_id()))  -- ZNLY-113: a lent staff login asks the receiving branch's managers
    )
  ORDER BY u.role DESC, u.full_name;
$function$;

CREATE OR REPLACE FUNCTION public.notify_left_behind_bookings()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target_date date := ((now() AT TIME ZONE 'Asia/Kathmandu')::date + 1);
  v_count int := 0;
BEGIN
  WITH left_behind AS (
    SELECT DISTINCT
      b.id            AS booking_id,
      b.branch_id     AS branch_id,
      b.booking_number,
      t.name          AS staff_name
    FROM public.bookings b
    JOIN LATERAL (
      SELECT b.therapist_id AS therapist_id WHERE b.therapist_id IS NOT NULL
      UNION
      SELECT bt.therapist_id FROM public.booking_therapists bt WHERE bt.booking_id = b.id
    ) a ON true
    JOIN public.therapists t ON t.id = a.therapist_id
    WHERE b.date = v_target_date
      AND b.status NOT IN ('Cancelled', 'Completed', 'No Show')
      AND public._therapist_now_at(t.id, b.start_datetime) <> b.branch_id  -- ZNLY-113: branch_id no longer flips, so ask the window
      AND EXISTS (
        SELECT 1 FROM public.staff_transfers st
        WHERE st.therapist_id = t.id
          AND st.from_branch_id = b.branch_id
      )
  ),
  recipients AS (
    SELECT lb.booking_id, lb.branch_id, lb.booking_number, lb.staff_name, u.id AS user_id
    FROM left_behind lb
    JOIN public.users u ON u.branch_id = lb.branch_id
  )
  INSERT INTO public.notifications (user_id, type, title, body, booking_id)
  SELECT
    r.user_id,
    'transferred_staff_reminder',
    'Transferred staff booking tomorrow',
    r.staff_name || ' has transferred to another branch but is still assigned to booking '
      || r.booking_number || ' here tomorrow. Please reassign or follow up.',
    r.booking_id
  FROM recipients r
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = r.user_id
      AND n.booking_id = r.booking_id
      AND n.type = 'transferred_staff_reminder'
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_new_online_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org   uuid;
  v_body  text;
BEGIN
  -- A multi-service visit is one row per service sharing a booking_group_id: notify once, on the first row.
  IF NEW.booking_group_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.notifications n
      JOIN public.bookings b2 ON b2.id = n.booking_id
     WHERE n.type = 'new_online_booking'
       AND b2.booking_group_id = NEW.booking_group_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT br.org_id INTO v_org FROM public.branches br WHERE br.id = NEW.branch_id;
  IF v_org IS NULL THEN
    RETURN NEW;
  END IF;

  v_body := concat_ws(' · ',
    NULLIF(NEW.customer_name, ''),
    NULLIF(NEW.service_name_snapshot, ''),
    to_char(NEW.date, 'Dy FMDD Mon') || ', ' || lower(to_char(NEW.start_time, 'FMHH12:MIAM'))
  );

  INSERT INTO public.notifications (user_id, type, title, body, booking_id)
  SELECT u.id, 'new_online_booking', 'New online booking', v_body, NEW.id
    FROM public.users u
   WHERE u.org_id = v_org
     AND u.is_active
     AND (
       u.role = 'admin'
       OR (
         u.role IN ('manager', 'staff')
         AND (
           (u.role = 'manager' AND u.branch_id = NEW.branch_id)
           OR (u.role = 'staff' AND public._user_effective_branch(u.id) = NEW.branch_id)  -- ZNLY-113: lent staff follow the window
           OR EXISTS (SELECT 1 FROM public.user_branches ub WHERE ub.user_id = u.id AND ub.branch_id = NEW.branch_id)
         )
       )
     );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification problem fail a customer's booking.
  RAISE WARNING 'notify_new_online_booking failed for booking %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

-- Customer booking flow (V33a-fix): lent staff are choosable / counted only inside the window and for home services.

-- Customer flow: does this therapist have a temporary window into the branch that has not ended yet?
CREATE OR REPLACE FUNCTION public._therapist_has_window_into(p_therapist_id uuid, p_branch_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public._staff_transfer_windows(ARRAY[p_therapist_id]) w
     WHERE w.to_branch_id = p_branch_id AND NOT w.is_return_leg AND NOT w.is_permanent AND w.we > now());
$$;
REVOKE ALL ON FUNCTION public._therapist_has_window_into(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_get_bookable_therapists(p_org_slug text, p_branch_id uuid, p_service_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(id uuid, name text, "position" text, photo_url text, rating numeric, experience_years integer, bio text, display_order integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    t.id,
    t.name,
    t.position,
    t.photo_url,
    t.rating,
    t.experience_years,
    t.bio,
    t.display_order
  FROM public.therapists t
  JOIN public.branches b ON b.id = t.branch_id
  JOIN public.organizations o ON o.id = b.org_id
  WHERE o.slug = p_org_slug
    AND o.is_active = true
    AND COALESCE((o.settings->>'show_staff_selection')::boolean, false) = true
    AND (t.branch_id = p_branch_id OR public._therapist_has_window_into(t.id, p_branch_id))  -- ZNLY-113: lent staff, per-slot rules in public_check_therapist_bookings_range
    AND t.is_active = true
    AND t.is_service_staff = true
    -- Eligible for every selected service: there must be no selected service that has
    -- a branch-scoped allow-list which this therapist is missing from. A service with
    -- no allow-list rows AT THIS BRANCH stays unrestricted at this branch, even if it
    -- has allow-list rows for a different branch's therapists.
    AND (
      p_service_ids IS NULL
      OR cardinality(p_service_ids) = 0
      OR (t.branch_id = p_branch_id AND (
      NOT EXISTS (
          SELECT 1
          FROM unnest(p_service_ids) AS sid
          WHERE EXISTS (
            SELECT 1
            FROM public.service_therapists st
            JOIN public.therapists st_t ON st_t.id = st.therapist_id
            WHERE st.service_id = sid AND st_t.branch_id = p_branch_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.service_therapists st
            WHERE st.service_id = sid AND st.therapist_id = t.id
          )
        )
      ))
      OR (t.branch_id <> p_branch_id AND NOT EXISTS (   -- visitor: judged on the HOME allow-list, by service name
        SELECT 1 FROM unnest(p_service_ids) AS sid WHERE NOT public._visitor_service_ok(t.id, sid)
      ))
    )
  ORDER BY COALESCE(t.display_order, 2147483647), t.name;
$function$;

CREATE OR REPLACE FUNCTION public.public_check_branch_bookings_range(p_branch_id uuid, p_start_date date, p_end_date date, p_service_id uuid DEFAULT NULL::uuid, p_duration_minutes integer DEFAULT NULL::integer)
 RETURNS TABLE(booking_date date, start_time time without time zone, duration_minutes integer, room_id uuid, therapist_gender text, source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      WHERE t.org_id = br.org_id AND t.is_active = true AND t.is_service_staff = true
        AND (
          (t.branch_id = br.id
           AND (NOT EXISTS (SELECT 1 FROM public.service_therapists st JOIN public.therapists tt ON tt.id = st.therapist_id
                             WHERE st.service_id = p_service_id AND tt.branch_id = br.id)
                OR EXISTS (SELECT 1 FROM public.service_therapists st WHERE st.service_id = p_service_id AND st.therapist_id = t.id)))
          -- ZNLY-113: a lent therapist counts only on window days and only for services they do at home
          OR (t.branch_id <> br.id AND public._therapist_visits_branch_on(t.id, br.id, d.d::date)
              AND public._visitor_service_ok(t.id, p_service_id))
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.therapist_unavailable_ranges(t.id, d.d::date, br.id) u
          WHERE u.start_min < s.s + p_duration_minutes AND u.end_min > s.s)
    );
$function$;

-- Superseded by the therapist-filtered form (mig 360, V33a-fix); only exists on DBs that applied the first draft.
DROP FUNCTION IF EXISTS public._staff_transfer_windows();

INSERT INTO public.schema_migrations (version, name)
VALUES ('361', 'availability-readers-now-at')
ON CONFLICT (version) DO NOTHING;

COMMIT;
