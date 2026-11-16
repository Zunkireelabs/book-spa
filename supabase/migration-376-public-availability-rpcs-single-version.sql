-- Migration 376 (ZNLY-198 step 4a / ZNLY-204): one version of each public availability RPC.
--
-- Why: the stage line (migrations 299-307) and the Zennly line (354, 361) each rewrote
-- public_get_bookable_therapists and public_check_branch_bookings_range independently. Replayed
-- together they leave OVERLOADS side by side (3-arg and 4-arg bookable-therapists; and 361 re-created
-- the 3-arg one with none of stage's group-booking / PII rules), so which body a call hit depended on
-- the argument list. This migration drops every overload of both functions and creates each ONCE.
--
-- public_get_bookable_therapists(p_org_slug, p_branch_id, p_service_ids DEFAULT NULL, p_for_group_booking DEFAULT false)
--   stage 305/306 : the group-booking bypass of show_staff_selection, with the PII fix (name/photo/bio/... are
--                   NULL when show_staff_selection is off: ids only, enough for availability maths)
--   Zennly 361    : lent staff (staff on a transfer window into the branch) and the visitor service rule
--   stage 257/258 : branch-scoped service allow-list
--
-- public_check_branch_bookings_range(p_branch_id, p_start_date, p_end_date, p_service_id DEFAULT NULL, p_duration_minutes DEFAULT NULL)
--   stage 299     : a manual block fills the room's FULL capacity (one row per seat)
--   stage 301     : counts_as_online_capacity (unassigned + not created by staff)
--   stage 307     : gender_preference, so an unassigned booking still reserves its gender slot
--   Zennly 354/361: source column ('booking' | 'block' | 'no_staff') and the "no eligible staff free" start times
--                   (enforce_staff_availability tenants), with the now_at / visitor rules
--   Return columns = stage's 7 + `source`.
--
-- 3-arg calls (stage's old shape) and 4-arg calls still resolve: the extra parameters all have defaults.
-- Grants are stage's: REVOKE ALL FROM PUBLIC, then EXECUTE to anon + authenticated.
--
-- Reversible (manual): re-apply 306 + 307 (stage) or 361 (Zennly) bodies; none of them can coexist.
--
-- Applied: local only.

BEGIN;

-- Drop EVERY overload of both functions, whatever their argument lists are.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('public_get_bookable_therapists', 'public_check_branch_bookings_range')
  LOOP
    EXECUTE 'DROP FUNCTION ' || f.sig;
  END LOOP;
END $$;

CREATE FUNCTION public.public_get_bookable_therapists(
  p_org_slug text,
  p_branch_id uuid,
  p_service_ids uuid[] DEFAULT NULL,
  p_for_group_booking boolean DEFAULT false
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
    CASE WHEN show_sel THEN t.name             ELSE NULL END AS name,
    CASE WHEN show_sel THEN t.position         ELSE NULL END AS "position",
    CASE WHEN show_sel THEN t.photo_url        ELSE NULL END AS photo_url,
    CASE WHEN show_sel THEN t.rating           ELSE NULL END AS rating,
    CASE WHEN show_sel THEN t.experience_years ELSE NULL END AS experience_years,
    CASE WHEN show_sel THEN t.bio              ELSE NULL END AS bio,
    CASE WHEN show_sel THEN t.display_order    ELSE NULL END AS display_order
  FROM public.therapists t
  JOIN public.branches b ON b.id = t.branch_id
  JOIN public.organizations o ON o.id = b.org_id
  CROSS JOIN LATERAL (
    SELECT COALESCE((o.settings->>'show_staff_selection')::boolean, false) AS show_sel
  ) flags
  WHERE o.slug = p_org_slug
    AND o.is_active = true
    AND (flags.show_sel = true OR p_for_group_booking = true)
    -- ZNLY-113: lent staff count too (per-slot rules live in public_check_therapist_bookings_range)
    AND (t.branch_id = p_branch_id OR public._therapist_has_window_into(t.id, p_branch_id))
    AND t.is_active = true
    AND t.is_service_staff = true
    -- Eligible for every selected service. A service with no allow-list rows AT THIS BRANCH stays unrestricted here.
    AND (
      p_service_ids IS NULL
      OR cardinality(p_service_ids) = 0
      OR (t.branch_id = p_branch_id AND NOT EXISTS (
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
      ))
      OR (t.branch_id <> p_branch_id AND NOT EXISTS (   -- visitor: judged on the HOME allow-list, by service name
        SELECT 1 FROM unnest(p_service_ids) AS sid WHERE NOT public._visitor_service_ok(t.id, sid)
      ))
    )
  ORDER BY COALESCE(t.display_order, 2147483647), t.name;
$$;

REVOKE ALL ON FUNCTION public.public_get_bookable_therapists(text, uuid, uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_get_bookable_therapists(text, uuid, uuid[], boolean) TO anon, authenticated;

CREATE FUNCTION public.public_check_branch_bookings_range(
  p_branch_id uuid,
  p_start_date date,
  p_end_date date,
  p_service_id uuid DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL
)
RETURNS TABLE (
  booking_date date,
  start_time time,
  duration_minutes int,
  room_id uuid,
  therapist_gender text,
  gender_preference text,
  counts_as_online_capacity boolean,
  source text
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
    t.gender AS therapist_gender,
    b.gender_preference,
    -- Same predicate as check_branch_online_capacity()'s occupied-count query.
    (b.therapist_id IS NULL AND b.created_by IS NULL) AS counts_as_online_capacity,
    'booking'::text AS source
  FROM public.bookings b
  LEFT JOIN public.therapists t ON t.id = b.therapist_id
  WHERE b.branch_id = p_branch_id
    AND b.date BETWEEN p_start_date AND p_end_date
    AND b.status NOT IN ('Cancelled', 'No Show')

  UNION ALL

  -- Room-scoped blocks: one row per capacity unit, so the room reads as fully occupied for the block's whole span.
  SELECT
    occ.occ_date AS booking_date,
    mb.start_time,
    mb.duration_minutes,
    mb.room_id,
    NULL::text AS therapist_gender,
    NULL::text AS gender_preference,
    false AS counts_as_online_capacity,
    'block'::text AS source
  FROM public.manual_blocks mb
  JOIN public.rooms r ON r.id = mb.room_id
  CROSS JOIN LATERAL (
    SELECT public.manual_block_occurrence_date(mb.block_date, mb.recurrence_freq, mb.recurrence_interval, n) AS occ_date
    FROM generate_series(0, CASE WHEN mb.recurrence_freq IS NULL THEN 0 ELSE LEAST(COALESCE(mb.recurrence_count, 500) - 1, 500) END) AS n
  ) occ
  CROSS JOIN LATERAL generate_series(1, GREATEST(1, r.capacity)) AS unit
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

  -- Whole-location blocks (no room, no therapist): same full-capacity treatment, for every active room in the branch.
  SELECT
    occ.occ_date AS booking_date,
    mb.start_time,
    mb.duration_minutes,
    r.id AS room_id,
    NULL::text AS therapist_gender,
    NULL::text AS gender_preference,
    false AS counts_as_online_capacity,
    'block'::text AS source
  FROM public.manual_blocks mb
  JOIN public.rooms r ON r.branch_id = mb.branch_id AND r.is_active = true
  CROSS JOIN LATERAL (
    SELECT public.manual_block_occurrence_date(mb.block_date, mb.recurrence_freq, mb.recurrence_interval, n) AS occ_date
    FROM generate_series(0, CASE WHEN mb.recurrence_freq IS NULL THEN 0 ELSE LEAST(COALESCE(mb.recurrence_count, 500) - 1, 500) END) AS n
  ) occ
  CROSS JOIN LATERAL generate_series(1, GREATEST(1, r.capacity)) AS unit
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

  -- "Any professional": a start is offered only if at least one eligible therapist is on shift and free for the whole
  -- duration (shift, breaks, leave, blocks, transfers and other bookings all count). One row per start time that must NOT be
  -- offered; match on equality, never overlap.
  SELECT
    d.d::date AS booking_date,
    make_time(s.s / 60, s.s % 60, 0) AS start_time,
    15 AS duration_minutes,
    NULL::uuid AS room_id,
    NULL::text AS therapist_gender,
    NULL::text AS gender_preference,
    false AS counts_as_online_capacity,
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
$$;

REVOKE ALL ON FUNCTION public.public_check_branch_bookings_range(uuid, date, date, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_check_branch_bookings_range(uuid, date, date, uuid, integer) TO anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('376', 'public-availability-rpcs-single-version')
ON CONFLICT (version) DO NOTHING;

COMMIT;
