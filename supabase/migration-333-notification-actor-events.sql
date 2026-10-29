-- Migration 333: notification actor + "big discount FYI" + daily attendance-gaps digest (ZNLY-135, V35c)
--
-- 1. notifications.actor_id (FK users, SET NULL): who caused it. The BEFORE INSERT fill trigger (mig 331) sets it to
--    auth.uid() when the producer left it NULL (only if that id is a users row). System/cron/guest producers stay NULL.
--    The client uses it to skip popping a notification for your own action (src/lib/notificationRules.js).
-- 2. discount_big_fyi (category approvals): a STAFF user's direct-applied discount (ends 'approved' with discount_approved_by
--    = that staff user) of >= 15% of base_amount tells the branch managers + org admins, never the actor. Once per booking+amount.
-- 3. attendance_gaps (category team): notify_attendance_gaps() runs daily 21:00 Nepal (15:15 UTC), one row per recipient
--    per branch per day. attendance_gaps() rejects callers without a manager session, which cron is not, so its body moves to
--    _attendance_gaps_core() (no permission check, not exposed) and attendance_gaps() becomes a guarded wrapper.
-- RLS untouched. Idempotent. Applied: stage - / prod -.

BEGIN;

-- 1. Actor ---------------------------------------------------------------------
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.notification_category_for(p_type text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_type IN ('new_online_booking', 'booking_cancelled_by_guest', 'booking_rescheduled_by_guest') THEN 'bookings'
    WHEN p_type IN ('discount', 'discount_request', 'discount_approved', 'discount_declined', 'discount_fyi', 'discount_big_fyi') THEN 'approvals'
    WHEN p_type IN ('transferred_staff_reminder', 'attendance_gap', 'attendance_gaps') THEN 'team'
    WHEN p_type IN ('low_stock') THEN 'stock'
    WHEN p_type IN ('outreach_review_pending', 'renewal_due') THEN 'guests'
    ELSE 'bookings'
  END
$$;

CREATE OR REPLACE FUNCTION public.notifications_fill_defaults()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.category IS NULL THEN
    NEW.category := public.notification_category_for(NEW.type);
  END IF;
  IF NEW.branch_id IS NULL AND NEW.booking_id IS NOT NULL THEN
    SELECT b.branch_id INTO NEW.branch_id FROM public.bookings b WHERE b.id = NEW.booking_id;
  END IF;
  IF NEW.actor_id IS NULL THEN
    SELECT u.id INTO NEW.actor_id FROM public.users u WHERE u.id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notifications_fill_defaults() FROM PUBLIC, anon, authenticated;

-- 2. Big-discount FYI ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_big_discount_fyi()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor  record;
  v_org    uuid;
  v_branch text;
  v_pct    int;
  v_who    text;
  v_title  text;
  v_body   text;
BEGIN
  IF NEW.discount_status IS DISTINCT FROM 'approved' OR NEW.discount_approved_by IS NULL
     OR COALESCE(NEW.discount_amount, 0) <= 0 OR COALESCE(NEW.base_amount, 0) <= 0
     OR NEW.discount_amount < NEW.base_amount * 0.15 THEN
    RETURN NEW;
  END IF;

  SELECT u.id, u.full_name, u.role INTO v_actor FROM public.users u WHERE u.id = NEW.discount_approved_by;
  IF v_actor.id IS NULL OR v_actor.role <> 'staff' THEN
    RETURN NEW;
  END IF;

  SELECT br.org_id, br.name INTO v_org, v_branch FROM public.branches br WHERE br.id = NEW.branch_id;
  IF v_org IS NULL THEN
    RETURN NEW;
  END IF;

  v_pct := round(NEW.discount_amount / NEW.base_amount * 100);
  v_who := NULLIF(regexp_replace(trim(COALESCE(NEW.customer_name, '')), '^(\S+)\s+(\S).*$', '\1 \2.'), '');
  v_title := 'Big discount: ' || v_pct || '%' || COALESCE(' · ' || v_who, '');
  v_body := 'Given by ' || COALESCE(NULLIF(split_part(trim(v_actor.full_name), ' ', 1), ''), 'a team member')
    || ' at ' || COALESCE(v_branch, 'the branch') || ' on ' || COALESCE(NEW.booking_number, 'a booking')
    || ' (NPR ' || trim(to_char(NEW.discount_amount, 'FM999,999,999,990')) || ' off). For your info.';

  -- same booking + same amount already told: saving it again (or re-approving) stays quiet
  IF EXISTS (SELECT 1 FROM public.notifications n
              WHERE n.type = 'discount_big_fyi' AND n.booking_id = NEW.id AND n.body = v_body) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, booking_id, branch_id, actor_id)
  SELECT u.id, 'discount_big_fyi', v_title, v_body, NEW.id, NEW.branch_id, v_actor.id
    FROM public.users u
   WHERE u.org_id = v_org
     AND u.is_active
     AND u.id <> v_actor.id
     AND (
       u.role = 'admin'
       OR (
         u.role = 'manager'
         AND (
           u.branch_id = NEW.branch_id
           OR EXISTS (SELECT 1 FROM public.user_branches ub WHERE ub.user_id = u.id AND ub.branch_id = NEW.branch_id)
         )
       )
     );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification problem fail a discount.
  RAISE WARNING 'notify_big_discount_fyi failed for booking %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_big_discount_fyi() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_big_discount_fyi ON public.bookings;
CREATE TRIGGER trg_notify_big_discount_fyi
  AFTER UPDATE OF discount_amount, discount_status, discount_approved_by ON public.bookings
  FOR EACH ROW
  WHEN (NEW.discount_status = 'approved'
        AND (OLD.discount_amount IS DISTINCT FROM NEW.discount_amount
             OR OLD.discount_status IS DISTINCT FROM NEW.discount_status
             OR OLD.discount_approved_by IS DISTINCT FROM NEW.discount_approved_by))
  EXECUTE FUNCTION public.notify_big_discount_fyi();

-- 3. Attendance gaps -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public._attendance_gaps_core(p_branch_id uuid, p_from date, p_to date)
 RETURNS TABLE(kind text, date date, therapist_id uuid, therapist_name text, shift_start text, shift_end text, check_in_time timestamp with time zone, worked_at_branch_id uuid, punch_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF p_to - p_from > 92 THEN
    RAISE EXCEPTION '_attendance_gaps_core: range too long (max 93 days)';
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
$function$;
REVOKE ALL ON FUNCTION public._attendance_gaps_core(uuid, date, date) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.attendance_gaps(uuid, date, date);
CREATE OR REPLACE FUNCTION public.attendance_gaps(p_branch_id uuid, p_from date, p_to date)
RETURNS TABLE(kind text, date date, therapist_id uuid, therapist_name text, shift_start text, shift_end text,
              check_in_time timestamptz, worked_at_branch_id uuid, punch_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public._can_manage_branch(p_branch_id) THEN
    RAISE EXCEPTION 'attendance_gaps: not allowed for this branch' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public._attendance_gaps_core(p_branch_id, p_from, p_to);
END;
$$;
REVOKE ALL ON FUNCTION public.attendance_gaps(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_gaps(uuid, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_attendance_gaps()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_count int := 0;
  v_n     int;
  br      record;
  v_cnt   int;
  v_names text;
  v_title text;
  v_body  text;
BEGIN
  FOR br IN SELECT b.id, b.org_id, b.name FROM public.branches b WHERE b.is_active LOOP
    SELECT count(*), string_agg(g.therapist_name, ', ' ORDER BY g.therapist_name) FILTER (WHERE g.rn <= 3)
      INTO v_cnt, v_names
      FROM (SELECT x.therapist_name, row_number() OVER (ORDER BY x.therapist_name) AS rn
              FROM public._attendance_gaps_core(br.id, v_today, v_today) x) g;
    CONTINUE WHEN v_cnt = 0;

    v_title := v_cnt || ' attendance gap' || CASE WHEN v_cnt = 1 THEN '' ELSE 's' END || ' today · ' || br.name;
    v_body := v_names || CASE WHEN v_cnt > 3 THEN ' and ' || (v_cnt - 3) || ' more' ELSE '' END;

    INSERT INTO public.notifications (user_id, type, title, body, branch_id)
    SELECT u.id, 'attendance_gaps', v_title, v_body, br.id
      FROM public.users u
     WHERE u.org_id = br.org_id
       AND u.is_active
       AND (
         u.role = 'admin'
         OR (
           u.role = 'manager'
           AND (
             u.branch_id = br.id
             OR EXISTS (SELECT 1 FROM public.user_branches ub WHERE ub.user_id = u.id AND ub.branch_id = br.id)
           )
         )
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.notifications n
          WHERE n.user_id = u.id AND n.type = 'attendance_gaps' AND n.branch_id = br.id
            AND (n.created_at AT TIME ZONE 'Asia/Kathmandu')::date = v_today
       );
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_count := v_count + v_n;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_attendance_gaps() FROM PUBLIC, anon, authenticated;

-- 21:00 Nepal (UTC+5:45) = 15:15 UTC
DO $$
BEGIN
  PERFORM cron.unschedule('notify-attendance-gaps') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-attendance-gaps');
  PERFORM cron.schedule('notify-attendance-gaps', '15 15 * * *', 'SELECT public.notify_attendance_gaps()');
END $$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('333', 'notification-actor-events')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
