-- Migration 353: the staff-availability rule in the guard (ZNLY-100, V29a)
-- check_therapist_booking_guards is extended with the range/booking end, the booking id (overlap exclusion + audit),
-- the manager/admin override reason and a skip flag. With organizations.enforce_staff_availability = false only
-- today's checks run (allowlist, absent, checked-out). With it on, therapist_unavailable_ranges (351) is applied and
-- a violation raises  '<CODE>: message'  with ERRCODE PT409 (PostgREST turns PT### into HTTP ###, 409 here, 403 for
-- OVERRIDE_NOT_ALLOWED, and returns message + details as JSON; a plain P0006 reaches the browser as a generic 500) and DETAIL = JSON {code, reason, therapist_id,
-- therapist_name, date, start, end, range_start, range_end, label}.
-- Codes: ON_LEAVE, OVERLAP (never overridable) | OTHER_BRANCH, BLOCKED, ON_BREAK, OFF_SHIFT (overridable).
-- Override: bookings.availability_override_reason, honoured only if newly set in this INSERT/UPDATE (compared with OLD,
-- so a stale reason never carries over) AND the caller is manager/admin (else OVERRIDE_NOT_ALLOWED). Each skipped
-- code writes an audit_logs row (action_type AVAILABILITY_OVERRIDE). booking_therapists and booking_combo_items have
-- their own availability_override_reason column with the same rules (newly set, manager/admin only, audited).
-- A junction row that merely mirrors the booking's own therapist/time (sync trigger) is not re-checked: the bookings
-- trigger already checked it.
-- Triggers: bookings fire on therapist_id/date/start_time/end_time/branch_id changes (a no-op re-save never re-checks,
-- so status/payment/notes/discount updates never fail); booking_therapists on INSERT + UPDATE; combo items new.
-- Admin correction (app.admin_correction + admin) skips only the new availability checks; it is already logged by
-- admin_correct_booking (ADMIN_CORRECTION audit row).
-- Reversible (manual): restore the migration-258 function bodies and the old triggers.
BEGIN;

-- Companion therapists and combo items carry their own override reason (each can be written in a separate request).
ALTER TABLE public.booking_therapists   ADD COLUMN IF NOT EXISTS availability_override_reason text;
ALTER TABLE public.booking_combo_items  ADD COLUMN IF NOT EXISTS availability_override_reason text;

DROP FUNCTION IF EXISTS public.check_therapist_booking_guards(uuid, uuid, date, timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.check_therapist_booking_guards(
  p_therapist_id uuid, p_service_id uuid, p_date date, p_start_datetime timestamptz, p_branch_id uuid,
  p_end_datetime timestamptz DEFAULT NULL, p_booking_id uuid DEFAULT NULL,
  p_override_reason text DEFAULT NULL, p_skip_availability boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_therapist_name text;
  v_service_name   text;
  v_has_allowlist  boolean;
  v_on_allowlist   boolean;
  v_attendance     record;
  v_enforce        boolean := false;
  v_day0           timestamptz := (p_date::timestamp AT TIME ZONE 'Asia/Kathmandu');
  v_s              int;
  v_e              int;
  v_reason         text := btrim(COALESCE(p_override_reason, ''));
  v_role           user_role;
  r                record;
  v_msg            text;
  v_detail         jsonb;
BEGIN
  SELECT name INTO v_therapist_name FROM public.therapists WHERE id = p_therapist_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'THERAPIST_NOT_FOUND: therapist % does not exist.', p_therapist_id
      USING ERRCODE = 'P0006';
  END IF;

  SELECT name INTO v_service_name FROM public.services WHERE id = p_service_id;

  -- Branch-scoped by the booking's own branch (p_branch_id), matching
  -- public_get_bookable_therapists -- not the therapist's live branch, which can
  -- legitimately differ from the booking's branch during a staff_transfers window.
  SELECT EXISTS(
    SELECT 1
    FROM public.service_therapists st
    JOIN public.therapists st_t ON st_t.id = st.therapist_id
    WHERE st.service_id = p_service_id AND st_t.branch_id = p_branch_id
  ) INTO v_has_allowlist;
  IF v_has_allowlist THEN
    SELECT EXISTS(
      SELECT 1 FROM public.service_therapists
      WHERE service_id = p_service_id AND therapist_id = p_therapist_id
    ) INTO v_on_allowlist;

    IF NOT v_on_allowlist THEN
      RAISE EXCEPTION 'THERAPIST_NOT_ELIGIBLE: % is not on the eligible staff list for %. Update the service''s eligible staff in Service Management to allow this.',
        COALESCE(v_therapist_name, 'This therapist'), COALESCE(v_service_name, 'this service')
        USING ERRCODE = 'P0006';
    END IF;
  END IF;

  -- ---- availability rule (per-tenant switch)
  IF NOT p_skip_availability THEN
    SELECT o.enforce_staff_availability INTO v_enforce
      FROM public.branches br JOIN public.organizations o ON o.id = br.org_id WHERE br.id = p_branch_id;
  END IF;

  IF COALESCE(v_enforce, false) THEN
    v_s := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (p_start_datetime - v_day0)) / 60)::int);
    v_e := LEAST(1440, CEIL(EXTRACT(EPOCH FROM (COALESCE(p_end_datetime, p_start_datetime + interval '1 minute') - v_day0)) / 60)::int);
    IF v_e <= v_s THEN v_e := v_s + 1; END IF;

    FOR r IN
      SELECT x.* FROM (
        SELECT DISTINCT ON (u.code) u.*,
               CASE u.code WHEN 'ON_LEAVE' THEN 1 WHEN 'OVERLAP' THEN 2 WHEN 'OTHER_BRANCH' THEN 3
                           WHEN 'BLOCKED' THEN 4 WHEN 'ON_BREAK' THEN 5 ELSE 6 END AS prio
          FROM public.therapist_unavailable_ranges(p_therapist_id, p_date, p_branch_id, p_booking_id) u
         WHERE u.start_min < v_e AND u.end_min > v_s
         ORDER BY u.code, u.start_min
      ) x ORDER BY x.prio
    LOOP
      v_msg := CASE r.code
        WHEN 'ON_LEAVE' THEN COALESCE(v_therapist_name, 'This staff member') ||
             CASE r.reason WHEN 'leave_half' THEN ' is off ' || public.minutes_to_hhmm(r.start_min) || '–' || public.minutes_to_hhmm(r.end_min)
                           ELSE ' is on leave on this date' END
        WHEN 'OVERLAP' THEN COALESCE(v_therapist_name, 'This staff member') || ' already has a booking ' ||
             public.minutes_to_hhmm(r.start_min) || '–' || public.minutes_to_hhmm(r.end_min)
        WHEN 'OTHER_BRANCH' THEN COALESCE(v_therapist_name, 'This staff member') || ' is at ' || COALESCE(r.label, 'another branch') || ' at this time'
        WHEN 'BLOCKED' THEN COALESCE(v_therapist_name, 'This staff member') || ' is blocked ' ||
             public.minutes_to_hhmm(r.start_min) || '–' || public.minutes_to_hhmm(r.end_min) ||
             CASE WHEN r.label IS NULL OR r.label = '' THEN '' ELSE ' (' || r.label || ')' END
        WHEN 'ON_BREAK' THEN COALESCE(v_therapist_name, 'This staff member') || ' is on a break ' ||
             public.minutes_to_hhmm(r.start_min) || '–' || public.minutes_to_hhmm(r.end_min)
        ELSE COALESCE(v_therapist_name, 'This staff member') ||
             CASE r.reason WHEN 'before_shift' THEN ' is off until ' || public.minutes_to_hhmm(r.end_min)
                           WHEN 'after_shift' THEN '''s shift ends at ' || public.minutes_to_hhmm(r.start_min)
                           ELSE ' is not working on this date' END
      END;
      v_detail := jsonb_build_object('code', r.code, 'reason', r.reason, 'therapist_id', p_therapist_id,
        'therapist_name', v_therapist_name, 'date', p_date,
        'start', public.minutes_to_hhmm(v_s), 'end', public.minutes_to_hhmm(v_e),
        'range_start', public.minutes_to_hhmm(r.start_min), 'range_end', public.minutes_to_hhmm(r.end_min), 'label', r.label);

      IF r.code IN ('ON_LEAVE', 'OVERLAP') OR v_reason = '' THEN
        RAISE EXCEPTION '%: %', r.code, v_msg USING ERRCODE = 'PT409', DETAIL = v_detail::text;
      END IF;

      -- overridable code with a reason supplied: managers/admins only
      v_role := public.get_user_role();
      IF v_role IS DISTINCT FROM 'manager'::user_role AND v_role IS DISTINCT FROM 'admin'::user_role THEN
        RAISE EXCEPTION 'OVERRIDE_NOT_ALLOWED: Only a manager or admin can book outside a staff member''s availability.'
          USING ERRCODE = 'PT403', DETAIL = v_detail::text;
      END IF;
      INSERT INTO public.audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by, reason)
      SELECT p_branch_id, 'bookings', p_booking_id, 'AVAILABILITY_OVERRIDE', NULL,
             v_detail || jsonb_build_object('message', v_msg, 'override_reason', v_reason), auth.uid(), v_reason
       WHERE p_booking_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.audit_logs a
                          WHERE a.record_id = p_booking_id AND a.action_type = 'AVAILABILITY_OVERRIDE'
                            AND a.new_data->>'code' = r.code AND a.new_data->>'therapist_id' = p_therapist_id::text
                            AND a.new_data->>'start' = v_detail->>'start' AND a.changed_at = now());
    END LOOP;
  END IF;

  SELECT status, check_out_time INTO v_attendance
  FROM public.therapist_attendance
  WHERE therapist_id = p_therapist_id AND date = p_date;

  IF v_attendance.status IS NOT NULL AND v_attendance.status::text IN ('Absent', 'Leave', 'Annual Leave', 'Sick Leave', 'Day Off') THEN
    RAISE EXCEPTION 'THERAPIST_ABSENT: % is marked as % on this date.',
      COALESCE(v_therapist_name, 'This therapist'), v_attendance.status
      USING ERRCODE = 'P0006';
  END IF;

  IF v_attendance.check_out_time IS NOT NULL AND p_start_datetime >= v_attendance.check_out_time THEN
    RAISE EXCEPTION 'THERAPIST_CHECKED_OUT: % already checked out for this date.',
      COALESCE(v_therapist_name, 'This therapist')
      USING ERRCODE = 'P0006';
  END IF;
END;
$$;

-- bookings ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_booking_therapist_guards()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_reason_new boolean;
  v_role       user_role;
  v_admin_corr boolean := COALESCE(current_setting('app.admin_correction', true) = 'on'
                          AND get_user_role() IS NOT DISTINCT FROM 'admin'::user_role, false);
BEGIN
  v_reason_new := btrim(COALESCE(NEW.availability_override_reason, '')) <> ''
                  AND (TG_OP = 'INSERT' OR NEW.availability_override_reason IS DISTINCT FROM OLD.availability_override_reason);

  IF v_reason_new THEN
    v_role := get_user_role();
    IF v_role IS DISTINCT FROM 'manager'::user_role AND v_role IS DISTINCT FROM 'admin'::user_role THEN
      RAISE EXCEPTION 'OVERRIDE_NOT_ALLOWED: Only a manager or admin can book outside a staff member''s availability.'
        USING ERRCODE = 'PT403';
    END IF;
  END IF;

  IF NEW.therapist_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.therapist_id IS NOT DISTINCT FROM OLD.therapist_id
     AND NEW.date IS NOT DISTINCT FROM OLD.date
     AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time
     AND NEW.end_time IS NOT DISTINCT FROM OLD.end_time
     AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id THEN
    RETURN NEW;  -- nothing that affects availability changed (status, payment, notes, discount, ...)
  END IF;

  -- date + start/end_time, not start/end_datetime: a resize that only sets end_time leaves end_datetime stale
  PERFORM public.check_therapist_booking_guards(NEW.therapist_id, NEW.service_id, NEW.date,
    (NEW.date + NEW.start_time) AT TIME ZONE 'Asia/Kathmandu', NEW.branch_id,
    (NEW.date + NEW.end_time) AT TIME ZONE 'Asia/Kathmandu', NEW.id,
    CASE WHEN v_reason_new THEN NEW.availability_override_reason END,
    v_admin_corr OR NEW.status IN ('Cancelled', 'No Show'));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_therapist_guards_check ON public.bookings;
CREATE TRIGGER trg_therapist_guards_check
  BEFORE INSERT OR UPDATE OF therapist_id, date, start_time, end_time, branch_id, availability_override_reason ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_therapist_guards();

-- companion therapists (junction) ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_booking_therapist_junction_guards()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_booking    record;
  v_start      timestamptz;
  v_end        timestamptz;
  v_reason_new boolean;
  v_role       user_role;
BEGIN
  IF current_setting('app.admin_correction', true) = 'on'
     AND get_user_role() IS NOT DISTINCT FROM 'admin'::user_role THEN
    RETURN NEW;
  END IF;

  v_reason_new := btrim(COALESCE(NEW.availability_override_reason, '')) <> ''
                  AND (TG_OP = 'INSERT' OR NEW.availability_override_reason IS DISTINCT FROM OLD.availability_override_reason);
  IF v_reason_new THEN
    v_role := get_user_role();
    IF v_role IS DISTINCT FROM 'manager'::user_role AND v_role IS DISTINCT FROM 'admin'::user_role THEN
      RAISE EXCEPTION 'OVERRIDE_NOT_ALLOWED: Only a manager or admin can book outside a staff member''s availability.'
        USING ERRCODE = 'PT403';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.booking_id IS NOT DISTINCT FROM OLD.booking_id
     AND NEW.therapist_id IS NOT DISTINCT FROM OLD.therapist_id
     AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time
     AND NEW.end_time IS NOT DISTINCT FROM OLD.end_time THEN
    RETURN NEW;
  END IF;

  SELECT service_id, therapist_id, date, start_time, end_time, start_datetime, end_datetime, branch_id, status
    INTO v_booking FROM public.bookings WHERE id = NEW.booking_id;

  IF v_booking IS NULL THEN
    RETURN NEW;
  END IF;

  -- mirror row of the booking's own therapist/time (made by sync_booking_therapists_from_booking): already checked
  IF NEW.therapist_id IS NOT DISTINCT FROM v_booking.therapist_id
     AND COALESCE(NEW.start_time, v_booking.start_time) = v_booking.start_time
     AND COALESCE(NEW.end_time, v_booking.end_time) = v_booking.end_time THEN
    RETURN NEW;
  END IF;

  v_start := (v_booking.date + COALESCE(NEW.start_time, v_booking.start_time)) AT TIME ZONE 'Asia/Kathmandu';
  v_end   := (v_booking.date + COALESCE(NEW.end_time, v_booking.end_time)) AT TIME ZONE 'Asia/Kathmandu';

  PERFORM public.check_therapist_booking_guards(NEW.therapist_id, v_booking.service_id, v_booking.date, v_start, v_booking.branch_id,
    v_end, NEW.booking_id, CASE WHEN v_reason_new THEN NEW.availability_override_reason END,
    v_booking.status IN ('Cancelled', 'No Show'));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_therapists_guards_check ON public.booking_therapists;
CREATE TRIGGER trg_booking_therapists_guards_check
  BEFORE INSERT OR UPDATE OF booking_id, therapist_id, start_time, end_time, availability_override_reason ON public.booking_therapists
  FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_therapist_junction_guards();

-- combo items -----------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_combo_item_availability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_booking    record;
  v_reason_new boolean;
  v_role       user_role;
BEGIN
  IF current_setting('app.admin_correction', true) = 'on'
     AND get_user_role() IS NOT DISTINCT FROM 'admin'::user_role THEN
    RETURN NEW;
  END IF;

  v_reason_new := btrim(COALESCE(NEW.availability_override_reason, '')) <> ''
                  AND (TG_OP = 'INSERT' OR NEW.availability_override_reason IS DISTINCT FROM OLD.availability_override_reason);
  IF v_reason_new THEN
    v_role := get_user_role();
    IF v_role IS DISTINCT FROM 'manager'::user_role AND v_role IS DISTINCT FROM 'admin'::user_role THEN
      RAISE EXCEPTION 'OVERRIDE_NOT_ALLOWED: Only a manager or admin can book outside a staff member''s availability.'
        USING ERRCODE = 'PT403';
    END IF;
  END IF;

  IF NEW.therapist_id IS NULL OR NEW.start_datetime IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.therapist_id IS NOT DISTINCT FROM OLD.therapist_id
     AND NEW.start_datetime IS NOT DISTINCT FROM OLD.start_datetime
     AND NEW.end_datetime IS NOT DISTINCT FROM OLD.end_datetime THEN
    RETURN NEW;
  END IF;

  SELECT branch_id, status INTO v_booking FROM public.bookings WHERE id = NEW.booking_id;
  IF v_booking IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.check_therapist_booking_guards(NEW.therapist_id, NEW.service_id, NEW.date, NEW.start_datetime, v_booking.branch_id,
    NEW.end_datetime, NEW.booking_id, CASE WHEN v_reason_new THEN NEW.availability_override_reason END,
    v_booking.status IN ('Cancelled', 'No Show'));
  RETURN NEW;
END;
$$;

-- Named to sort right after trg_0_compute_combo_item_datetimes and before the older THERAPIST_CONFLICT trigger, so the
-- stable OVERLAP code wins when the tenant switch is on.
DROP TRIGGER IF EXISTS trg_combo_item_availability_check ON public.booking_combo_items;
DROP TRIGGER IF EXISTS trg_0_d_combo_item_availability_check ON public.booking_combo_items;
CREATE TRIGGER trg_0_d_combo_item_availability_check
  BEFORE INSERT OR UPDATE OF therapist_id, date, start_time, end_time, start_datetime, end_datetime, availability_override_reason ON public.booking_combo_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_combo_item_availability();

INSERT INTO public.schema_migrations (version, name)
VALUES ('353', 'availability-guard')
ON CONFLICT (version) DO NOTHING;

COMMIT;
