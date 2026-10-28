-- Migration 329: a temporary transfer window is WORKING TIME at the receiving branch (ZNLY-113, owner decision A+).
-- Before: a visitor was bookable only where the window overlapped their HOME shift (e.g. a 6:55-9:55 pm window for someone who works
-- 9-6 was never bookable). Now therapist_shift_for returns source='window' with the receiving branch's opening hours as the shift
-- when the person has a temporary window into p_branch_id that touches p_date. Every reader (therapist_unavailable_ranges,
-- therapist_shifts_for_range, check_therapist_booking_guards, the public slot RPCs) goes through therapist_shift_for, so they follow.
-- Leave, blocks, breaks and half-day leave still apply; the gaps outside the windows stay OTHER_BRANCH (mig 327).
-- Idempotent. Applied: stage - / prod -.

BEGIN;

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
  v_visit   boolean := false;
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

  -- ZNLY-113 (A+): inside a temporary window INTO this branch the person is working here for the whole window, whatever their
  -- usual hours / roster say (even a day off). Only this branch's opening hours bound it; leave, blocks and breaks still apply, and
  -- the minutes outside the windows are marked OTHER_BRANCH by therapist_unavailable_ranges.
  v_visit := v_branch IS DISTINCT FROM (SELECT t.branch_id FROM public.therapists t WHERE t.id = p_therapist_id)
             AND public._therapist_visits_branch_on(p_therapist_id, v_branch, p_date);
  IF v_visit THEN
    v_src := 'window';
    v_works := true;
    v_s := COALESCE(v_open, 0);
    v_e := COALESCE(v_close, 1440);
  ELSIF v_works THEN
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

INSERT INTO public.schema_migrations (version, name)
VALUES ('329', 'window-is-work')
ON CONFLICT (version) DO NOTHING;

COMMIT;
