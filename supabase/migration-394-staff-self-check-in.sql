-- migration-394-staff-self-check-in.sql  (ZNLY-236)
--
-- Staff could never check themselves in: punch_in / punch_out required _can_manage_branch / _can_manage_punch, which are manager/admin only
-- (migration 362/364), yet My day offers every staff member a Check in button. Staff may now punch in and out for THEIR OWN linked team member
-- (therapists.user_id), at a branch they belong to, for the current Nepal day, as a live button press only (no backdating, no checkout time,
-- no reason). Managers and admins are unchanged: they still pass the original checks first. Everyone else is refused as before.

BEGIN;

CREATE OR REPLACE FUNCTION public._can_self_punch_in(p_therapist_id uuid, p_branch_id uuid, p_at timestamptz, p_source text, p_reason text, p_out timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT get_user_role() = 'staff'
     AND public.current_therapist_id() IS NOT NULL
     AND p_therapist_id = public.current_therapist_id()
     AND (p_branch_id = ANY (get_user_branch_ids()) OR p_branch_id = get_user_branch_id())
     AND p_source = 'button' AND p_reason IS NULL AND p_out IS NULL
     AND p_at >= now() - interval '10 minutes'
     AND (p_at AT TIME ZONE 'Asia/Kathmandu')::date = (now() AT TIME ZONE 'Asia/Kathmandu')::date;
$$;
REVOKE ALL ON FUNCTION public._can_self_punch_in(uuid, uuid, timestamptz, text, text, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._can_self_punch_out(p_punch_id uuid, p_at timestamptz, p_source text, p_reason text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT get_user_role() = 'staff'
     AND public.current_therapist_id() IS NOT NULL
     AND p_source = 'button' AND p_reason IS NULL
     AND p_at >= now() - interval '10 minutes'
     AND EXISTS (SELECT 1 FROM public.attendance_punches p
                  WHERE p.id = p_punch_id AND p.therapist_id = public.current_therapist_id()
                    AND (p.branch_id = ANY (get_user_branch_ids()) OR p.branch_id = get_user_branch_id())
                    AND p.date = (now() AT TIME ZONE 'Asia/Kathmandu')::date);
$$;
REVOKE ALL ON FUNCTION public._can_self_punch_out(uuid, timestamptz, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.punch_in(p_therapist_id uuid, p_branch_id uuid, p_at timestamp with time zone DEFAULT now(), p_source text DEFAULT 'button'::text, p_reason text DEFAULT NULL::text, p_out timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_date date := (p_at AT TIME ZONE 'Asia/Kathmandu')::date;
  v_day  public.therapist_attendance;
  v_home uuid;
  v_org  uuid;
  v_id   uuid;
BEGIN
  IF p_source NOT IN ('button', 'panel', 'bulk', 'visitor', 'device') THEN RAISE EXCEPTION 'punch_in: bad source %', p_source; END IF;
  IF NOT (public._can_manage_branch(p_branch_id) OR public._can_self_punch_in(p_therapist_id, p_branch_id, p_at, p_source, p_reason, p_out)) THEN
    RAISE EXCEPTION 'punch_in: not allowed for this branch' USING ERRCODE = '42501';
  END IF;
  IF NOT public._can_manage_branch(p_branch_id) THEN PERFORM set_config('zenly.self_punch', '1', true); END IF;   -- a staff self punch: see enforce_attendance_day_lock
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
$function$;

CREATE OR REPLACE FUNCTION public.punch_out(p_punch_id uuid DEFAULT NULL::uuid, p_therapist_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid, p_at timestamp with time zone DEFAULT now(), p_reason text DEFAULT NULL::text, p_source text DEFAULT 'button'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := p_punch_id;
BEGIN
  IF v_id IS NULL THEN
    SELECT p.id INTO v_id FROM public.attendance_punches p
     WHERE p.therapist_id = p_therapist_id AND p.branch_id = p_branch_id AND p.check_out IS NULL ORDER BY p.date DESC LIMIT 1;
  END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'punch_out: no open check-in to close'; END IF;
  IF NOT (public._can_manage_punch(v_id) OR public._can_self_punch_out(v_id, p_at, p_source, p_reason)) THEN RAISE EXCEPTION 'punch_out: not allowed for this punch' USING ERRCODE = '42501'; END IF;
  IF NOT public._can_manage_punch(v_id) THEN PERFORM set_config('zenly.self_punch', '1', true); END IF;
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
$function$;

-- The day close is a MONEY lock: it must not stop a team member checking in or out for TODAY (the till closes ~7 pm, people leave later). The bypass
-- applies only inside a staff self punch (punch_in / punch_out set zenly.self_punch after _can_self_punch_* passed) and only for today's Nepal date.
-- Editing or backdating a closed day (save_punch, bulk, anything else) is still refused, and managers keep their existing path.
CREATE OR REPLACE FUNCTION public.enforce_attendance_day_lock()
 RETURNS trigger
 LANGUAGE plpgsql
AS $fn$
BEGIN
  IF current_setting('zenly.self_punch', true) = '1'
     AND NEW.date = (now() AT TIME ZONE 'Asia/Kathmandu')::date THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM daily_reports
    WHERE branch_id = NEW.branch_id
      AND report_date = NEW.date
      AND is_locked = true
  ) THEN
    RAISE EXCEPTION 'ATTENDANCE_DAY_LOCKED: This day has been closed. Attendance cannot be modified.'
      USING ERRCODE = 'P0004';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.enforce_punch_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  IF COALESCE(current_setting('zenly.self_punch', true), '') <> '1' OR r.date <> v_today   -- a staff self punch for TODAY passes the day close (money lock only)
     THEN IF EXISTS (SELECT 1 FROM public.daily_reports d WHERE d.report_date = r.date AND d.is_locked AND d.branch_id IN (r.branch_id, COALESCE(v_home, r.branch_id))) THEN
    RAISE EXCEPTION 'ATTENDANCE_DAY_LOCKED: This day has been closed. Attendance cannot be modified.' USING ERRCODE = 'P0004';
  END IF; END IF;
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
$function$;

-- My day reads its own punches to know whether to show Check in or Check out; only managers could read them before.
DROP POLICY IF EXISTS "Staff read own attendance punches" ON public.attendance_punches;
CREATE POLICY "Staff read own attendance punches" ON public.attendance_punches FOR SELECT TO authenticated
  USING (therapist_id = (SELECT public.current_therapist_id()));

INSERT INTO public.schema_migrations (version, name) VALUES ('394', 'staff-self-check-in')
ON CONFLICT (version) DO NOTHING;
COMMIT;
