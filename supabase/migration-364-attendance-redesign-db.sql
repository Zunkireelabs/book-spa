-- Migration 364: attendance redesign, database step (ZNLY-123 / V34a).
--  1. attendance_changes: append-only change history, written by a trigger on therapist_attendance (so no write path can skip it).
--     (Visitor check-in/out from mig 362 writes the same therapist_attendance row, so the one trigger covers it too.)
--  2. Reason required server-side (ATTENDANCE_REASON_REQUIRED, P0007) when an existing record's status or a recorded time changes,
--     when a record is deleted, or when any record is written for a date before today (Nepal). A fresh check-in today, and filling a
--     time that was empty (check-out), need none. The reason + source reach the trigger through transaction-local settings
--     (zenly.change_reason / zenly.change_source) that save_attendance / mark_visitor_attendance set.
--  3. Per-branch settings on branches: late_grace_minutes (10), open_checkout_hours (4).
--  4. Readers: attendance_day_status(branch, date), attendance_gaps(branch, from, to).
--  5. Write path: save_attendance(therapist, date, patch jsonb, reason, source); mark_visitor_attendance gains p_reason.
-- NOTE: once applied, a direct client write that edits an existing record (without going through save_attendance) fails with
-- ATTENDANCE_REASON_REQUIRED. V34b moves the page onto save_attendance.
-- V34a2 (split the DAY from the PUNCHES): therapist_attendance = the day (status / half-day off times / notes, owned by home);
-- attendance_punches = any number of clock punches per person-day, each at the branch where it happened. therapist_attendance.check_in_time /
-- check_out_time stay as DERIVED columns (first in / last out, NULL out while a punch is open) kept in sync by a trigger on punches, so payroll and
-- the other readers keep working; clients can no longer write them. Punches are written only by punch_in / punch_out / save_punch / delete_punch.
-- Idempotent. Applied: stage - / prod -.

BEGIN;

-- ---- 3. branch settings ----
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS late_grace_minutes integer NOT NULL DEFAULT 10 CHECK (late_grace_minutes BETWEEN 0 AND 120),
  ADD COLUMN IF NOT EXISTS open_checkout_hours integer NOT NULL DEFAULT 4 CHECK (open_checkout_hours BETWEEN 1 AND 24),
  -- false (default): scheduled people count as present unless marked otherwise; a missing check-in is not a gap.
  -- true: a missing check-in is a No show / unmarked day (and an attendance_gaps 'unmarked' row).
  ADD COLUMN IF NOT EXISTS expect_check_in boolean NOT NULL DEFAULT false;

DROP FUNCTION IF EXISTS public.set_attendance_settings(uuid, integer, integer);
CREATE OR REPLACE FUNCTION public.set_attendance_settings(p_branch_id uuid, p_late_grace_minutes integer, p_open_checkout_hours integer, p_expect_check_in boolean DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public._can_manage_branch(p_branch_id) THEN
    RAISE EXCEPTION 'set_attendance_settings: not allowed for this branch' USING ERRCODE = '42501';
  END IF;
  UPDATE public.branches
     SET late_grace_minutes = COALESCE(p_late_grace_minutes, late_grace_minutes),
         open_checkout_hours = COALESCE(p_open_checkout_hours, open_checkout_hours),
         expect_check_in = COALESCE(p_expect_check_in, expect_check_in)
   WHERE id = p_branch_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_attendance_settings(uuid, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_attendance_settings(uuid, integer, integer, boolean) TO authenticated;

-- ---- 1. change history ----
CREATE TABLE IF NOT EXISTS public.attendance_changes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id),
  branch_id    uuid NOT NULL REFERENCES public.branches(id),
  therapist_id uuid NOT NULL REFERENCES public.therapists(id),
  date         date NOT NULL,
  field        text NOT NULL CHECK (field IN ('status', 'check_in_time', 'check_out_time', 'off_start', 'off_end', 'notes')),
  old_value    text,
  new_value    text,
  reason       text,
  changed_by   uuid,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  source       text NOT NULL DEFAULT 'panel' CHECK (source IN ('button', 'panel', 'bulk', 'visitor')),
  worked_at_branch_id uuid REFERENCES public.branches(id)   -- visitor rows: where the work happened (readable there too)
);
ALTER TABLE public.attendance_changes ADD COLUMN IF NOT EXISTS worked_at_branch_id uuid REFERENCES public.branches(id);
CREATE INDEX IF NOT EXISTS idx_attendance_changes_worked_at ON public.attendance_changes (worked_at_branch_id) WHERE worked_at_branch_id IS NOT NULL;
-- punch history lines: field check_in / check_out, the punch they belong to; branch_id = where the punch happened, worked_at_branch_id = the home branch
ALTER TABLE public.attendance_changes ADD COLUMN IF NOT EXISTS punch_id uuid;
ALTER TABLE public.attendance_changes DROP CONSTRAINT IF EXISTS attendance_changes_field_check;
ALTER TABLE public.attendance_changes ADD CONSTRAINT attendance_changes_field_check
  CHECK (field IN ('status', 'check_in_time', 'check_out_time', 'off_start', 'off_end', 'notes', 'check_in', 'check_out'));
ALTER TABLE public.attendance_changes DROP CONSTRAINT IF EXISTS attendance_changes_source_check;
ALTER TABLE public.attendance_changes ADD CONSTRAINT attendance_changes_source_check
  CHECK (source IN ('button', 'panel', 'bulk', 'visitor', 'device'));
CREATE INDEX IF NOT EXISTS idx_attendance_changes_lookup ON public.attendance_changes (branch_id, therapist_id, date, changed_at DESC);

ALTER TABLE public.attendance_changes ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.attendance_changes FROM PUBLIC, anon, authenticated;  -- only the SECURITY DEFINER trigger writes

-- Same rule as _can_manage_branch (that helper is not executable by authenticated, so it can't sit in a policy): manager/admin of the
-- branch, or an admin of the branch's org.
DROP POLICY IF EXISTS "Managers read attendance changes" ON public.attendance_changes;
CREATE POLICY "Managers read attendance changes" ON public.attendance_changes FOR SELECT TO authenticated
  USING ((SELECT get_user_role()) IN ('manager', 'admin')
         AND (branch_id IN (SELECT unnest(get_user_branch_ids()))
              OR worked_at_branch_id IN (SELECT unnest(get_user_branch_ids()))
              OR ((SELECT get_user_role()) = 'admin' AND org_id = (SELECT get_user_org_id()))));
-- history must not be forgeable: no INSERT policy or grant (an earlier draft had one)
DROP POLICY IF EXISTS "Managers insert attendance changes" ON public.attendance_changes;
-- no INSERT / UPDATE / DELETE policy; belt and braces for the table owner / service paths:
CREATE OR REPLACE FUNCTION public.attendance_changes_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'attendance_changes is append-only' USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS trg_attendance_changes_immutable ON public.attendance_changes;
CREATE TRIGGER trg_attendance_changes_immutable BEFORE UPDATE OR DELETE ON public.attendance_changes
  FOR EACH ROW EXECUTE FUNCTION public.attendance_changes_immutable();

-- ---- 2. reason required (BEFORE) ----
CREATE OR REPLACE FUNCTION public.enforce_attendance_reason()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_today  date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_reason text := NULLIF(btrim(COALESCE(current_setting('zenly.change_reason', true), '')), '');
  v_needs  boolean := false;
BEGIN
  -- the derived first-in / last-out columns are rewritten by the punch trigger; that is not an edit of the day
  IF COALESCE(current_setting('zenly.attendance_sync', true), '') = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    v_needs := NEW.date < v_today;
  ELSIF TG_OP = 'DELETE' THEN
    v_needs := true;
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status
       OR (OLD.check_in_time  IS NOT NULL AND NEW.check_in_time  IS DISTINCT FROM OLD.check_in_time)
       OR (OLD.check_out_time IS NOT NULL AND NEW.check_out_time IS DISTINCT FROM OLD.check_out_time)
       OR (OLD.off_start IS NOT NULL AND NEW.off_start IS DISTINCT FROM OLD.off_start)
       OR (OLD.off_end   IS NOT NULL AND NEW.off_end   IS DISTINCT FROM OLD.off_end) THEN
      v_needs := true;
    ELSIF OLD.date < v_today AND (NEW.check_in_time IS DISTINCT FROM OLD.check_in_time
                                  OR NEW.check_out_time IS DISTINCT FROM OLD.check_out_time
                                  OR NEW.off_start IS DISTINCT FROM OLD.off_start
                                  OR NEW.off_end IS DISTINCT FROM OLD.off_end
                                  OR NEW.notes IS DISTINCT FROM OLD.notes) THEN
      v_needs := true;
    END IF;
  END IF;
  IF v_needs AND v_reason IS NULL THEN
    RAISE EXCEPTION 'ATTENDANCE_REASON_REQUIRED: A reason is required to change this attendance record.' USING ERRCODE = 'P0007';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS trg_attendance_reason_required ON public.therapist_attendance;
CREATE TRIGGER trg_attendance_reason_required BEFORE INSERT OR UPDATE OR DELETE ON public.therapist_attendance
  FOR EACH ROW EXECUTE FUNCTION public.enforce_attendance_reason();

-- ---- 1. history writer (AFTER) ----
CREATE OR REPLACE FUNCTION public.log_attendance_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r       public.therapist_attendance;
  v_org   uuid;
  v_src   text := COALESCE(NULLIF(current_setting('zenly.change_source', true), ''), 'panel');
  v_why   text := NULLIF(btrim(COALESCE(current_setting('zenly.change_reason', true), '')), '');
  v_by    uuid := auth.uid();
  f       text;
  v_old   text;
  v_new   text;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT org_id INTO v_org FROM public.branches WHERE id = r.branch_id;
  FOREACH f IN ARRAY ARRAY['status', 'check_in_time', 'check_out_time', 'off_start', 'off_end', 'notes'] LOOP
    -- derived times are logged as punch lines, not as day lines
    CONTINUE WHEN f IN ('check_in_time', 'check_out_time') AND COALESCE(current_setting('zenly.attendance_sync', true), '') = 'on';
    v_old := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) ->> f END;
    v_new := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) ->> f END;
    IF v_old IS DISTINCT FROM v_new THEN
      INSERT INTO public.attendance_changes (org_id, branch_id, therapist_id, date, field, old_value, new_value, reason, changed_by, source, worked_at_branch_id)
      VALUES (v_org, r.branch_id, r.therapist_id, r.date, f, v_old, v_new, v_why, v_by, v_src, r.worked_at_branch_id);
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_attendance_log_changes ON public.therapist_attendance;
CREATE TRIGGER trg_attendance_log_changes AFTER INSERT OR UPDATE OR DELETE ON public.therapist_attendance
  FOR EACH ROW EXECUTE FUNCTION public.log_attendance_changes();

-- ---- V34a2: punches ----
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS public.attendance_punches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id),
  therapist_id uuid NOT NULL REFERENCES public.therapists(id),
  date         date NOT NULL,                                   -- the Nepal day this punch belongs to (= the day row's date)
  branch_id    uuid NOT NULL REFERENCES public.branches(id),    -- where it happened
  check_in     timestamptz NOT NULL,
  check_out    timestamptz,                                     -- NULL = still in
  source       text NOT NULL DEFAULT 'button' CHECK (source IN ('button', 'panel', 'bulk', 'visitor', 'device')),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  legacy_raw   jsonb,                                           -- legacy punches: the original check_in / check_out as stored, never lost
  span         tstzrange,                                       -- [check_in, check_out) or, while open, to the end of its day; set by trigger
  CONSTRAINT attendance_punches_out_after_in CHECK (check_out IS NULL OR check_out > check_in)
);
ALTER TABLE public.attendance_punches ADD COLUMN IF NOT EXISTS legacy_raw jsonb;
-- 'legacy' = punches backfilled from pre-punch day rows: kept verbatim, so check_out >= check_in is allowed for them only
ALTER TABLE public.attendance_punches DROP CONSTRAINT IF EXISTS attendance_punches_source_check;
ALTER TABLE public.attendance_punches ADD CONSTRAINT attendance_punches_source_check CHECK (source IN ('button', 'panel', 'bulk', 'visitor', 'device', 'legacy'));
ALTER TABLE public.attendance_punches DROP CONSTRAINT IF EXISTS attendance_punches_out_after_in;
ALTER TABLE public.attendance_punches ADD CONSTRAINT attendance_punches_out_after_in
  CHECK (check_out IS NULL OR check_out > check_in OR (source = 'legacy' AND check_out >= check_in));
CREATE INDEX IF NOT EXISTS idx_attendance_punches_day ON public.attendance_punches (therapist_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_punches_branch_day ON public.attendance_punches (branch_id, date);
-- one open punch per person per day (a forgotten open punch from an older day must not block today)
DROP INDEX IF EXISTS public.uq_attendance_punches_open;
CREATE UNIQUE INDEX uq_attendance_punches_open ON public.attendance_punches (therapist_id, date) WHERE check_out IS NULL AND source <> 'legacy';   -- legacy lone check-ins are never "open"
-- no overlapping punches for one person (an open punch occupies the rest of its day)
ALTER TABLE public.attendance_punches DROP CONSTRAINT IF EXISTS attendance_punches_no_overlap;
ALTER TABLE public.attendance_punches ADD CONSTRAINT attendance_punches_no_overlap EXCLUDE USING gist (therapist_id WITH =, span WITH &&);

ALTER TABLE public.attendance_punches ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.attendance_punches FROM PUBLIC, anon, authenticated;   -- only the RPCs below write
DROP POLICY IF EXISTS "Managers read attendance punches" ON public.attendance_punches;
CREATE POLICY "Managers read attendance punches" ON public.attendance_punches FOR SELECT TO authenticated
  USING ((SELECT get_user_role()) IN ('manager', 'admin')
         AND (branch_id IN (SELECT unnest(get_user_branch_ids()))
              OR EXISTS (SELECT 1 FROM public.therapist_attendance a
                          WHERE a.therapist_id = attendance_punches.therapist_id AND a.date = attendance_punches.date
                            AND a.branch_id IN (SELECT unnest(get_user_branch_ids())))
              OR ((SELECT get_user_role()) = 'admin' AND org_id = (SELECT get_user_org_id()))));

-- the day row's first-in / last-out follow the punches (NULL last-out while any punch is open); the first punch's branch is the old worked_at
CREATE OR REPLACE FUNCTION public.sync_attendance_times(p_therapist_id uuid, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_prev text := COALESCE(current_setting('zenly.attendance_sync', true), '');
BEGIN
  PERFORM set_config('zenly.attendance_sync', 'on', true);
  UPDATE public.therapist_attendance a
     SET check_in_time = x.fi, check_out_time = x.lo, worked_at_branch_id = CASE WHEN x.wb IS DISTINCT FROM a.branch_id THEN x.wb END
    FROM (SELECT (SELECT min(p.check_in) FROM public.attendance_punches p WHERE p.therapist_id = p_therapist_id AND p.date = p_date) AS fi,
                 CASE WHEN EXISTS (SELECT 1 FROM public.attendance_punches p WHERE p.therapist_id = p_therapist_id AND p.date = p_date AND p.check_out IS NULL AND p.source <> 'legacy') THEN NULL
                      ELSE (SELECT max(p.check_out) FROM public.attendance_punches p WHERE p.therapist_id = p_therapist_id AND p.date = p_date) END AS lo,
                 (SELECT p.branch_id FROM public.attendance_punches p WHERE p.therapist_id = p_therapist_id AND p.date = p_date ORDER BY p.check_in LIMIT 1) AS wb) x
   WHERE a.therapist_id = p_therapist_id AND a.date = p_date
     AND (a.check_in_time IS DISTINCT FROM x.fi OR a.check_out_time IS DISTINCT FROM x.lo
          OR a.worked_at_branch_id IS DISTINCT FROM (CASE WHEN x.wb IS DISTINCT FROM a.branch_id THEN x.wb END));
  PERFORM set_config('zenly.attendance_sync', v_prev, true);
END;
$$;
REVOKE ALL ON FUNCTION public.sync_attendance_times(uuid, date) FROM PUBLIC, anon, authenticated;

-- clients can't write the derived columns
CREATE OR REPLACE FUNCTION public.guard_attendance_derived_times()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(current_setting('zenly.attendance_sync', true), '') = 'on' THEN RETURN NEW; END IF;
  IF (TG_OP = 'INSERT' AND (NEW.check_in_time IS NOT NULL OR NEW.check_out_time IS NOT NULL))
     OR (TG_OP = 'UPDATE' AND (NEW.check_in_time IS DISTINCT FROM OLD.check_in_time OR NEW.check_out_time IS DISTINCT FROM OLD.check_out_time)) THEN
    RAISE EXCEPTION 'ATTENDANCE_TIMES_DERIVED: check-in / check-out times come from punches (punch_in / punch_out / save_punch).' USING ERRCODE = 'P0010';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_attendance_derived_guard ON public.therapist_attendance;
CREATE TRIGGER trg_attendance_derived_guard BEFORE INSERT OR UPDATE ON public.therapist_attendance
  FOR EACH ROW EXECUTE FUNCTION public.guard_attendance_derived_times();

-- rules on a punch (BEFORE): closed day, reason
CREATE OR REPLACE FUNCTION public.enforce_punch_rules()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_today  date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_reason text := NULLIF(btrim(COALESCE(current_setting('zenly.change_reason', true), '')), '');
  r        public.attendance_punches;
  v_home   uuid;
  v_needs  boolean := false;
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.source = 'legacy' THEN NEW.span := NULL;   -- legacy rows are kept as they were (never rejected for overlap)
  ELSIF TG_OP <> 'DELETE' THEN   -- the exclusion constraint's range (an open punch occupies the rest of its day)
    NEW.span := tstzrange(NEW.check_in, GREATEST(COALESCE(NEW.check_out, (NEW.date + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu'), NEW.check_in + interval '1 second'));   -- (a bad check_out is caught by the CHECK)
  END IF;
  IF COALESCE(current_setting('zenly.attendance_backfill', true), '') = 'on' THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT a.branch_id INTO v_home FROM public.therapist_attendance a WHERE a.therapist_id = r.therapist_id AND a.date = r.date;
  IF EXISTS (SELECT 1 FROM public.daily_reports d WHERE d.report_date = r.date AND d.is_locked AND d.branch_id IN (r.branch_id, COALESCE(v_home, r.branch_id))) THEN
    RAISE EXCEPTION 'ATTENDANCE_DAY_LOCKED: This day has been closed. Attendance cannot be modified.' USING ERRCODE = 'P0004';
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_needs := NEW.date < v_today;
  ELSIF TG_OP = 'DELETE' THEN
    v_needs := true;
  ELSE
    v_needs := NEW.check_in IS DISTINCT FROM OLD.check_in
               OR (OLD.check_out IS NOT NULL AND NEW.check_out IS DISTINCT FROM OLD.check_out)
               OR (OLD.date < v_today AND NEW.check_out IS DISTINCT FROM OLD.check_out);
  END IF;
  IF v_needs AND v_reason IS NULL THEN
    RAISE EXCEPTION 'ATTENDANCE_REASON_REQUIRED: A reason is required to change this attendance record.' USING ERRCODE = 'P0007';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS trg_attendance_punch_rules ON public.attendance_punches;
CREATE TRIGGER trg_attendance_punch_rules BEFORE INSERT OR UPDATE OR DELETE ON public.attendance_punches
  FOR EACH ROW EXECUTE FUNCTION public.enforce_punch_rules();

-- history + derived-time sync (AFTER)
CREATE OR REPLACE FUNCTION public.log_attendance_punch_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r       public.attendance_punches;
  v_home  uuid;
  v_src   text;
  v_why   text := NULLIF(btrim(COALESCE(current_setting('zenly.change_reason', true), '')), '');
  f       text;
  v_old   text;
  v_new   text;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF COALESCE(current_setting('zenly.attendance_backfill', true), '') <> 'on' THEN
    v_src := COALESCE(NULLIF(current_setting('zenly.change_source', true), ''), r.source);
    SELECT a.branch_id INTO v_home FROM public.therapist_attendance a WHERE a.therapist_id = r.therapist_id AND a.date = r.date;
    FOREACH f IN ARRAY ARRAY['check_in', 'check_out'] LOOP
      v_old := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) ->> f END;
      v_new := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) ->> f END;
      IF v_old IS DISTINCT FROM v_new THEN
        INSERT INTO public.attendance_changes (org_id, branch_id, therapist_id, date, field, old_value, new_value, reason, changed_by, source, worked_at_branch_id, punch_id)
        VALUES (r.org_id, r.branch_id, r.therapist_id, r.date, f, v_old, v_new, v_why, auth.uid(), v_src,
                CASE WHEN v_home IS DISTINCT FROM r.branch_id THEN v_home END, r.id);
      END IF;
    END LOOP;
  END IF;
  PERFORM public.sync_attendance_times(r.therapist_id, r.date);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_attendance_punch_log ON public.attendance_punches;
CREATE TRIGGER trg_attendance_punch_log AFTER INSERT OR UPDATE OR DELETE ON public.attendance_punches
  FOR EACH ROW EXECUTE FUNCTION public.log_attendance_punch_changes();

-- backfill: every existing check-in / check-out becomes one punch (where it happened = worked_at, else the day's branch). No history lines.
DO $bf$
BEGIN
  PERFORM set_config('zenly.attendance_backfill', 'on', true);
  INSERT INTO public.attendance_punches (org_id, therapist_id, date, branch_id, check_in, check_out, source, created_by, created_at, legacy_raw)
  SELECT b.org_id, a.therapist_id, a.date, b.id, a.check_in_time,
         CASE WHEN a.check_out_time >= a.check_in_time THEN a.check_out_time END,   -- an impossible out-before-in pair keeps the check-in only
         'legacy', a.marked_by, COALESCE(a.created_at, now()),
         jsonb_build_object('check_in', a.check_in_time, 'check_out', a.check_out_time)
    FROM public.therapist_attendance a
    JOIN public.branches b ON b.id = COALESCE(a.worked_at_branch_id, a.branch_id)
   WHERE a.check_in_time IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.attendance_punches p WHERE p.therapist_id = a.therapist_id AND p.date = a.date);
  PERFORM set_config('zenly.attendance_backfill', '', true);
  UPDATE public.attendance_punches SET legacy_raw = jsonb_build_object('check_in', check_in, 'check_out', check_out) WHERE source = 'legacy' AND legacy_raw IS NULL;
END
$bf$;

-- ---- punch RPCs (SECURITY DEFINER; the caller must manage the branch the punch happened at) ----
CREATE OR REPLACE FUNCTION public._can_manage_punch(p_punch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.attendance_punches p WHERE p.id = p_punch_id
                  AND (public._can_manage_branch(p.branch_id)
                       OR public._can_manage_branch((SELECT a.branch_id FROM public.therapist_attendance a WHERE a.therapist_id = p.therapist_id AND a.date = p.date))));
$$;
REVOKE ALL ON FUNCTION public._can_manage_punch(uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.punch_in(uuid, uuid, timestamptz, text);
CREATE OR REPLACE FUNCTION public.punch_in(
  p_therapist_id uuid, p_branch_id uuid, p_at timestamptz DEFAULT now(), p_source text DEFAULT 'button',
  p_reason text DEFAULT NULL, p_out timestamptz DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_date date := (p_at AT TIME ZONE 'Asia/Kathmandu')::date;
  v_day  public.therapist_attendance;
  v_home uuid;
  v_org  uuid;
  v_id   uuid;
BEGIN
  IF p_source NOT IN ('button', 'panel', 'bulk', 'visitor', 'device') THEN RAISE EXCEPTION 'punch_in: bad source %', p_source; END IF;
  IF NOT public._can_manage_branch(p_branch_id) THEN
    RAISE EXCEPTION 'punch_in: not allowed for this branch' USING ERRCODE = '42501';
  END IF;
  IF p_at > now() + interval '5 minutes' THEN RAISE EXCEPTION 'punch_in: a check-in cannot be in the future'; END IF;
  SELECT * INTO v_day FROM public.therapist_attendance WHERE therapist_id = p_therapist_id AND date = v_date;
  v_home := COALESCE(v_day.branch_id, public.therapist_home_on(p_therapist_id, ((v_date::timestamp + interval '12 hours') AT TIME ZONE 'Asia/Kathmandu')));
  IF v_home IS NULL THEN RAISE EXCEPTION 'punch_in: unknown person'; END IF;
  IF p_branch_id <> v_home AND NOT public._therapist_visits_branch_on(p_therapist_id, p_branch_id, v_date) THEN
    RAISE EXCEPTION 'punch_in: this person is not working at this branch that day';
  END IF;
  SELECT org_id INTO v_org FROM public.branches WHERE id = p_branch_id;
  PERFORM set_config('zenly.change_reason', COALESCE(p_reason, ''), true);
  PERFORM set_config('zenly.change_source', p_source, true);
  IF v_day.id IS NULL THEN   -- the first punch of the day creates the day (Present, owned by home)
    INSERT INTO public.therapist_attendance (branch_id, therapist_id, date, status, marked_by) VALUES (v_home, p_therapist_id, v_date, 'Present', auth.uid());
  END IF;
  BEGIN
    INSERT INTO public.attendance_punches (org_id, therapist_id, date, branch_id, check_in, check_out, source, created_by)
    VALUES (v_org, p_therapist_id, v_date, p_branch_id, p_at, p_out, p_source, auth.uid()) RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN RAISE EXCEPTION 'PUNCH_OPEN_EXISTS: This person already has an open check-in that day.' USING ERRCODE = 'P0008';
    WHEN exclusion_violation THEN RAISE EXCEPTION 'PUNCH_OVERLAP: This time overlaps another punch for this person.' USING ERRCODE = 'P0009';
    WHEN check_violation THEN RAISE EXCEPTION 'PUNCH_BAD_TIMES: Check-out must be after check-in.' USING ERRCODE = 'P0011';
  END;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.punch_in(uuid, uuid, timestamptz, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.punch_in(uuid, uuid, timestamptz, text, text, timestamptz) TO authenticated;

-- close a punch: by id, or the open punch of a person at a branch (latest day)
CREATE OR REPLACE FUNCTION public.punch_out(
  p_punch_id uuid DEFAULT NULL, p_therapist_id uuid DEFAULT NULL, p_branch_id uuid DEFAULT NULL, p_at timestamptz DEFAULT now(),
  p_reason text DEFAULT NULL, p_source text DEFAULT 'button')
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_id uuid := p_punch_id;
BEGIN
  IF v_id IS NULL THEN
    SELECT p.id INTO v_id FROM public.attendance_punches p
     WHERE p.therapist_id = p_therapist_id AND p.branch_id = p_branch_id AND p.check_out IS NULL ORDER BY p.date DESC LIMIT 1;
  END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'punch_out: no open check-in to close'; END IF;
  IF NOT public._can_manage_punch(v_id) THEN RAISE EXCEPTION 'punch_out: not allowed for this punch' USING ERRCODE = '42501'; END IF;
  IF p_at > now() + interval '5 minutes' THEN RAISE EXCEPTION 'punch_out: a check-out cannot be in the future'; END IF;
  PERFORM set_config('zenly.change_reason', COALESCE(p_reason, ''), true);
  PERFORM set_config('zenly.change_source', p_source, true);
  BEGIN
    UPDATE public.attendance_punches SET check_out = p_at WHERE id = v_id;
  EXCEPTION
    WHEN exclusion_violation THEN RAISE EXCEPTION 'PUNCH_OVERLAP: This time overlaps another punch for this person.' USING ERRCODE = 'P0009';
    WHEN check_violation THEN RAISE EXCEPTION 'PUNCH_BAD_TIMES: Check-out must be after check-in.' USING ERRCODE = 'P0011';
  END;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.punch_out(uuid, uuid, uuid, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.punch_out(uuid, uuid, uuid, timestamptz, text, text) TO authenticated;

-- edit a saved punch (a reason is required by the trigger); p_out NULL re-opens it
CREATE OR REPLACE FUNCTION public.save_punch(p_punch_id uuid, p_in timestamptz, p_out timestamptz, p_reason text, p_source text DEFAULT 'panel')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_date date;
BEGIN
  IF p_source NOT IN ('button', 'panel', 'bulk', 'visitor', 'device') THEN RAISE EXCEPTION 'save_punch: bad source %', p_source; END IF;
  IF NOT public._can_manage_punch(p_punch_id) THEN RAISE EXCEPTION 'save_punch: not allowed for this punch' USING ERRCODE = '42501'; END IF;
  SELECT date INTO v_date FROM public.attendance_punches WHERE id = p_punch_id;
  IF (p_in AT TIME ZONE 'Asia/Kathmandu')::date <> v_date THEN RAISE EXCEPTION 'save_punch: the check-in must stay on the same day'; END IF;
  PERFORM set_config('zenly.change_reason', COALESCE(p_reason, ''), true);
  PERFORM set_config('zenly.change_source', p_source, true);
  BEGIN
    UPDATE public.attendance_punches SET check_in = p_in, check_out = p_out WHERE id = p_punch_id;
  EXCEPTION
    WHEN unique_violation THEN RAISE EXCEPTION 'PUNCH_OPEN_EXISTS: This person already has an open check-in that day.' USING ERRCODE = 'P0008';
    WHEN exclusion_violation THEN RAISE EXCEPTION 'PUNCH_OVERLAP: This time overlaps another punch for this person.' USING ERRCODE = 'P0009';
    WHEN check_violation THEN RAISE EXCEPTION 'PUNCH_BAD_TIMES: Check-out must be after check-in.' USING ERRCODE = 'P0011';
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.save_punch(uuid, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_punch(uuid, timestamptz, timestamptz, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_punch(p_punch_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public._can_manage_punch(p_punch_id) THEN RAISE EXCEPTION 'delete_punch: not allowed for this punch' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('zenly.change_reason', COALESCE(p_reason, ''), true);
  PERFORM set_config('zenly.change_source', 'panel', true);
  DELETE FROM public.attendance_punches WHERE id = p_punch_id;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_punch(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_punch(uuid, text) TO authenticated;

-- ---- 5. write path ----
-- p_patch: keys present are applied (a JSON null clears); absent keys are left alone. Keys: status, off_start, off_end, notes.
-- (Check-in / check-out times are punches now: punch_in / punch_out.) Creates the home-owned day row (status defaults Present) when none exists.
CREATE OR REPLACE FUNCTION public.save_attendance(
  p_therapist_id uuid, p_date date, p_patch jsonb, p_reason text DEFAULT NULL, p_source text DEFAULT 'panel')
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_home uuid;
  v_id   uuid;
  v_ex   public.therapist_attendance;
BEGIN
  IF p_source NOT IN ('button', 'panel', 'bulk') THEN
    RAISE EXCEPTION 'save_attendance: bad source %', p_source;
  END IF;
  IF p_patch ? 'check_in_time' OR p_patch ? 'check_out_time' THEN
    RAISE EXCEPTION 'save_attendance: check-in / check-out are punches now (punch_in / punch_out)';
  END IF;
  SELECT * INTO v_ex FROM public.therapist_attendance WHERE therapist_id = p_therapist_id AND date = p_date;
  IF FOUND THEN
    v_home := v_ex.branch_id;
  ELSE
    v_home := public.therapist_home_on(p_therapist_id, ((p_date::timestamp + interval '12 hours') AT TIME ZONE 'Asia/Kathmandu'));
  END IF;
  IF v_home IS NULL OR NOT public._can_manage_branch(v_home) THEN
    RAISE EXCEPTION 'save_attendance: not allowed for this person' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('zenly.change_reason', COALESCE(p_reason, ''), true);
  PERFORM set_config('zenly.change_source', p_source, true);

  IF v_ex.id IS NOT NULL THEN
    UPDATE public.therapist_attendance ta SET
      status         = CASE WHEN p_patch ? 'status'         THEN (p_patch ->> 'status')::attendance_status ELSE ta.status END,
      off_start      = CASE WHEN p_patch ? 'off_start'      THEN (p_patch ->> 'off_start')::time ELSE ta.off_start END,
      off_end        = CASE WHEN p_patch ? 'off_end'        THEN (p_patch ->> 'off_end')::time ELSE ta.off_end END,
      notes          = CASE WHEN p_patch ? 'notes'          THEN p_patch ->> 'notes' ELSE ta.notes END,
      marked_by      = auth.uid()
     WHERE ta.id = v_ex.id
    RETURNING ta.id INTO v_id;
  ELSE
    INSERT INTO public.therapist_attendance (branch_id, therapist_id, date, status, off_start, off_end, notes, marked_by)
    VALUES (v_home, p_therapist_id, p_date,
            COALESCE((p_patch ->> 'status')::attendance_status, 'Present'),
            (p_patch ->> 'off_start')::time, (p_patch ->> 'off_end')::time, p_patch ->> 'notes', auth.uid())
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_attendance(uuid, date, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_attendance(uuid, date, jsonb, text, text) TO authenticated;

-- Undo of a fresh mark (the page's 6 s undo toast): removes the record; the history keeps both lines. A reason is required (trigger).
CREATE OR REPLACE FUNCTION public.delete_attendance(p_therapist_id uuid, p_date date, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_home uuid;
BEGIN
  SELECT branch_id INTO v_home FROM public.therapist_attendance WHERE therapist_id = p_therapist_id AND date = p_date;
  IF v_home IS NULL OR NOT public._can_manage_branch(v_home) THEN
    RAISE EXCEPTION 'delete_attendance: not allowed for this record' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.attendance_punches WHERE therapist_id = p_therapist_id AND date = p_date) THEN
    RAISE EXCEPTION 'delete_attendance: this day still has punches; delete them first';
  END IF;
  PERFORM set_config('zenly.change_reason', COALESCE(p_reason, ''), true);
  PERFORM set_config('zenly.change_source', 'button', true);
  DELETE FROM public.therapist_attendance WHERE therapist_id = p_therapist_id AND date = p_date;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_attendance(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_attendance(uuid, date, text) TO authenticated;

-- mark_visitor_attendance (mig 362) is now just punch_in / punch_out at the visited branch (no write to the day row).
DROP FUNCTION IF EXISTS public.mark_visitor_attendance(uuid, uuid, timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION public.mark_visitor_attendance(
  p_therapist_id uuid, p_branch_id uuid, p_check_in timestamptz DEFAULT NULL, p_check_out timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_check_in IS NOT NULL THEN v_id := public.punch_in(p_therapist_id, p_branch_id, p_check_in, 'visitor', p_reason, p_check_out);
  ELSIF p_check_out IS NOT NULL THEN v_id := public.punch_out(NULL, p_therapist_id, p_branch_id, p_check_out, p_reason, 'visitor');
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_visitor_attendance(uuid, uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_visitor_attendance(uuid, uuid, timestamptz, timestamptz, text) TO authenticated;

-- Today's visitors at p_branch_id with the punches recorded HERE today: first in, last out (NULL while one is open), count, open punch id.
DROP FUNCTION IF EXISTS public.visiting_attendance_today(uuid);
CREATE OR REPLACE FUNCTION public.visiting_attendance_today(p_branch_id uuid)
RETURNS TABLE(therapist_id uuid, therapist_name text, check_in_time timestamptz, check_out_time timestamptz, worked_at_branch_id uuid,
              window_from timestamptz, window_to timestamptz, punch_count integer, open_punch_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
BEGIN
  IF NOT public._can_manage_branch(p_branch_id) THEN
    RAISE EXCEPTION 'visiting_attendance_today: not allowed for this branch';
  END IF;
  RETURN QUERY
    SELECT t.id, t.name::text,
           (SELECT min(p.check_in) FROM public.attendance_punches p WHERE p.therapist_id = t.id AND p.date = v_today AND p.branch_id = p_branch_id),
           CASE WHEN EXISTS (SELECT 1 FROM public.attendance_punches p WHERE p.therapist_id = t.id AND p.date = v_today AND p.branch_id = p_branch_id AND p.check_out IS NULL) THEN NULL
                ELSE (SELECT max(p.check_out) FROM public.attendance_punches p WHERE p.therapist_id = t.id AND p.date = v_today AND p.branch_id = p_branch_id) END,
           CASE WHEN EXISTS (SELECT 1 FROM public.attendance_punches p WHERE p.therapist_id = t.id AND p.date = v_today AND p.branch_id = p_branch_id) THEN p_branch_id END,
           vw.ws, vw.we,
           (SELECT count(*)::integer FROM public.attendance_punches p WHERE p.therapist_id = t.id AND p.date = v_today AND p.branch_id = p_branch_id),
           (SELECT p.id FROM public.attendance_punches p WHERE p.therapist_id = t.id AND p.date = v_today AND p.branch_id = p_branch_id AND p.check_out IS NULL LIMIT 1)
      FROM public.therapists t
      CROSS JOIN LATERAL public._visitor_window_today(t.id, p_branch_id) vw
     WHERE t.is_active AND t.branch_id <> p_branch_id;
END;
$$;
REVOKE ALL ON FUNCTION public.visiting_attendance_today(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visiting_attendance_today(uuid) TO authenticated;

-- ---- 4. readers ----
-- Is the day closed? Same rule as enforce_attendance_day_lock (ATTENDANCE_DAY_LOCKED): a locked daily_reports row for the branch+date.
CREATE OR REPLACE FUNCTION public.attendance_day_status(p_branch_id uuid, p_date date)
RETURNS TABLE(is_closed boolean, closed_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public._can_manage_branch(p_branch_id) THEN
    RAISE EXCEPTION 'attendance_day_status: not allowed for this branch' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT EXISTS (SELECT 1 FROM public.daily_reports d WHERE d.branch_id = p_branch_id AND d.report_date = p_date AND d.is_locked),
           (SELECT d.closed_at FROM public.daily_reports d WHERE d.branch_id = p_branch_id AND d.report_date = p_date AND d.is_locked LIMIT 1);
END;
$$;
REVOKE ALL ON FUNCTION public.attendance_day_status(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_day_status(uuid, date) TO authenticated;

-- Gaps in [p_from, min(p_to, today)] at p_branch_id, skipping closed days (they can't be edited):
--  'unmarked'      (only when branches.expect_check_in) a person-day with NO day row, flagged ONCE: by the home branch, unless the person is away
--                  for the whole shift (a temporary transfer covering it), in which case by the visited branch. A partly-away visitor is never
--                  unmarked at the visited branch. Leave / Day Off are rows, so they never show. Today only counts after the shift ends.
--  'open_checkout' an OPEN PUNCH at this branch, once now is past the shift end + open_checkout_hours (per punch; any day, any switch state).
DROP FUNCTION IF EXISTS public.attendance_gaps(uuid, date, date);
CREATE OR REPLACE FUNCTION public.attendance_gaps(p_branch_id uuid, p_from date, p_to date)
RETURNS TABLE(kind text, date date, therapist_id uuid, therapist_name text, shift_start text, shift_end text,
              check_in_time timestamptz, worked_at_branch_id uuid, punch_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tz     constant text := 'Asia/Kathmandu';
  v_today  date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_now    timestamptz := now();
  v_to     date;
  v_org    uuid;
  v_hours  integer;
  v_expect boolean;
  v_close  int;
  d        date;
  t        record;
  pu       record;
  v_home   uuid;
  v_sh     jsonb;
  v_hs     jsonb;
  v_s      int;
  v_e      int;
  v_hs_s   int;
  v_hs_e   int;
  v_whole  boolean;
BEGIN
  IF NOT public._can_manage_branch(p_branch_id) THEN
    RAISE EXCEPTION 'attendance_gaps: not allowed for this branch' USING ERRCODE = '42501';
  END IF;
  IF p_to - p_from > 92 THEN
    RAISE EXCEPTION 'attendance_gaps: range too long (max 93 days)';
  END IF;
  v_to := LEAST(p_to, v_today);
  SELECT b.org_id, b.open_checkout_hours, b.expect_check_in, (EXTRACT(EPOCH FROM b.close_time) / 60)::int
    INTO v_org, v_hours, v_expect, v_close FROM public.branches b WHERE b.id = p_branch_id;

  FOR d IN SELECT g::date FROM generate_series(p_from, v_to, interval '1 day') g LOOP
    IF EXISTS (SELECT 1 FROM public.daily_reports r WHERE r.branch_id = p_branch_id AND r.report_date = d AND r.is_locked) THEN
      CONTINUE;
    END IF;

    IF v_expect THEN
      FOR t IN
        SELECT th.id, th.name::text AS name, public.therapist_home_on(th.id, (d::timestamp AT TIME ZONE v_tz)) AS home
          FROM public.therapists th
         WHERE th.is_active AND th.org_id = v_org
           AND (th.created_at AT TIME ZONE v_tz)::date <= d
           AND (public.therapist_home_on(th.id, (d::timestamp AT TIME ZONE v_tz)) = p_branch_id
                OR public._therapist_visits_branch_on(th.id, p_branch_id, d))
           AND NOT EXISTS (SELECT 1 FROM public.therapist_attendance a WHERE a.therapist_id = th.id AND a.date = d)
         ORDER BY th.name
      LOOP
        v_home := t.home;
        -- the person's HOME shift decides "away for the whole shift" (no home shift = the whole day)
        v_hs := public.therapist_shift_for(t.id, d, v_home);
        v_hs_s := CASE WHEN COALESCE((v_hs ->> 'works')::boolean, false) THEN COALESCE((v_hs ->> 'start_min')::int, 0) ELSE 0 END;
        v_hs_e := CASE WHEN COALESCE((v_hs ->> 'works')::boolean, false) THEN COALESCE((v_hs ->> 'end_min')::int, 1440) ELSE 1440 END;
        v_whole := EXISTS (SELECT 1 FROM public._staff_transfer_windows(ARRAY[t.id]) w
                            WHERE w.from_branch_id = v_home AND w.to_branch_id <> v_home AND NOT w.is_return_leg AND NOT w.is_permanent
                              AND w.ws <= ((d::timestamp + make_interval(mins => v_hs_s)) AT TIME ZONE v_tz)
                              AND w.we >= ((d::timestamp + make_interval(mins => v_hs_e)) AT TIME ZONE v_tz)
                              AND w.to_branch_id = p_branch_id);
        IF t.home = p_branch_id THEN
          -- home branch flags it, unless the person is away for the whole shift (then the visited branch does)
          CONTINUE WHEN EXISTS (SELECT 1 FROM public._staff_transfer_windows(ARRAY[t.id]) w
                                 WHERE w.from_branch_id = v_home AND w.to_branch_id <> v_home AND NOT w.is_return_leg AND NOT w.is_permanent
                                   AND w.ws <= ((d::timestamp + make_interval(mins => v_hs_s)) AT TIME ZONE v_tz)
                                   AND w.we >= ((d::timestamp + make_interval(mins => v_hs_e)) AT TIME ZONE v_tz));
          CONTINUE WHEN NOT COALESCE((v_hs ->> 'works')::boolean, false);
        ELSE
          CONTINUE WHEN NOT v_whole;   -- a partly-away visitor is never unmarked at the visited branch
        END IF;
        v_sh := public.therapist_shift_for(t.id, d, p_branch_id);
        v_s := (v_sh ->> 'start_min')::int;
        v_e := COALESCE((v_sh ->> 'end_min')::int, v_close, 1440);
        IF d < v_today OR v_now >= ((d::timestamp + make_interval(mins => v_e)) AT TIME ZONE v_tz) THEN
          RETURN QUERY SELECT 'unmarked'::text, d, t.id, t.name, v_sh ->> 'start', v_sh ->> 'end', NULL::timestamptz, NULL::uuid, NULL::uuid;
        END IF;
      END LOOP;
    END IF;

    FOR pu IN
      SELECT p.id, p.therapist_id, p.check_in, th.name::text AS name
        FROM public.attendance_punches p JOIN public.therapists th ON th.id = p.therapist_id
       WHERE p.branch_id = p_branch_id AND p.date = d AND p.check_out IS NULL AND p.source <> 'legacy'
       ORDER BY th.name
    LOOP
      v_sh := public.therapist_shift_for(pu.therapist_id, d, p_branch_id);
      v_e := COALESCE((v_sh ->> 'end_min')::int, v_close, 1440);
      IF v_now >= ((d::timestamp + make_interval(mins => v_e)) AT TIME ZONE v_tz) + make_interval(hours => v_hours) THEN
        RETURN QUERY SELECT 'open_checkout'::text, d, pu.therapist_id, pu.name, v_sh ->> 'start', v_sh ->> 'end', pu.check_in, NULL::uuid, pu.id;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.attendance_gaps(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_gaps(uuid, date, date) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('364', 'attendance-redesign-db')
ON CONFLICT (version) DO NOTHING;

-- new / re-signatured RPCs must be callable right away (the schema cache lagged locally after the set_attendance_settings change)
NOTIFY pgrst, 'reload schema';

COMMIT;
