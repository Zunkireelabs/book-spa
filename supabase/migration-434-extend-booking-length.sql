-- Migration 434 (ZNLY-407): make an appointment longer (length only, price never changes). Local-first; reversible (notes at the end).
--
--   * bookings.extra_minutes (>= 0, default 0). compute_booking_datetimes: end = start + service length + extra_minutes. A booking with 0 extra is
--     computed exactly as before. A service change resets extra_minutes to 0 (the new service brings its own length).
--   * organizations.extend_by_drag boolean NULL = the industry default (beauty ON, everything else OFF); an admin can set true/false.
--     org_can_extend(org) is the one place that rule lives; the app reads the same rule.
--   * extend_booking(p_booking_id, p_extra_minutes, p_override_reason): staff/manager/admin of the booking's branch, Pending/Confirmed/In-Progress,
--     not locked, org setting ON, multiple of 5, 0..480, not a combo. Writes extra_minutes (the existing guards fire through the triggers: staff clash,
--     availability, room capacity), keeps the staff junction row in step, logs LENGTH_CHANGED. Never touches base/discount/final amounts.
--     Outside working hours = the existing manager/admin override (p_override_reason); staff get the plain refusal.
--   * extra_minutes can only change through extend_booking / reschedule_booking (transaction flag app.extra_ok), never by a direct PATCH.
--   * reschedule_booking carries extra_minutes to the moved copy.
--   * the compute + room-capacity triggers also fire on extra_minutes.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS extra_minutes integer NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_extra_minutes_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_extra_minutes_check CHECK (extra_minutes >= 0 AND extra_minutes <= 480);
  END IF;
END $$;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS extend_by_drag boolean;

CREATE OR REPLACE FUNCTION public.org_can_extend(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(o.extend_by_drag, o.industry_type = 'beauty', false) FROM public.organizations o WHERE o.id = p_org
$$;
REVOKE ALL ON FUNCTION public.org_can_extend(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_can_extend(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.compute_booking_datetimes()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  svc_duration integer;
BEGIN
  SELECT duration_minutes INTO svc_duration FROM services WHERE id = NEW.service_id;
  IF svc_duration IS NULL THEN
    RAISE EXCEPTION 'Service not found: %', NEW.service_id;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.service_id IS DISTINCT FROM OLD.service_id THEN
    NEW.extra_minutes := 0;   -- the new service brings its own length
  END IF;

  -- extra_minutes is only ever set by extend_booking / reschedule_booking, which raise the transaction flag
  IF COALESCE(NEW.extra_minutes, 0) <> 0 AND (TG_OP = 'INSERT' OR NEW.extra_minutes IS DISTINCT FROM OLD.extra_minutes)
     AND COALESCE(current_setting('app.extra_ok', true), '') <> 'on' THEN
    RAISE EXCEPTION 'EXTRA_PROTECTED: A booking can only be made longer from the calendar or the booking panel.' USING ERRCODE = 'P0001';
  END IF;

  NEW.end_time := NEW.start_time + ((svc_duration + COALESCE(NEW.extra_minutes, 0)) * interval '1 minute');

  IF NEW.end_time <= NEW.start_time THEN
    RAISE EXCEPTION 'BOOKING_CROSSES_MIDNIGHT: A %-minute service starting at % would extend past midnight — please choose an earlier start time.',
      svc_duration + COALESCE(NEW.extra_minutes, 0), to_char(NEW.start_time, 'HH12:MI AM');
  END IF;

  NEW.start_datetime := (NEW.date + NEW.start_time) AT TIME ZONE 'Asia/Kathmandu';
  NEW.end_datetime := (NEW.date + NEW.end_time) AT TIME ZONE 'Asia/Kathmandu';
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_compute_datetimes ON public.bookings;
CREATE TRIGGER trg_compute_datetimes BEFORE INSERT OR UPDATE OF date, start_time, service_id, extra_minutes ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.compute_booking_datetimes();
DROP TRIGGER IF EXISTS trg_room_capacity_check ON public.bookings;
CREATE TRIGGER trg_room_capacity_check BEFORE INSERT OR UPDATE OF room_id, date, start_time, service_id, status, extra_minutes ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.check_room_capacity();

CREATE OR REPLACE FUNCTION public.extend_booking(p_booking_id uuid, p_extra_minutes integer, p_override_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role   user_role := get_user_role();
  v_org    uuid      := get_user_org_id();
  b        record;
  v_br_org uuid;
  v_dur    integer;
  v_reason text := NULLIF(btrim(COALESCE(p_override_reason, '')), '');
  v_old    integer;
  v_next   time;
  v_name   text;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('staff', 'manager', 'admin') THEN
    RAISE EXCEPTION 'EXTEND_REFUSED: You cannot change this booking.' USING ERRCODE = 'PT403';
  END IF;
  SELECT * INTO b FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXTEND_REFUSED: Could not find this booking.' USING ERRCODE = 'P0002'; END IF;
  SELECT br.org_id INTO v_br_org FROM public.branches br WHERE br.id = b.branch_id;
  IF v_br_org IS DISTINCT FROM v_org OR (v_role <> 'admin' AND NOT (b.branch_id = ANY (get_user_branch_ids()))) THEN
    RAISE EXCEPTION 'EXTEND_REFUSED: You cannot change this booking.' USING ERRCODE = 'PT403';
  END IF;
  IF NOT public.org_can_extend(v_org) THEN
    RAISE EXCEPTION 'EXTEND_OFF: Making appointments longer is turned off for this business.' USING ERRCODE = 'P0001';
  END IF;
  IF b.is_locked THEN RAISE EXCEPTION 'DAY_LOCKED: This day has been closed. No further modifications allowed.' USING ERRCODE = 'P0001'; END IF;
  IF b.status NOT IN ('Pending', 'Confirmed', 'In-Progress') THEN
    RAISE EXCEPTION 'EXTEND_REFUSED: A % booking cannot be changed.', lower(b.status::text) USING ERRCODE = 'P0002';
  END IF;
  IF p_extra_minutes IS NULL OR p_extra_minutes < 0 OR p_extra_minutes > 480 OR p_extra_minutes % 5 <> 0 THEN
    RAISE EXCEPTION 'EXTEND_REFUSED: Pick a length in 5-minute steps, not shorter than the service.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.booking_combo_items ci WHERE ci.booking_id = b.id) THEN
    RAISE EXCEPTION 'EXTEND_REFUSED: A package of services cannot be made longer here.' USING ERRCODE = 'P0001';
  END IF;
  SELECT duration_minutes INTO v_dur FROM public.services WHERE id = b.service_id;
  v_old := b.extra_minutes;
  IF p_extra_minutes = v_old THEN
    RETURN jsonb_build_object('id', b.id, 'extra_minutes', v_old, 'length_minutes', v_dur + v_old, 'changed', false);
  END IF;

  PERFORM set_config('app.extra_ok', 'on', true);
  BEGIN
    UPDATE public.bookings
       SET extra_minutes = p_extra_minutes, availability_override_reason = v_reason
     WHERE id = b.id;
  EXCEPTION
    WHEN exclusion_violation THEN
      SELECT x.start_time, t.name INTO v_next, v_name
        FROM public.bookings x JOIN public.therapists t ON t.id = b.therapist_id
       WHERE x.therapist_id = b.therapist_id AND x.date = b.date AND x.id <> b.id AND x.start_time >= b.start_time
         AND x.status NOT IN ('Cancelled', 'No Show', 'Completed')
       ORDER BY x.start_time LIMIT 1;
      RAISE EXCEPTION 'EXTEND_CLASH: %', CASE WHEN v_next IS NULL THEN 'This booking can''t be made that long. Nothing was changed.'
        ELSE format('%s has another booking at %s, so this one can''t run past then. Nothing was changed.', COALESCE(v_name, 'This person'), to_char(v_next, 'FMHH12:MIpm')) END
        USING ERRCODE = 'P0003';
  END;
  PERFORM set_config('app.extra_ok', '', true);
  IF v_reason IS NOT NULL THEN UPDATE public.bookings SET availability_override_reason = NULL WHERE id = b.id; END IF;

  -- the staff junction row(s) that share the booking's span follow it
  UPDATE public.booking_therapists bt SET end_time = (SELECT end_time FROM public.bookings WHERE id = b.id)
   WHERE bt.booking_id = b.id AND bt.start_time IS NOT DISTINCT FROM b.start_time;

  INSERT INTO public.audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by, reason)
  VALUES (b.branch_id, 'bookings', b.id, 'LENGTH_CHANGED',
          jsonb_build_object('length_minutes', v_dur + v_old, 'extra_minutes', v_old),
          jsonb_build_object('length_minutes', v_dur + p_extra_minutes, 'extra_minutes', p_extra_minutes, 'start_time', b.start_time),
          auth.uid(), v_reason);

  RETURN jsonb_build_object('id', b.id, 'extra_minutes', p_extra_minutes, 'length_minutes', v_dur + p_extra_minutes, 'changed', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.extend_booking(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extend_booking(uuid, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_extend_by_drag(p_value boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_org uuid := (SELECT get_user_org_id()); v_new boolean;
BEGIN
  IF (SELECT get_user_role()) IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'set_extend_by_drag: admin only' USING ERRCODE = '42501'; END IF;
  UPDATE public.organizations SET extend_by_drag = p_value WHERE id = v_org;
  RETURN public.org_can_extend(v_org);
END $$;
REVOKE ALL ON FUNCTION public.set_extend_by_drag(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_extend_by_drag(boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reschedule_booking(p_booking_id uuid, p_date date, p_start_time time without time zone, p_therapist_id uuid, p_room_id uuid, p_reason text, p_override_reason text DEFAULT NULL::text)
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
  v_base            numeric(10,2);
  v_discount        numeric(10,2);
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

  -- ZNLY-208: a tiered service is priced from the NEW team member's tier (nobody assigned / no tier = the standard price). Combo
  -- bookings keep their per-part prices. Nothing is paid here (guard above), so the price is free to move. A rupee discount stays
  -- a discount on top of the new price and never exceeds it.
  v_base := v_orig.base_amount;
  IF EXISTS (SELECT 1 FROM public.services s WHERE s.id = v_orig.service_id AND s.price_type = 'tiered')
     AND NOT EXISTS (SELECT 1 FROM public.booking_combo_items ci WHERE ci.booking_id = v_orig.id) THEN
    v_base := public.service_price_for_therapist(v_orig.service_id, p_therapist_id);
  END IF;
  v_discount := LEAST(v_orig.discount_amount, v_base);

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
  -- the moved booking keeps the staff-overlap stamp of the one it replaces (the stamp trigger honours this, then it is cleared)
  PERFORM set_config('app.overlap_stamp', v_orig.allows_overlap::text, true);
  PERFORM set_config('app.extra_ok', 'on', true);  -- ZNLY-407: the copy keeps the original's extra minutes

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
    due_holder_name, companion_name, companion_phone, availability_override_reason,
    visit_id, extra_minutes
  )
  VALUES (
    v_new_id, v_orig.branch_id, v_room_id, v_orig.service_id, p_therapist_id,
    v_orig.customer_name, v_orig.customer_email, v_orig.customer_phone, v_orig.customer_gender,
    p_date, p_start_time, 'Pending',
    v_orig.special_requests, 'unpaid',
    v_base, v_discount, v_orig.discount_status, v_orig.discount_approved_by,
    v_orig.discount_reason, v_orig.discount_requested_by, v_orig.discount_requested_to,
    v_orig.customer_id, v_orig.service_name_snapshot, v_orig.service_duration_snapshot,
    v_orig.service_price_snapshot, v_orig.service_category_snapshot,
    v_therapist_name, v_room_name,
    auth.uid(), v_orig.booking_group_id, v_orig.referred_by,
    v_orig.referral_commission_type, v_orig.referral_commission_value,
    v_orig.customer_account_id, v_orig.referral_source, v_orig.referral_source_detail,
    v_orig.due_holder_name, v_orig.companion_name, v_orig.companion_phone, NULLIF(btrim(COALESCE(p_override_reason, '')), ''),
    v_orig.visit_id, v_orig.extra_minutes
  );

  PERFORM set_config('app.overlap_stamp', '', true);
  PERFORM set_config('app.extra_ok', '', true);

  -- the reason only authorises THIS insert; never leave it on the row
  UPDATE public.bookings SET availability_override_reason = NULL WHERE id = v_new_id AND availability_override_reason IS NOT NULL;

  SELECT booking_number INTO v_new_number FROM public.bookings WHERE id = v_new_id;

  RETURN jsonb_build_object('id', v_new_id, 'booking_number', v_new_number);
END;
$function$;


INSERT INTO public.schema_migrations (version, name)
VALUES ('434', 'extend-booking-length')
ON CONFLICT (version) DO NOTHING;

-- Reversible: restore compute_booking_datetimes to the migration 179 body and its trigger column list, restore reschedule_booking to the migration 429 body,
-- DROP FUNCTION extend_booking, set_extend_by_drag, org_can_extend; DROP COLUMN bookings.extra_minutes, organizations.extend_by_drag.
COMMIT;
