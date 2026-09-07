-- Incident fix: managers with a multi-branch grant (public.user_branches) were rejected by
-- transfer_therapist / cancel_scheduled_transfer / extend_staff_transfer because those 4
-- SECURITY DEFINER functions only checked the caller's single primary branch
-- (get_user_branch_id()), never the grants table the branch-switcher already reads.
-- Widen each manager permission check to also allow a matching row in user_branches.
-- No signature changes; extend_staff_transfer's destination-branch check is intentionally
-- left semantically as-is (widened the same way, but still checks to_branch_id, not from).

CREATE OR REPLACE FUNCTION public.transfer_therapist(p_therapist_id uuid, p_to_branch_id uuid, p_start_time time without time zone, p_duration_value integer, p_duration_unit text, p_note text DEFAULT NULL::text, p_effective_date date DEFAULT NULL::date, p_permanent boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role              user_role;
  v_caller_org        uuid;
  v_caller_branch     uuid;
  v_from_branch       uuid;
  v_from_display_order int;
  v_therapist_org     uuid;
  v_to_branch_org     uuid;
  v_new_order         int;
  v_transfer_id       uuid;
  v_now               timestamp;
  v_today             date;
  v_effective         date;
  v_start_ts          timestamp;
  v_revert_at         timestamptz;
  v_immediate         boolean;
BEGIN
  IF NOT p_permanent THEN
    IF p_duration_value IS NULL OR p_duration_value <= 0 THEN
      RAISE EXCEPTION 'transfer_therapist: duration value must be a positive number';
    END IF;

    IF p_duration_unit IS NULL OR p_duration_unit NOT IN ('minute','hour','day','week','month') THEN
      RAISE EXCEPTION 'transfer_therapist: duration unit must be one of minute, hour, day, week, month';
    END IF;

    IF p_start_time IS NULL THEN
      RAISE EXCEPTION 'transfer_therapist: start time is required';
    END IF;
  END IF;

  v_role          := get_user_role();
  v_caller_org    := get_user_org_id();
  v_caller_branch := get_user_branch_id();
  v_now           := now() AT TIME ZONE 'Asia/Kathmandu';
  v_today         := v_now::date;
  v_effective     := COALESCE(p_effective_date, v_today);
  v_start_ts      := (v_effective::text || ' ' || COALESCE(p_start_time, '00:00:00'::time)::text)::timestamp;

  -- Serialize every transfer_therapist() call for THIS therapist. Released
  -- automatically at transaction end (commit or rollback) — never held past this
  -- call, so it can't deadlock or strand a lock across requests.
  PERFORM pg_advisory_xact_lock(hashtext('staff_transfer:' || p_therapist_id::text)::bigint);

  SELECT branch_id, org_id, display_order INTO v_from_branch, v_therapist_org, v_from_display_order
  FROM public.therapists
  WHERE id = p_therapist_id;

  IF v_from_branch IS NULL THEN
    RAISE EXCEPTION 'transfer_therapist: therapist % not found', p_therapist_id;
  END IF;

  IF v_therapist_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'transfer_therapist: therapist is not in your organization';
  END IF;

  SELECT org_id INTO v_to_branch_org
  FROM public.branches
  WHERE id = p_to_branch_id;

  IF v_to_branch_org IS NULL THEN
    RAISE EXCEPTION 'transfer_therapist: destination branch % not found', p_to_branch_id;
  END IF;

  IF v_to_branch_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'transfer_therapist: destination branch is not in your organization';
  END IF;

  IF p_to_branch_id = v_from_branch THEN
    RAISE EXCEPTION 'transfer_therapist: staffer is already at that branch';
  END IF;

  IF NOT (
    v_role = 'admin'
    OR (v_role = 'manager' AND (
      v_from_branch = v_caller_branch
      OR EXISTS (SELECT 1 FROM public.user_branches WHERE user_id = auth.uid() AND branch_id = v_from_branch)
    ))
  ) THEN
    RAISE EXCEPTION 'transfer_therapist: only an admin or the current branch''s manager may transfer this staffer';
  END IF;

  -- Fast-path, friendly-message pre-check (kept from migration-150). The nested
  -- INSERT below is the real safety net for the concurrent case: two callers can
  -- both pass this SELECT before either commits, but only one INSERT can win
  -- against idx_staff_transfers_one_active_per_therapist — the loser hits the
  -- EXCEPTION block instead of a raw unique_violation.
  IF EXISTS (
    SELECT 1 FROM public.staff_transfers
    WHERE therapist_id = p_therapist_id
      AND (applied = false OR (applied = true AND revert_at IS NOT NULL AND reverted = false))
  ) THEN
    RAISE EXCEPTION 'transfer_therapist: a transfer is already pending or in progress for this staffer; cancel or wait for it first';
  END IF;

  v_immediate := v_start_ts <= v_now;
  v_revert_at := CASE WHEN p_permanent THEN NULL
    ELSE (v_start_ts + (p_duration_value || ' ' || p_duration_unit || 's')::interval) AT TIME ZONE 'Asia/Kathmandu'
  END;

  IF v_immediate THEN
    SELECT COALESCE(max(display_order), -1) + 1 INTO v_new_order
    FROM public.therapists
    WHERE branch_id = p_to_branch_id;

    UPDATE public.therapists
       SET branch_id = p_to_branch_id,
           display_order = v_new_order
     WHERE id = p_therapist_id;

    -- migration-048: keep the staff user's login branch in sync (staff role only).
    PERFORM public._sync_user_branch_for_transfer(p_therapist_id, v_caller_org, p_to_branch_id);
  END IF;

  BEGIN
    INSERT INTO public.staff_transfers
      (therapist_id, org_id, from_branch_id, to_branch_id, transferred_by, note, effective_date,
       applied, start_time, duration_value, duration_unit, revert_at, from_display_order, is_permanent)
    VALUES
      (p_therapist_id, v_caller_org, v_from_branch, p_to_branch_id, auth.uid(), p_note, v_effective,
       v_immediate, p_start_time, p_duration_value, p_duration_unit, v_revert_at, v_from_display_order, p_permanent)
    RETURNING id INTO v_transfer_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'transfer_therapist: a transfer is already pending or in progress for this staffer; cancel or wait for it first';
  END;

  RETURN v_transfer_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_therapist(p_therapist_id uuid, p_to_branch_id uuid, p_note text DEFAULT NULL::text, p_effective_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role          user_role;
  v_caller_org    uuid;
  v_caller_branch uuid;
  v_from_branch   uuid;
  v_therapist_org uuid;
  v_to_branch_org uuid;
  v_new_order     int;
  v_transfer_id   uuid;
  v_today         date;
  v_effective     date;
  v_immediate     boolean;
BEGIN
  v_role          := get_user_role();
  v_caller_org    := get_user_org_id();
  v_caller_branch := get_user_branch_id();
  v_today         := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_effective     := COALESCE(p_effective_date, v_today);

  SELECT branch_id, org_id INTO v_from_branch, v_therapist_org
  FROM public.therapists
  WHERE id = p_therapist_id;

  IF v_from_branch IS NULL THEN
    RAISE EXCEPTION 'transfer_therapist: therapist % not found', p_therapist_id;
  END IF;

  IF v_therapist_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'transfer_therapist: therapist is not in your organization';
  END IF;

  SELECT org_id INTO v_to_branch_org
  FROM public.branches
  WHERE id = p_to_branch_id;

  IF v_to_branch_org IS NULL THEN
    RAISE EXCEPTION 'transfer_therapist: destination branch % not found', p_to_branch_id;
  END IF;

  IF v_to_branch_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'transfer_therapist: destination branch is not in your organization';
  END IF;

  IF p_to_branch_id = v_from_branch THEN
    RAISE EXCEPTION 'transfer_therapist: staffer is already at that branch';
  END IF;

  IF NOT (
    v_role = 'admin'
    OR (v_role = 'manager' AND (
      v_from_branch = v_caller_branch
      OR EXISTS (SELECT 1 FROM public.user_branches WHERE user_id = auth.uid() AND branch_id = v_from_branch)
    ))
  ) THEN
    RAISE EXCEPTION 'transfer_therapist: only an admin or the current branch''s manager may transfer this staffer';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staff_transfers
    WHERE therapist_id = p_therapist_id AND applied = false
  ) THEN
    RAISE EXCEPTION 'transfer_therapist: a scheduled transfer already exists for this staffer; cancel it first';
  END IF;

  v_immediate := v_effective <= v_today;

  IF v_immediate THEN
    SELECT COALESCE(max(display_order), -1) + 1 INTO v_new_order
    FROM public.therapists
    WHERE branch_id = p_to_branch_id;

    UPDATE public.therapists
       SET branch_id = p_to_branch_id,
           display_order = v_new_order
     WHERE id = p_therapist_id;

    -- migration-048: keep the staff user's login branch in sync (staff role only).
    PERFORM public._sync_user_branch_for_transfer(p_therapist_id, v_caller_org, p_to_branch_id);
  END IF;

  INSERT INTO public.staff_transfers
    (therapist_id, org_id, from_branch_id, to_branch_id, transferred_by, note, effective_date, applied)
  VALUES
    (p_therapist_id, v_caller_org, v_from_branch, p_to_branch_id, auth.uid(), p_note, v_effective, v_immediate)
  RETURNING id INTO v_transfer_id;

  RETURN v_transfer_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_scheduled_transfer(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role          user_role := get_user_role();
  v_caller_org    uuid := get_user_org_id();
  v_caller_branch uuid := get_user_branch_id();
  v_rec           record;
BEGIN
  SELECT * INTO v_rec FROM public.staff_transfers WHERE id = p_id;

  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'cancel_scheduled_transfer: transfer not found';
  END IF;
  IF v_rec.applied THEN
    RAISE EXCEPTION 'cancel_scheduled_transfer: transfer already applied';
  END IF;
  IF v_rec.org_id IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'cancel_scheduled_transfer: not your organization';
  END IF;
  IF NOT (
    v_role = 'admin'
    OR (v_role = 'manager' AND (
      v_rec.from_branch_id = v_caller_branch
      OR EXISTS (SELECT 1 FROM public.user_branches WHERE user_id = auth.uid() AND branch_id = v_rec.from_branch_id)
    ))
  ) THEN
    RAISE EXCEPTION 'cancel_scheduled_transfer: insufficient permissions';
  END IF;

  DELETE FROM public.staff_transfers WHERE id = p_id;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.extend_staff_transfer(p_transfer_id uuid, p_additional_value integer, p_additional_unit text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role          user_role;
  v_caller_org    uuid;
  v_caller_branch uuid;
  v_rec           record;
  v_new_revert_at timestamptz;
BEGIN
  IF p_additional_value IS NULL OR p_additional_value <= 0 THEN
    RAISE EXCEPTION 'extend_staff_transfer: additional duration must be a positive number';
  END IF;

  IF p_additional_unit IS NULL OR p_additional_unit NOT IN ('minute','hour','day','week','month') THEN
    RAISE EXCEPTION 'extend_staff_transfer: duration unit must be one of minute, hour, day, week, month';
  END IF;

  v_role          := get_user_role();
  v_caller_org    := get_user_org_id();
  v_caller_branch := get_user_branch_id();

  SELECT * INTO v_rec FROM public.staff_transfers WHERE id = p_transfer_id;

  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'extend_staff_transfer: transfer not found';
  END IF;

  IF v_rec.org_id IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'extend_staff_transfer: not your organization';
  END IF;

  IF v_rec.revert_at IS NULL THEN
    RAISE EXCEPTION 'extend_staff_transfer: this transfer has no scheduled return time';
  END IF;

  IF NOT (
    v_role = 'admin'
    OR (v_role = 'manager' AND (
      v_rec.to_branch_id = v_caller_branch
      OR EXISTS (SELECT 1 FROM public.user_branches WHERE user_id = auth.uid() AND branch_id = v_rec.to_branch_id)
    ))
  ) THEN
    RAISE EXCEPTION 'extend_staff_transfer: only an admin or the destination branch''s manager may extend this transfer';
  END IF;

  UPDATE public.staff_transfers
     SET revert_at = v_rec.revert_at + (p_additional_value || ' ' || p_additional_unit || 's')::interval,
         note = trim(both ' ' from
           COALESCE(v_rec.note || ' ', '') ||
           format('[+%s %s%s added %s]', p_additional_value, p_additional_unit, CASE WHEN p_additional_value = 1 THEN '' ELSE 's' END, to_char(now() AT TIME ZONE 'Asia/Kathmandu', 'DD Mon HH24:MI'))
         )
   WHERE id = p_transfer_id
     AND applied = true
     AND reverted = false
     AND revert_at > now()
  RETURNING revert_at INTO v_new_revert_at;

  IF v_new_revert_at IS NULL THEN
    RAISE EXCEPTION 'extend_staff_transfer: this transfer has already ended; start a new transfer instead';
  END IF;

  RETURN v_new_revert_at;
END;
$function$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('157', 'multi-branch-manager-transfer')
ON CONFLICT (version) DO NOTHING;
