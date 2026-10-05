-- Migration 243: reschedule_booking() RPC — atomic reschedule (create-new + cancel-old)
-- Replaces the two-sequential-client-calls reschedule flow (createBooking() then
-- updateBookingStatus(cancelled)) used by booking-details-assignment-modal/index.jsx
-- and calendar/index.jsx's Rebook-reuse-as-reschedule branch. That flow has two bugs:
--   1. Not atomic — if the cancel call fails after the new booking was created, both
--      the new booking and the still-active original stay live (double-booked slot,
--      no compensating action).
--   2. createBooking() always recomputes price fresh and has no discount param, so an
--      approved discount (and special_requests/customerEmail/customerGender/companion
--      fields/bookingGroupId/referring_*) is silently dropped on reschedule.
-- This RPC does both steps in one transaction, copying every preservable field from
-- the original row instead of re-deriving them, mirroring the all-or-nothing pattern
-- record_group_payment() established (migration-178).
--
-- Deliberately narrower than createBooking(): it does not re-run createBooking()'s JS-side
-- advisory checks (therapist transfer-window / attendance-absence / inactive-therapist
-- validation, couple-service rejection, auto room assignment) — those exist to produce
-- friendlier error messages, not to enforce data integrity. The DB triggers that *do*
-- enforce integrity (check_room_capacity, check_branch_online_capacity,
-- enforce_therapist_for_active_bookings, enforce_booking_immutability) still fire on
-- this INSERT/UPDATE same as any other, since this function only runs through normal
-- table DML inside a transaction.
--
-- Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

CREATE OR REPLACE FUNCTION public.reschedule_booking(
  p_booking_id uuid,
  p_date date,
  p_start_time time,
  p_therapist_id uuid,
  p_room_id uuid,
  p_reason text
)
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
  v_new_id          uuid := gen_random_uuid();
  v_new_number      text;
  v_therapist_name  text;
  v_room_name       text;
BEGIN
  IF v_role NOT IN ('staff', 'manager', 'admin') THEN
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

  IF v_orig.status IN ('Completed', 'Cancelled', 'No Show') THEN
    RAISE EXCEPTION 'reschedule_booking: cannot reschedule a % booking', v_orig.status
      USING ERRCODE = 'P0002';
  END IF;

  IF v_orig.is_locked THEN
    RAISE EXCEPTION 'DAY_LOCKED: This day has been closed. No further modifications allowed.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_therapist_id IS NOT NULL THEN
    SELECT name INTO v_therapist_name FROM public.therapists WHERE id = p_therapist_id;
  END IF;
  IF p_room_id IS NOT NULL THEN
    SELECT name INTO v_room_name FROM public.rooms WHERE id = p_room_id;
  END IF;

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
    due_holder_name, companion_name, companion_phone
  )
  VALUES (
    v_new_id, v_orig.branch_id, p_room_id, v_orig.service_id, p_therapist_id,
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
    v_orig.due_holder_name, v_orig.companion_name, v_orig.companion_phone
  );

  SELECT booking_number INTO v_new_number FROM public.bookings WHERE id = v_new_id;

  UPDATE public.bookings
  SET status = 'Cancelled', cancellation_reason = p_reason
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('id', v_new_id, 'booking_number', v_new_number);
END;
$function$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('243', 'reschedule-booking-rpc')
ON CONFLICT (version) DO NOTHING;

COMMIT;
