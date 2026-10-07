-- Migration 253: close three gaps found reviewing migration-252's anon RPCs
-- (additive/replace, REVERSIBLE)
--
-- 1. public_check_therapist_bookings_range had no tenant predicate — its only
-- scoping argument was p_branch_id, a bare UUID. Its sibling
-- public_get_bookable_therapists joins through organizations and takes
-- p_org_slug; this one didn't, so anyone holding (or guessing/enumerating) any
-- branch UUID could pull that branch's per-therapist occupancy over anon,
-- including a `source` column that discloses 'absence' (on leave) and
-- 'checkout' (went home) — not booking data, HR data. New first parameter
-- p_org_slug, joined through branches -> organizations in every one of the
-- function's seven UNION ALL sections (the function has no single shared FROM
-- to hang one join off of). Signature change means DROP + CREATE, not
-- CREATE OR REPLACE (Postgres can't change a function's parameter list that
-- way).
--
-- Same migration also clamps the range: the function is anon-callable and its
-- section (e) is manual_blocks x therapists x generate_series(0..500) — with no
-- upper bound on the caller-supplied date range that's a free-standing cost
-- amplifier. Added as a WHERE predicate (not a RAISE EXCEPTION) so the function
-- can stay LANGUAGE sql rather than switching to plpgsql for one guard.
--
-- 2. public_get_bookable_therapists never checked settings.show_staff_selection,
-- so an org that explicitly turned staff selection OFF still served its full
-- therapist roster (name, photo, bio, rating) to anon. Same signature, so this
-- is a plain CREATE OR REPLACE.
--
-- 3. The Eligible Staff allow-list save (ServiceManagementPanel ->
-- setServiceTherapists) did an unguarded client-side delete-then-insert against
-- service_therapists with no transaction: if the insert failed after the
-- delete committed, the service silently flipped from restricted to
-- unrestricted, and the UI never inspected the result to notice. New
-- set_service_therapists(uuid, uuid[]) RPC does the delete+insert as one
-- statement pair inside a single function invocation — atomic by definition —
-- and verifies the service belongs to the caller's org first.
--
-- Reversible:
--   DROP FUNCTION IF EXISTS public.set_service_therapists(uuid, uuid[]);
--   DROP FUNCTION IF EXISTS public.public_check_therapist_bookings_range(text, uuid, date, date);
--   -- recreating the migration-252 signature requires re-running that
--   -- migration's CREATE FUNCTION public_check_therapist_bookings_range(uuid, date, date) body.
--   -- public_get_bookable_therapists: CREATE OR REPLACE back to migration-252's body to drop
--   -- the show_staff_selection predicate (signature unchanged, so no DROP needed).

BEGIN;

-- 1. Re-scope + re-clamp public_check_therapist_bookings_range.
DROP FUNCTION IF EXISTS public.public_check_therapist_bookings_range(uuid, date, date);

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
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.public_check_therapist_bookings_range(text, uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_check_therapist_bookings_range(text, uuid, date, date) TO anon, authenticated;

-- 2. public_get_bookable_therapists — honor settings.show_staff_selection. Same
-- signature as migration-252, so CREATE OR REPLACE is sufficient.
CREATE OR REPLACE FUNCTION public.public_get_bookable_therapists(
  p_org_slug text,
  p_branch_id uuid,
  p_service_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  id                uuid,
  name              text,
  "position"        text,
  photo_url         text,
  rating            numeric,
  experience_years  integer,
  bio               text,
  display_order     integer
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
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
    AND t.branch_id = p_branch_id
    AND t.is_active = true
    AND t.is_service_staff = true
    -- Eligible for every selected service: there must be no selected service that has
    -- an allow-list which this therapist is missing from. Services with no allow-list
    -- rows stay unrestricted, same "empty = unrestricted" convention as before.
    AND (
      p_service_ids IS NULL
      OR cardinality(p_service_ids) = 0
      OR NOT EXISTS (
        SELECT 1
        FROM unnest(p_service_ids) AS sid
        WHERE EXISTS (SELECT 1 FROM public.service_therapists st WHERE st.service_id = sid)
          AND NOT EXISTS (
            SELECT 1 FROM public.service_therapists st
            WHERE st.service_id = sid AND st.therapist_id = t.id
          )
      )
    )
  ORDER BY COALESCE(t.display_order, 2147483647), t.name;
$$;

REVOKE ALL ON FUNCTION public.public_get_bookable_therapists(text, uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_get_bookable_therapists(text, uuid, uuid[]) TO anon, authenticated;

-- 3. set_service_therapists — atomic replace of a service's eligible-staff
-- allow-list. Role check mirrors update_org_booking_settings (migration-248)/
-- update_org_profile_settings (migration-251): manager or admin, and the
-- service must belong to the caller's own org (service_therapists carries no
-- org_id of its own — mirrors migration-249's RLS, which checks the same way
-- through services.org_id).
CREATE OR REPLACE FUNCTION public.set_service_therapists(
  p_service_id uuid,
  p_therapist_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid := get_user_org_id();
  v_role   text := get_user_role();
  v_count  integer;
BEGIN
  IF v_role NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'set_service_therapists: manager or admin only';
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'set_service_therapists: no organization context';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.services s WHERE s.id = p_service_id AND s.org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'set_service_therapists: service % not found in your organization', p_service_id;
  END IF;

  -- Validate every id belongs to the caller's own org BEFORE writing anything —
  -- a therapist id from another org (bad client state, stale cache, or a
  -- deliberate probe) must abort the whole call rather than silently drop that
  -- one row. Raising here rolls back nothing yet, since the delete below
  -- hasn't run; raising after the delete would still roll back cleanly too,
  -- since both statements execute inside this single function invocation's
  -- transaction — that's what makes the replace atomic.
  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_therapist_ids, ARRAY[]::uuid[])) AS tid
    WHERE NOT EXISTS (
      SELECT 1 FROM public.therapists t
      JOIN public.branches br ON br.id = t.branch_id
      WHERE t.id = tid AND br.org_id = v_org_id
    )
  ) THEN
    RAISE EXCEPTION 'set_service_therapists: one or more therapist ids do not belong to your organization';
  END IF;

  DELETE FROM public.service_therapists WHERE service_id = p_service_id;

  INSERT INTO public.service_therapists (service_id, therapist_id)
  SELECT p_service_id, tid
  FROM unnest(COALESCE(p_therapist_ids, ARRAY[]::uuid[])) AS tid;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.set_service_therapists(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_service_therapists(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_service_therapists(uuid, uuid[]) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('253', 'scope-therapist-range-rpc')
ON CONFLICT (version) DO NOTHING;

COMMIT;
