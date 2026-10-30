-- Migration 307 (ZNLY-168): fix gender-preference availability for the
-- public booking flow's staff-selection-OFF tenants
--
-- Incident: a customer placed an online booking with gender preference
-- "female"; by the time staff tried to assign a therapist, every actually-
-- qualified female therapist was already committed elsewhere. Two
-- independent gaps, both fixed here:
--
-- 1. public_check_branch_bookings_range() only ever returned
--    `therapist_gender`, sourced from a LEFT JOIN on the booking's
--    *assigned* therapist. A booking placed through the public flow
--    normally has therapist_id = NULL at insert time (assignment happens
--    later, manually by staff) — so a pending online booking contributed
--    nothing to the frontend's byGender headcount
--    (src/pages/customer-booking-flow/utils/availability.js buildOccupancy()),
--    even though it had already stated a gender preference. Two unassigned
--    preference bookings in the same slot were invisible to each other, and
--    staff assigning away the rest of the gender roster had nothing
--    flagging the conflict. Fixed by surfacing the booking's own
--    gender_preference column (migration-304) as a new output column, so
--    the frontend can fall back to it when therapist_gender is null.
--    Changing the RETURNS TABLE shape needs DROP + CREATE (CREATE OR
--    REPLACE cannot change a function's return type) — body below is
--    migration-301's verbatim, plus the one new column.
--
-- 2. The gender headcount itself wasn't scoped to the service at all — the
--    frontend counted every is_active therapist at the branch (hairdresser,
--    masseuse, anyone), ignoring service_therapists eligibility
--    (migration-249) entirely. "3 female staff, 2 booked -> 1 free" could be
--    true headcount-wise while 0 of the 3 actually do the requested
--    service. The existing eligibility RPC, public_get_bookable_therapists
--    (migration-257), can't be reused here: it requires
--    show_staff_selection = true, and this bug is specific to tenants where
--    that's OFF (the gender-headcount path only runs then). So this adds a
--    new, minimal anon-callable RPC,
--    public_get_service_eligible_gender_headcount, that returns ONLY
--    male/female counts (no names/photos/PII — this org had a PII-leak
--    incident on a similar RPC before, migration-305/306) using the same
--    branch-scoped allow-list predicate as public_get_bookable_therapists,
--    minus the show_staff_selection gate.
--
-- The `ALTER TABLE ... ADD COLUMN IF NOT EXISTS gender_preference` below
-- duplicates migration-304 (currently only on the unmerged
-- fix/admin-viewer-membership-voucher-package-access branch, PR #413) so this
-- migration is self-sufficient regardless of merge order — both use
-- IF NOT EXISTS, so applying either first and then the other is a no-op the
-- second time, not a conflict.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.public_check_branch_bookings_range(uuid, date, date);
--   -- then re-apply migration-301's CREATE to restore the 6-column version.
--   -- (gender_preference column intentionally left in place — migration-304 owns it.)
--   DROP FUNCTION IF EXISTS public.public_get_service_eligible_gender_headcount(text, uuid, uuid);
--
-- Applied: stage PENDING / prod HELD.

BEGIN;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS gender_preference text
  CHECK (gender_preference IN ('male', 'female', 'no-preference'));

DROP FUNCTION IF EXISTS public.public_check_branch_bookings_range(uuid, date, date);

CREATE FUNCTION public.public_check_branch_bookings_range(
  p_branch_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  booking_date date,
  start_time time,
  duration_minutes int,
  room_id uuid,
  therapist_gender text,
  gender_preference text,
  counts_as_online_capacity boolean
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
    (b.therapist_id IS NULL AND b.created_by IS NULL) AS counts_as_online_capacity
  FROM public.bookings b
  LEFT JOIN public.therapists t ON t.id = b.therapist_id
  WHERE b.branch_id = p_branch_id
    AND b.date BETWEEN p_start_date AND p_end_date
    AND b.status NOT IN ('Cancelled', 'No Show')

  UNION ALL

  -- Room-scoped blocks: one row per capacity unit, so the room reads as fully occupied
  -- (not "1 of N seats taken") for the block's whole span.
  SELECT
    occ.occ_date AS booking_date,
    mb.start_time,
    mb.duration_minutes,
    mb.room_id,
    NULL::text AS therapist_gender,
    NULL::text AS gender_preference,
    false AS counts_as_online_capacity
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

  -- Whole-location blocks (no room, no therapist): same full-capacity treatment, for every
  -- active room in the branch.
  SELECT
    occ.occ_date AS booking_date,
    mb.start_time,
    mb.duration_minutes,
    r.id AS room_id,
    NULL::text AS therapist_gender,
    NULL::text AS gender_preference,
    false AS counts_as_online_capacity
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
    );
$$;

REVOKE ALL ON FUNCTION public.public_check_branch_bookings_range(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_check_branch_bookings_range(uuid, date, date) TO anon, authenticated;

-- Male/female headcount among therapists actually eligible for p_service_id at
-- p_branch_id — same branch-scoped "no allow-list rows at this branch = unrestricted"
-- predicate as public_get_bookable_therapists (migration-257), without that
-- function's show_staff_selection gate (this path is specifically for tenants where
-- staff-selection is OFF) and without returning any PII (no name/photo/bio — counts
-- only, safe for anon).
CREATE OR REPLACE FUNCTION public.public_get_service_eligible_gender_headcount(
  p_org_slug text,
  p_branch_id uuid,
  p_service_id uuid
)
RETURNS TABLE (
  male_count   integer,
  female_count integer
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    COUNT(*) FILTER (WHERE t.gender = 'Male')::int AS male_count,
    COUNT(*) FILTER (WHERE t.gender = 'Female')::int AS female_count
  FROM public.therapists t
  JOIN public.branches b ON b.id = t.branch_id
  JOIN public.organizations o ON o.id = b.org_id
  WHERE o.slug = p_org_slug
    AND o.is_active = true
    AND t.branch_id = p_branch_id
    AND t.is_active = true
    AND t.is_service_staff = true
    -- Unrestricted unless this service has an allow-list row at this branch, in
    -- which case only allow-listed therapists count — same convention as
    -- public_get_bookable_therapists (migration-257).
    AND (
      NOT EXISTS (
        SELECT 1
        FROM public.service_therapists st
        JOIN public.therapists st_t ON st_t.id = st.therapist_id
        WHERE st.service_id = p_service_id AND st_t.branch_id = p_branch_id
      )
      OR EXISTS (
        SELECT 1 FROM public.service_therapists st
        WHERE st.service_id = p_service_id AND st.therapist_id = t.id
      )
    );
$$;

REVOKE ALL ON FUNCTION public.public_get_service_eligible_gender_headcount(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_get_service_eligible_gender_headcount(text, uuid, uuid) TO anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('307', 'online-availability-gender-preference-reserve')
ON CONFLICT (version) DO NOTHING;

COMMIT;
