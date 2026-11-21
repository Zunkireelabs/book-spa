-- Migration 356: reschedule_booking gets an optional manager/admin override reason (ZNLY-100, V29b).
-- The new booking row is inserted with availability_override_reason = p_override_reason, so the guard (migration 353)
-- lets a manager/admin move it into off-shift / break / blocked / other-branch time (audited). The reason is cleared
-- right after the insert so it can never carry over. Staff passing a reason get OVERRIDE_NOT_ALLOWED from the guard.
-- ON_LEAVE and OVERLAP are still refused. Without p_override_reason the behaviour is unchanged.
-- Reversible (manual): restore the migration-260/263 body and drop the 7-argument signature.
BEGIN;

DROP FUNCTION IF EXISTS public.reschedule_booking(uuid, date, time, uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.reschedule_booking(p_booking_id uuid, p_date date, p_start_time time without time zone, p_therapist_id uuid, p_room_id uuid, p_reason text, p_override_reason text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role            user_role := get_user_role();
  v_org             uuid      := get_user_org_id();
  v_orig            record;
  v_branch_org      uuid;
  v_room_id         uuid;
  v_new_id          uuid := gen_random_uuid();
  v_new_number      text;
  v_therapist_name  text;
  v_room_name       text;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('staff', 'manager', 'admin') THEN
    RAISE EXCEPTION 'reschedule_booking: staff, manager, or admin role required';
  END IF;

  SELECT * INTO v_orig FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reschedule_booking: booking % not found', p_booking_id;
  END IF;

  SELECT br.org_id INTO v_branch_org FROM public.branches br WHERE br.id = v_orig.branch_id;
  IF v_branch_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'reschedule_booking: booking does not belong to your organization';
  END IF;

  IF v_role <> 'admin' AND NOT (v_orig.branch_id = ANY (get_user_branch_ids())) THEN
    RAISE EXCEPTION 'reschedule_booking: booking is not at one of your branches';
  END IF;

  IF v_orig.status IN ('Completed', 'Cancelled', 'No Show') THEN
    RAISE EXCEPTION 'reschedule_booking: cannot reschedule a % booking', v_orig.status
      USING ERRCODE = 'P0002';
  END IF;

  IF v_orig.is_locked THEN
    RAISE EXCEPTION 'DAY_LOCKED: This day has been closed. No further modifications allowed.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_orig.payment_status IN ('paid', 'partial') THEN
    RAISE EXCEPTION 'BOOKING_PAID: This booking is already paid — cancel and refund it explicitly, or collect the difference, before rescheduling.'
      USING ERRCODE = 'P0006';
  END IF;

  -- Keep the original's room when the caller doesn't name one (therapist-column
  -- drop), matching createBooking's intent without duplicating its auto-assign
  -- search. bookings.room_id is NOT NULL, so v_orig.room_id is always set.
  v_room_id := COALESCE(p_room_id, v_orig.room_id);

  IF p_therapist_id IS NOT NULL THEN
    SELECT name INTO v_therapist_name FROM public.therapists WHERE id = p_therapist_id;
  END IF;
  IF v_room_id IS NOT NULL THEN
    SELECT name INTO v_room_name FROM public.rooms WHERE id = v_room_id;
  END IF;

  -- Cancel the original BEFORE inserting the new row: this releases its room and
  -- therapist so the new row's INSERT is checked against excl_therapist_overlap /
  -- check_room_capacity without the original still holding the slot it's moving
  -- out of. Same transaction, so atomicity is unchanged.
  UPDATE public.bookings
  SET status = 'Cancelled', cancellation_reason = p_reason
  WHERE id = p_booking_id;

  -- Bypass trg_bookings_require_phone (migration-263) for this one copy-forward
  -- INSERT: v_orig.customer_phone may be blank on a pre-migration booking, and
  -- rescheduling it must keep working exactly as before. SET LOCAL is
  -- transaction-scoped and resets automatically — nothing leaks past this call.
  PERFORM set_config('app.skip_phone_check', 'on', true);

  -- New booking: same branch/service/customer/pricing/discount as the original;
  -- date/start_time/therapist/room take the new values. Status starts Pending —
  -- triggers compute end_time, start/end_datetime, final_amount, booking_number.
  INSERT INTO public.bookings (
    id, branch_id, room_id, service_id, therapist_id,
    customer_name, customer_email, customer_phone, customer_gender,
    date, start_time, status,
    special_requests, payment_status,
    base_amount, discount_amount, discount_status, discount_approved_by,
    discount_reason, discount_requested_by, discount_requested_to,
    customer_id, service_name_snapshot, service_duration_snapshot,
    service_price_snapshot, service_category_snapshot,
    therapist_name_snapshot, room_name_snapshot,
    created_by, booking_group_id, referred_by,
    referral_commission_type, referral_commission_value,
    customer_account_id, referral_source, referral_source_detail,
    due_holder_name, companion_name, companion_phone, availability_override_reason
  )
  VALUES (
    v_new_id, v_orig.branch_id, v_room_id, v_orig.service_id, p_therapist_id,
    v_orig.customer_name, v_orig.customer_email, v_orig.customer_phone, v_orig.customer_gender,
    p_date, p_start_time, 'Pending',
    v_orig.special_requests, 'unpaid',
    v_orig.base_amount, v_orig.discount_amount, v_orig.discount_status, v_orig.discount_approved_by,
    v_orig.discount_reason, v_orig.discount_requested_by, v_orig.discount_requested_to,
    v_orig.customer_id, v_orig.service_name_snapshot, v_orig.service_duration_snapshot,
    v_orig.service_price_snapshot, v_orig.service_category_snapshot,
    v_therapist_name, v_room_name,
    auth.uid(), v_orig.booking_group_id, v_orig.referred_by,
    v_orig.referral_commission_type, v_orig.referral_commission_value,
    v_orig.customer_account_id, v_orig.referral_source, v_orig.referral_source_detail,
    v_orig.due_holder_name, v_orig.companion_name, v_orig.companion_phone, NULLIF(btrim(COALESCE(p_override_reason, '')), '')
  );

  -- the reason only authorises THIS insert; never leave it on the row
  UPDATE public.bookings SET availability_override_reason = NULL WHERE id = v_new_id AND availability_override_reason IS NOT NULL;

  SELECT booking_number INTO v_new_number FROM public.bookings WHERE id = v_new_id;

  RETURN jsonb_build_object('id', v_new_id, 'booking_number', v_new_number);
END;
$function$;

REVOKE ALL ON FUNCTION public.reschedule_booking(uuid, date, time, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_booking(uuid, date, time, uuid, uuid, text, text) TO authenticated, service_role;

INSERT INTO public.schema_migrations (version, name)
VALUES ('356', 'reschedule-booking-override-reason')
ON CONFLICT (version) DO NOTHING;

COMMIT;
