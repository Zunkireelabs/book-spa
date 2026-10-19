-- Migration 299: manual_blocks must occupy a room's FULL capacity, not 1 unit
--
-- Bug: public_check_branch_bookings_range() (migration-213) emits exactly one occupied-slot
-- row per room per manual_blocks occurrence, same as a single real booking. That's correct for
-- bookings (a capacity-2 room genuinely has one more seat free), but wrong for blocks: a block
-- means the room is unusable for ANY booking, regardless of its capacity. For a capacity-1 room
-- one row happens to fill it, masking the bug — but for a capacity-2+ room, the customer-facing
-- date picker (buildOccupancy() in src/pages/customer-booking-flow/utils/availability.js) still
-- sees 1 occupied < capacity and reports the room (and therefore the whole day, since any one
-- free room keeps the day bookable) as available. This was caught trying to use a whole-location
-- "closed date" block to take a branch fully offline: rooms with capacity 1 closed correctly,
-- rooms with capacity 2 did not, so the branch stayed bookable online during the "closed" dates.
--
-- Fix: cross-join each manual_blocks occurrence against generate_series(1, room.capacity) so it
-- expands into `capacity` occupied rows for that room/date/slot — exactly saturating it — instead
-- of always exactly one. Booking rows (the first branch of the UNION ALL) are untouched.
--
-- Reversible (manual): re-apply migration-213's original CREATE OR REPLACE to restore the
-- 1-row-per-occurrence version.

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
    AND b.status NOT IN ('Cancelled', 'No Show')

  UNION ALL

  -- Room-scoped blocks: one row per capacity unit, so the room reads as fully occupied
  -- (not "1 of N seats taken") for the block's whole span.
  SELECT
    occ.occ_date AS booking_date,
    mb.start_time,
    mb.duration_minutes,
    mb.room_id,
    NULL::text AS therapist_gender
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
    NULL::text AS therapist_gender
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

INSERT INTO public.schema_migrations (version, name)
VALUES ('299', 'manual-block-full-capacity')
ON CONFLICT (version) DO NOTHING;
