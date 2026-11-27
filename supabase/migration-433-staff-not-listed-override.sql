-- Migration 433 (ZNLY-406 + ZNLY-418): a person who is NOT on a service's staff list can still be booked by a manager/admin, with a reason.
--
-- Rule (all tenants, by data): a service with no staff-list rows for the booking's branch = everyone can do it. With rows only listed staff do it;
-- a transferred-in visitor is judged on their home branch's list (unchanged). New: check_therapist_booking_guards no longer hard-refuses
-- THERAPIST_NOT_ELIGIBLE when p_override_reason is non-empty AND the caller is a manager/admin. The override is logged in audit_logs exactly like the
-- availability override (action_type AVAILABILITY_OVERRIDE, new_data.code = 'THERAPIST_NOT_ELIGIBLE', who + reason + staff + service).
--   * no reason            -> refused as before: code THERAPIST_NOT_ELIGIBLE, SQLSTATE P0006 (online booking flow unchanged), message is now a plain sentence + DETAIL json
--   * reason, staff role   -> OVERRIDE_NOT_ALLOWED (PT403), plain message
--   * reason, manager/admin-> allowed + audit row
-- _visit_classify (mig 430) marks THERAPIST_NOT_ELIGIBLE overridable so the visit_* functions ask for the reason too.
-- No signature change. Idempotent (CREATE OR REPLACE). Reversible: CREATE OR REPLACE both functions back to migration 361 / 430 bodies.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.check_therapist_booking_guards(p_therapist_id uuid, p_service_id uuid, p_date date, p_start_datetime timestamp with time zone, p_branch_id uuid, p_end_datetime timestamp with time zone DEFAULT NULL::timestamp with time zone, p_booking_id uuid DEFAULT NULL::uuid, p_override_reason text DEFAULT NULL::text, p_skip_availability boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_therapist_name text;
  v_service_name   text;
  v_has_allowlist  boolean;
  v_visitor        boolean;
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
  v_ne_msg         text;   -- ZNLY-418: set when the person is not on the service's staff list
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
  -- ZNLY-113: a lent therapist at the receiving branch (open window at the booking start) is judged on their HOME
  -- allow-list, matched by service name. Everyone else: the booking branch's allow-list, as before.
  v_visitor := p_branch_id IS DISTINCT FROM (SELECT t.branch_id FROM public.therapists t WHERE t.id = p_therapist_id)
               AND public._therapist_open_window_branch(p_therapist_id, p_start_datetime) = p_branch_id;
  IF v_visitor THEN
    IF p_service_id IS NOT NULL AND NOT public._visitor_service_ok(p_therapist_id, p_service_id) THEN
      v_ne_msg := format('%s does not do %s at their home branch, so cannot cover it here.',
        COALESCE(v_therapist_name, 'This therapist'), COALESCE(v_service_name, 'this service'));
    END IF;
  ELSE
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
        v_ne_msg := format('%s is not on the staff list for %s.', COALESCE(v_therapist_name, 'This therapist'), COALESCE(v_service_name, 'this service'));
      END IF;
    END IF;
  END IF;

  -- ZNLY-418: not on the service's staff list. No reason -> refused exactly as before (same code and SQLSTATE, so the online flow is unchanged).
  -- With a reason: managers/admins may book anyway and it is logged (same audit row as the availability override, distinct code); staff may not.
  IF v_ne_msg IS NOT NULL THEN
    v_detail := jsonb_build_object('code', 'THERAPIST_NOT_ELIGIBLE', 'not_listed', true, 'visitor', v_visitor,
      'therapist_id', p_therapist_id, 'therapist_name', v_therapist_name,
      'service_id', p_service_id, 'service_name', v_service_name, 'date', p_date);
    IF v_reason = '' THEN
      RAISE EXCEPTION 'THERAPIST_NOT_ELIGIBLE: %', v_ne_msg USING ERRCODE = 'P0006', DETAIL = v_detail::text;
    END IF;
    v_role := public.get_user_role();
    IF v_role IS DISTINCT FROM 'manager'::user_role AND v_role IS DISTINCT FROM 'admin'::user_role THEN
      RAISE EXCEPTION 'OVERRIDE_NOT_ALLOWED: Only a manager or admin can book someone who is not on the service''s staff list.'
        USING ERRCODE = 'PT403', DETAIL = v_detail::text;
    END IF;
    INSERT INTO public.audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by, reason)
    SELECT p_branch_id, 'bookings', p_booking_id, 'AVAILABILITY_OVERRIDE', NULL,
           v_detail || jsonb_build_object('message', v_ne_msg, 'override_reason', v_reason), auth.uid(), v_reason
     WHERE p_booking_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.audit_logs a
                        WHERE a.record_id = p_booking_id AND a.action_type = 'AVAILABILITY_OVERRIDE'
                          AND a.new_data->>'code' = 'THERAPIST_NOT_ELIGIBLE' AND a.new_data->>'therapist_id' = p_therapist_id::text
                          AND a.changed_at = now());
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
$function$;

CREATE OR REPLACE FUNCTION public._visit_classify(p_state text, p_msg text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
DECLARE
  v_code text := substring(p_msg from '^([A-Z][A-Z0-9_]{2,}):');
  v_text text;
  v_role user_role := public.get_user_role();
BEGIN
  IF v_code IS NOT NULL THEN
    v_text := btrim(regexp_replace(p_msg, '^[A-Z][A-Z0-9_]*:\s*', ''));
    RETURN jsonb_build_object('code', v_code, 'message', v_text,
      'overridable', ((p_state = 'PT409' AND v_code IN ('OFF_SHIFT','ON_BREAK','BLOCKED','OTHER_BRANCH'))
                      OR v_code = 'THERAPIST_NOT_ELIGIBLE')   -- ZNLY-418 (raised as P0006 when no reason was given)
                     AND v_role IN ('manager','admin'));
  END IF;
  IF p_state = '23P01' THEN
    RETURN jsonb_build_object('code', 'THERAPIST_CONFLICT', 'message', 'That staff member is already booked during this time.', 'overridable', false);
  END IF;
  IF p_state = 'P0003' THEN
    RETURN jsonb_build_object('code', 'SCHEDULING_CONFLICT', 'message', 'This time conflicts with an existing booking.', 'overridable', false);
  END IF;
  -- "function_name: plain sentence" refusals written by our own functions
  IF p_msg ~ '^[a-z_]+: ' THEN
    RETURN jsonb_build_object('code', 'REFUSED', 'message', btrim(regexp_replace(p_msg, '^[a-z_]+:\s*', '')), 'overridable', false);
  END IF;
  RETURN jsonb_build_object('code', 'SAVE_FAILED', 'message', 'This change could not be saved. Nothing was changed.', 'overridable', false);
END $$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('433', 'staff-not-listed-override')
ON CONFLICT (version) DO NOTHING;

COMMIT;
