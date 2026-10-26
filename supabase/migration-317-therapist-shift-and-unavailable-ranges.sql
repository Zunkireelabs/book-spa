-- Migration 317: the staff-availability helpers (ZNLY-100, V29a)
--  * minutes_to_hhmm(int)
--  * therapist_shift_for(therapist, date, branch) -> jsonb {works,start,end,start_min,end_min,breaks[],source,off[]}
--      source: 'roster' (staff_roster_overrides wins) > 'weekly' (therapist_working_hours) > 'none' (nothing set for that date).
--      day_of_week 0=Monday (ISODOW-1), dates are Nepal dates. Branch hours always apply: intersected with roster/weekly shifts, and used as the shift when nothing is set
--      (no branch hours configured + nothing set = unrestricted).
--      Half-day attendance (1st/2nd-Half Day) becomes an 'off' range split at the start of the day's longest break,
--      else the shift midpoint floored to :00/:30 (no hours: branch hours stand in for the shift).
--  * therapist_unavailable_ranges(therapist, date, branch, exclude_booking) -> every reason the therapist cannot be
--      booked that day as minute ranges since Nepal midnight, with a stable code:
--      ON_LEAVE, OVERLAP (never overridable), OTHER_BRANCH, BLOCKED, ON_BREAK, OFF_SHIFT.
-- These ignore the per-tenant switch; the guard (319) and public RPCs (320) decide when to apply them.
-- Reversible (manual): DROP FUNCTION public.therapist_unavailable_ranges(uuid,date,uuid,uuid), public.therapist_shift_for(uuid,date,uuid), public.minutes_to_hhmm(int);
BEGIN;

CREATE OR REPLACE FUNCTION public.minutes_to_hhmm(p_min int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_min >= 1440 THEN '24:00'
              ELSE lpad((p_min / 60)::text, 2, '0') || ':' || lpad((p_min % 60)::text, 2, '0') END;
$$;

CREATE OR REPLACE FUNCTION public.therapist_shift_for(p_therapist_id uuid, p_date date, p_branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_dow     int := EXTRACT(ISODOW FROM p_date)::int - 1;
  v_branch  uuid;
  v_src     text := 'none';
  v_works   boolean := true;
  v_s       int;
  v_e       int;
  v_open    int;
  v_close   int;
  v_breaks  jsonb := '[]'::jsonb;
  v_off     jsonb := '[]'::jsonb;
  v_status  text;
  v_att     record;
  v_split   int;
  v_ov      record;
  v_wh      record;
BEGIN
  SELECT COALESCE(p_branch_id, t.branch_id) INTO v_branch FROM public.therapists t WHERE t.id = p_therapist_id;

  SELECT * INTO v_ov FROM public.staff_roster_overrides WHERE therapist_id = p_therapist_id AND override_date = p_date;
  IF FOUND THEN
    v_src := 'roster';
    v_works := NOT v_ov.is_day_off;
    IF v_works THEN
      v_s := (EXTRACT(EPOCH FROM v_ov.start_time) / 60)::int;
      v_e := (EXTRACT(EPOCH FROM v_ov.end_time) / 60)::int;
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('name', b.name, 'start', public.minutes_to_hhmm((EXTRACT(EPOCH FROM b.start_time)/60)::int),
             'end', public.minutes_to_hhmm((EXTRACT(EPOCH FROM b.end_time)/60)::int),
             'start_min', (EXTRACT(EPOCH FROM b.start_time)/60)::int, 'end_min', (EXTRACT(EPOCH FROM b.end_time)/60)::int)
           ORDER BY b.sort_order, b.start_time), '[]'::jsonb)
      INTO v_breaks
      FROM public.staff_roster_override_breaks b WHERE b.roster_override_id = v_ov.id;
  ELSE
    SELECT * INTO v_wh FROM public.therapist_working_hours WHERE therapist_id = p_therapist_id AND day_of_week = v_dow;
    IF FOUND THEN
      v_src := 'weekly';
      v_works := NOT v_wh.is_day_off;
      IF v_works THEN
        v_s := (EXTRACT(EPOCH FROM v_wh.start_time) / 60)::int;
        v_e := (EXTRACT(EPOCH FROM v_wh.end_time) / 60)::int;
      END IF;
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', b.name, 'start', public.minutes_to_hhmm((EXTRACT(EPOCH FROM b.start_time)/60)::int),
               'end', public.minutes_to_hhmm((EXTRACT(EPOCH FROM b.end_time)/60)::int),
               'start_min', (EXTRACT(EPOCH FROM b.start_time)/60)::int, 'end_min', (EXTRACT(EPOCH FROM b.end_time)/60)::int)
             ORDER BY b.sort_order, b.start_time), '[]'::jsonb)
        INTO v_breaks
        FROM public.therapist_working_hours_breaks b WHERE b.working_hours_id = v_wh.id;
    END IF;
  END IF;

  SELECT (EXTRACT(EPOCH FROM open_time) / 60)::int, (EXTRACT(EPOCH FROM close_time) / 60)::int
    INTO v_open, v_close FROM public.branches WHERE id = v_branch;

  IF v_works THEN
    IF v_src = 'none' THEN
      -- nothing set for the day: bookable inside branch hours (branch hours always apply)
      IF v_open IS NOT NULL OR v_close IS NOT NULL THEN
        v_s := COALESCE(v_open, 0);
        v_e := COALESCE(v_close, 1440);
      END IF;
    ELSE
      IF v_open IS NOT NULL THEN v_s := GREATEST(v_s, v_open); END IF;
      IF v_close IS NOT NULL THEN v_e := LEAST(v_e, v_close); END IF;
    END IF;
    IF v_s IS NOT NULL AND v_s >= v_e THEN v_works := false; END IF;
  END IF;

  SELECT status::text AS status, off_start, off_end INTO v_att FROM public.therapist_attendance
   WHERE therapist_id = p_therapist_id AND date = p_date AND status::text IN ('1st-Half Day', '2nd-Half Day') LIMIT 1;
  v_status := v_att.status;
  IF v_status IS NOT NULL AND v_att.off_start IS NOT NULL THEN
    -- explicit times win over the split rule
    v_off := jsonb_build_array(jsonb_build_object(
      'start_min', (EXTRACT(EPOCH FROM v_att.off_start) / 60)::int, 'end_min', (EXTRACT(EPOCH FROM v_att.off_end) / 60)::int,
      'start', public.minutes_to_hhmm((EXTRACT(EPOCH FROM v_att.off_start) / 60)::int),
      'end', public.minutes_to_hhmm((EXTRACT(EPOCH FROM v_att.off_end) / 60)::int), 'reason', 'leave_half'));
  ELSIF v_status IS NOT NULL THEN
    IF v_works AND v_s IS NOT NULL AND v_e IS NOT NULL THEN
      SELECT (x->>'start_min')::int INTO v_split FROM jsonb_array_elements(v_breaks) x
       ORDER BY ((x->>'end_min')::int - (x->>'start_min')::int) DESC, (x->>'start_min')::int LIMIT 1;
      IF v_split IS NULL THEN v_split := ((v_s + v_e) / 2 / 30) * 30; END IF;
      v_split := LEAST(GREATEST(v_split, v_s), v_e);
      IF v_status = '1st-Half Day' THEN
        v_off := jsonb_build_array(jsonb_build_object('start_min', v_s, 'end_min', v_split, 'start', public.minutes_to_hhmm(v_s), 'end', public.minutes_to_hhmm(v_split), 'reason', 'leave_half'));
      ELSE
        v_off := jsonb_build_array(jsonb_build_object('start_min', v_split, 'end_min', v_e, 'start', public.minutes_to_hhmm(v_split), 'end', public.minutes_to_hhmm(v_e), 'reason', 'leave_half'));
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'works', v_works, 'source', v_src,
    'start', CASE WHEN v_s IS NULL THEN NULL ELSE public.minutes_to_hhmm(v_s) END,
    'end', CASE WHEN v_e IS NULL THEN NULL ELSE public.minutes_to_hhmm(v_e) END,
    'start_min', v_s, 'end_min', v_e, 'breaks', v_breaks, 'off', v_off);
END;
$$;

CREATE OR REPLACE FUNCTION public.therapist_unavailable_ranges(
  p_therapist_id uuid, p_date date, p_branch_id uuid DEFAULT NULL, p_exclude_booking_id uuid DEFAULT NULL)
RETURNS TABLE(start_min int, end_min int, code text, reason text, label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
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
$$;

REVOKE ALL ON FUNCTION public.therapist_shift_for(uuid, date, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.therapist_unavailable_ranges(uuid, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.therapist_shift_for(uuid, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.therapist_unavailable_ranges(uuid, date, uuid, uuid) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('317', 'therapist-shift-and-unavailable-ranges')
ON CONFLICT (version) DO NOTHING;

COMMIT;
