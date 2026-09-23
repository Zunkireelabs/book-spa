-- Migration 213: fold room-scoped manual_blocks into the customer-facing availability RPC
--
-- Room downtime blocked via the Calendar's "Add block" (migration-212) with "Prevent online
-- bookings during this time?" checked should also reduce customer-facing slot availability —
-- public_check_branch_bookings_range()'s existing byRoom capacity model (consumed by
-- src/pages/customer-booking-flow/utils/availability.js's buildOccupancy()) already treats
-- any row it returns as an occupied room-slot, so this just UNIONs in expanded block
-- occurrences shaped like booking rows. Therapist-only/whole-location blocks (no room_id)
-- are intentionally excluded — the capacity model has no per-therapist concept, only
-- room + gender headcount (see the calendar-bundle plan's locked scope decision).
--
-- Recurrence is expanded server-side here (daily/weekly via generate_series, monthly via a
-- small clamping helper matching transfer_therapist()'s "Jan 31 + 1 month = Feb 28, not
-- overflow into March" semantics) so a recurring block's future occurrences are respected
-- without needing the client to round-trip its own expansion for public availability checks.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.public_check_branch_bookings_range(uuid, date, date);
--   DROP FUNCTION IF EXISTS public.manual_block_occurrence_date(date, text, int, int);
--   -- then re-apply migration-131's original CREATE to restore the pre-block-aware version.

CREATE OR REPLACE FUNCTION public.manual_block_occurrence_date(
  p_anchor date, p_freq text, p_interval int, p_n int
) RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_total_months int;
  v_target_year int;
  v_target_month int;
  v_last_day int;
BEGIN
  IF p_n = 0 THEN RETURN p_anchor; END IF;

  IF p_freq = 'daily' THEN
    RETURN p_anchor + (p_interval * p_n);
  ELSIF p_freq = 'weekly' THEN
    RETURN p_anchor + (p_interval * p_n * 7);
  ELSIF p_freq = 'monthly' THEN
    v_total_months := (EXTRACT(MONTH FROM p_anchor)::int - 1) + p_interval * p_n;
    v_target_year := EXTRACT(YEAR FROM p_anchor)::int + (v_total_months / 12);
    v_target_month := (v_total_months % 12);
    IF v_target_month < 0 THEN
      v_target_month := v_target_month + 12;
      v_target_year := v_target_year - 1;
    END IF;
    v_last_day := EXTRACT(DAY FROM (make_date(v_target_year, v_target_month + 1, 1) + interval '1 month' - interval '1 day'))::int;
    RETURN make_date(v_target_year, v_target_month + 1, LEAST(EXTRACT(DAY FROM p_anchor)::int, v_last_day));
  ELSE
    RAISE EXCEPTION 'Unknown recurrence freq: %', p_freq;
  END IF;
END;
$$;

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

  SELECT
    occ.occ_date AS booking_date,
    mb.start_time,
    mb.duration_minutes,
    mb.room_id,
    NULL::text AS therapist_gender
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

  -- Whole-location blocks (no room, no therapist) reduce capacity for every active room,
  -- same mechanism as a single-room block.
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

REVOKE ALL ON FUNCTION public.manual_block_occurrence_date(date, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manual_block_occurrence_date(date, text, int, int) TO anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('213', 'manual-blocks-public-availability')
ON CONFLICT (version) DO NOTHING;
