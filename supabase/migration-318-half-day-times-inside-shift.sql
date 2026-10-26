-- Migration 318: an explicit half-day range (therapist_attendance.off_start/off_end) must sit inside that day's shift.
-- No shift set for the day (source 'none') = nothing to compare against, so it is accepted.
-- Reversible (manual): DROP TRIGGER trg_attendance_off_range_check ON public.therapist_attendance; DROP FUNCTION public.enforce_attendance_off_range();
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_attendance_off_range()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_shift jsonb;
  v_s int := (EXTRACT(EPOCH FROM NEW.off_start) / 60)::int;
  v_e int := (EXTRACT(EPOCH FROM NEW.off_end) / 60)::int;
BEGIN
  IF NEW.off_start IS NULL THEN RETURN NEW; END IF;
  IF NEW.status::text NOT IN ('1st-Half Day', '2nd-Half Day') THEN
    RAISE EXCEPTION 'HALF_DAY_TIMES_INVALID: off_start/off_end only apply to a half-day status.' USING ERRCODE = 'P0006';
  END IF;
  v_shift := public.therapist_shift_for(NEW.therapist_id, NEW.date, NEW.branch_id);
  IF v_shift->>'source' <> 'none' THEN
    IF NOT (v_shift->>'works')::boolean OR v_s < (v_shift->>'start_min')::int OR v_e > (v_shift->>'end_min')::int THEN
      RAISE EXCEPTION 'HALF_DAY_OUTSIDE_SHIFT: the half-day times must fall inside the shift (% - %).', v_shift->>'start', v_shift->>'end'
        USING ERRCODE = 'P0006';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_off_range_check ON public.therapist_attendance;
CREATE TRIGGER trg_attendance_off_range_check
  BEFORE INSERT OR UPDATE OF status, off_start, off_end ON public.therapist_attendance
  FOR EACH ROW EXECUTE FUNCTION public.enforce_attendance_off_range();

INSERT INTO public.schema_migrations (version, name)
VALUES ('318', 'half-day-times-inside-shift')
ON CONFLICT (version) DO NOTHING;

COMMIT;
