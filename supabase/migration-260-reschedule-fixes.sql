-- Migration 260: reschedule_booking() correctness fixes, surfaced by review of
-- migrations 240-245 ahead of the first production promotion since they landed.
--
-- reschedule_booking (migration-243) had four defects that only bite against real
-- production data — staging's drag-and-drop testing always targets a room column
-- (so p_room_id is never null) and holds no real payments:
--
--   1. p_room_id went straight into the INSERT with no fallback, but bookings.room_id
--      is NOT NULL. calendar/index.jsx's therapist-column drop sends a null room_id
--      (api.js's createBooking auto-assigns a room in that case; this RPC never got
--      that logic) -> 23502 not-null violation on every therapist-column reschedule.
--   2. The new row was inserted BEFORE the original was cancelled, so the original
--      still held its room/therapist and excl_therapist_overlap (schema.sql, a
--      non-deferrable GIST exclusion constraint) / check_room_capacity (migration-130)
--      rejected any overlapping move -- including a same-room 15-minute shift.
--   3. The status gate only blocked Completed/Cancelled/No Show. Cancelling a
--      Confirmed+paid booking fires trg_handle_booking_cancellation_refund
--      (migration-099): a real payment_refunds row gets written and the original
--      flips to refunded, while the new booking starts unpaid -- a silent refund
--      nobody asked for.
--   4. Authorization only checked the booking's org against get_user_org_id(), but
--      the RLS this RPC bypasses is branch-scoped for non-admins (migration-224). On
--      a multi-branch org a staff member at branch A could cancel-and-recreate a
--      branch B booking, including triggering (3) there. The role check was also not
--      NULL-safe (`v_role NOT IN (...)` is NULL, not true, when v_role IS NULL --
--      reachable, since customer accounts have no public.users row and
--      get_user_role() returns NULL for them -- so the check silently let them
--      through instead of rejecting).
--
-- mark_tips_distributed (migration-241) has the identical org-only, non-NULL-safe
-- authorization shape, fixed the same way.
--
-- admin_delete_booking (migration-232) enumerates its financial-record blockers
-- explicitly and doesn't know about booking_tips' ON DELETE RESTRICT (migration-240)
-- -- deleting a booking with a tip raised a raw 23503 instead of the designed
-- BOOKING_HAS_FINANCIAL_RECORDS, rolling back the audit row with it.
--
-- All four identical-signature CREATE OR REPLACE, so migration-245's grants and the
-- Supabase RPC callers resolve unchanged -- no DROP needed.

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
    v_orig.due_holder_name, v_orig.companion_name, v_orig.companion_phone
  );

  SELECT booking_number INTO v_new_number FROM public.bookings WHERE id = v_new_id;

  RETURN jsonb_build_object('id', v_new_id, 'booking_number', v_new_number);
END;
$function$;

-- mark_tips_distributed: identical org-only / non-NULL-safe authorization shape,
-- fixed the same way (NULL-safe role gate + branch-scoped non-admins).
CREATE OR REPLACE FUNCTION public.mark_tips_distributed(p_branch_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role       user_role := get_user_role();
  v_caller_org uuid      := get_user_org_id();
  v_branch_org uuid;
  v_count      integer;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'mark_tips_distributed: admin or manager role required'
      USING ERRCODE = 'P0003';
  END IF;

  SELECT org_id INTO v_branch_org FROM public.branches WHERE id = p_branch_id;
  IF v_branch_org IS NULL THEN
    RAISE EXCEPTION 'mark_tips_distributed: branch % not found', p_branch_id
      USING ERRCODE = 'P0003';
  END IF;
  IF v_branch_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'mark_tips_distributed: branch is not in your organization'
      USING ERRCODE = 'P0003';
  END IF;

  IF v_role <> 'admin' AND NOT (p_branch_id = ANY (get_user_branch_ids())) THEN
    RAISE EXCEPTION 'mark_tips_distributed: branch is not one of yours'
      USING ERRCODE = 'P0003';
  END IF;

  WITH updated AS (
    UPDATE public.booking_tips bt
       SET distributed_at = now(),
           distributed_by = auth.uid()
      FROM public.bookings b
     WHERE b.id = bt.booking_id
       AND b.branch_id = p_branch_id
       AND bt.distributed_at IS NULL
    RETURNING bt.id
  )
  SELECT count(*) INTO v_count FROM updated;

  IF v_count > 0 THEN
    INSERT INTO public.audit_logs
      (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by, reason)
    VALUES
      (p_branch_id, 'booking_tips', p_branch_id, 'TIPS_DISTRIBUTED',
       jsonb_build_object('count', v_count),
       jsonb_build_object('distributed_at', now()),
       auth.uid(), 'Bulk tip distribution for branch');
  END IF;

  RETURN v_count;
END;
$$;

-- admin_delete_booking: add booking_tips to the explicit blocker list so a tipped
-- booking raises the friendly BOOKING_HAS_FINANCIAL_RECORDS message instead of a raw
-- 23503 from booking_tips' ON DELETE RESTRICT (migration-240), which was rolling back
-- the audit row the function had just written.
CREATE OR REPLACE FUNCTION public.admin_delete_booking(
  p_booking_id uuid,
  p_reason     text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role     user_role := get_user_role();
  v_org      uuid      := get_user_org_id();
  v_old      jsonb;
  v_branch   uuid;
  v_blockers text[] := '{}';
  v_links    jsonb;
  v_n        int;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'admin_delete_booking: admin role required'
      USING ERRCODE = 'P0003';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'admin_delete_booking: a reason of at least 10 characters is required'
      USING ERRCODE = 'P0003';
  END IF;

  SELECT to_jsonb(b), b.branch_id INTO v_old, v_branch
  FROM public.bookings b WHERE b.id = p_booking_id;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'admin_delete_booking: booking % not found', p_booking_id
      USING ERRCODE = 'P0003';
  END IF;

  IF (v_old->>'org_id')::uuid IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'admin_delete_booking: booking is not in your organization'
      USING ERRCODE = 'P0003';
  END IF;

  SELECT count(*) INTO v_n FROM public.payments WHERE booking_id = p_booking_id;
  IF v_n > 0 THEN v_blockers := v_blockers || format('%s payment(s)', v_n); END IF;

  SELECT count(*) INTO v_n FROM public.payment_refunds WHERE booking_id = p_booking_id;
  IF v_n > 0 THEN v_blockers := v_blockers || format('%s refund(s)', v_n); END IF;

  SELECT count(*) INTO v_n FROM public.customer_referrals WHERE booking_id = p_booking_id;
  IF v_n > 0 THEN v_blockers := v_blockers || format('%s referral(s)', v_n); END IF;

  SELECT count(*) INTO v_n FROM public.package_redemptions WHERE booking_id = p_booking_id;
  IF v_n > 0 THEN v_blockers := v_blockers || format('%s package redemption(s)', v_n); END IF;

  SELECT count(*) INTO v_n FROM public.booking_tips WHERE booking_id = p_booking_id;
  IF v_n > 0 THEN v_blockers := v_blockers || format('%s tip(s)', v_n); END IF;

  IF array_length(v_blockers, 1) > 0 THEN
    RAISE EXCEPTION 'BOOKING_HAS_FINANCIAL_RECORDS: this booking cannot be deleted because it has %. Cancel it with a correction reason instead, which keeps the record and the audit trail.',
      array_to_string(v_blockers, ' and ')
      USING ERRCODE = 'P0004';
  END IF;

  -- Audit BEFORE the delete: once the row is gone there is nothing left to
  -- copy, and a delete with no record of what was deleted is not an audit.
  --
  -- membership_transactions.booking_id and voucher_claims.booking_id are
  -- ON DELETE SET NULL, so those rows survive but lose all trace of what they
  -- were for. Balances stay correct either way; what is lost is the ability to
  -- answer "why was this wallet deducted". Capture the links in the audit row
  -- so the trail outlives the booking.
  SELECT jsonb_build_object(
           'membership_transaction_ids',
           COALESCE((SELECT jsonb_agg(id) FROM public.membership_transactions WHERE booking_id = p_booking_id), '[]'::jsonb),
           'voucher_claim_ids',
           COALESCE((SELECT jsonb_agg(id) FROM public.voucher_claims WHERE booking_id = p_booking_id), '[]'::jsonb),
           'booking_therapist_ids',
           COALESCE((SELECT jsonb_agg(id) FROM public.booking_therapists WHERE booking_id = p_booking_id), '[]'::jsonb)
         )
    INTO v_links;

  INSERT INTO public.audit_logs
    (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by, reason)
  VALUES
    (v_branch, 'bookings', p_booking_id, 'ADMIN_DELETE',
     v_old || jsonb_build_object('__unlinked', v_links), NULL, auth.uid(), btrim(p_reason));

  PERFORM set_config('app.admin_correction', 'on', true);

  -- booking_therapists is ON DELETE CASCADE and goes with it. Every other
  -- referencing table is SET NULL, so those rows survive with a null link.
  DELETE FROM public.bookings WHERE id = p_booking_id;

  RETURN p_booking_id;
END;
$function$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('260', 'reschedule-fixes')
ON CONFLICT (version) DO NOTHING;

COMMIT;
