-- Migration 301: surface branches.online_booking_capacity in the customer-facing
-- availability RPC + give admins a write path for it
--
-- branches.online_booking_capacity (migration-138) is enforced by the
-- check_branch_online_capacity() trigger (latest: migration-159) — it rejects an INSERT
-- when the number of overlapping *anonymous online* bookings (therapist_id IS NULL AND
-- created_by IS NULL) at that branch already equals the cap. Until now no frontend code
-- read the column at all, so the only way a customer discovered the cap was a rejected
-- submit (P0005 -> BRANCH_ONLINE_CAPACITY). Two gaps closed here:
--
-- 1. public_check_branch_bookings_range() gains a `counts_as_online_capacity` boolean so
--    the customer date/time picker can grey out slots that are already at the cap,
--    *before* submit. The flag is computed server-side from created_by, so no PII leaves
--    the function — the client only learns "this row consumes an online-capacity unit".
--    It mirrors the trigger's predicate exactly (b.therapist_id IS NULL AND
--    b.created_by IS NULL) rather than re-deriving the rule from the LEFT JOINed
--    therapists row, which would diverge if therapist_id ever pointed at a missing row.
--    manual_blocks rows are always false: they aren't bookings, and they already reduce
--    availability through the room-capacity path.
--    Changing the RETURNS TABLE shape needs DROP + CREATE (CREATE OR REPLACE cannot
--    change a function's return type), so the body below is migration-299's verbatim,
--    plus the one new column. Additive for clients: existing callers ignore it.
--
-- 2. update_branch_online_capacity() — branches has RLS enabled with SELECT-only
--    policies, so a plain .update() from the admin UI would silently affect zero rows.
--    Same admin-only SECURITY DEFINER shape as update_org_booking_settings(), scoped to
--    the caller's own org. NULL clears the cap (= uncapped, matching the trigger's
--    `IF v_capacity IS NULL THEN RETURN NEW` early-out).
--
-- The trigger stays the authoritative enforcement (it holds a pg_advisory_xact_lock, so
-- it is race-safe); this migration only makes an already-enforced rule visible earlier.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.update_branch_online_capacity(uuid, integer);
--   DROP FUNCTION IF EXISTS public.public_check_branch_bookings_range(uuid, date, date);
--   -- then re-apply migration-299's CREATE OR REPLACE to restore the 5-column version.
--
-- Applied: stage 2026-10-26 / prod HELD.

BEGIN;

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

CREATE OR REPLACE FUNCTION public.update_branch_online_capacity(
  p_branch_id uuid,
  p_capacity integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid := get_user_org_id();
  v_role   text := get_user_role();
  v_found  uuid;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'update_branch_online_capacity: admin only';
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'update_branch_online_capacity: no organization context';
  END IF;

  -- Mirrors the column's own CHECK (online_booking_capacity > 0); raised here so the UI
  -- gets this message instead of a raw constraint-violation code.
  IF p_capacity IS NOT NULL AND p_capacity < 1 THEN
    RAISE EXCEPTION 'update_branch_online_capacity: capacity must be at least 1, or blank for no cap';
  END IF;

  UPDATE public.branches
  SET online_booking_capacity = p_capacity
  WHERE id = p_branch_id
    AND org_id = v_org_id
  RETURNING id INTO v_found;

  IF v_found IS NULL THEN
    RAISE EXCEPTION 'update_branch_online_capacity: branch % not found in this organization', p_branch_id;
  END IF;

  RETURN p_capacity;
END;
$$;

-- Staff-only: revoke from anon explicitly as well as PUBLIC — a default-privileges
-- grant straight to anon would survive the PUBLIC revoke on its own (same belt-and-
-- braces as migration-298).
REVOKE ALL ON FUNCTION public.update_branch_online_capacity(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_branch_online_capacity(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_branch_online_capacity(uuid, integer) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('301', 'online-capacity-public-availability')
ON CONFLICT (version) DO NOTHING;

COMMIT;
