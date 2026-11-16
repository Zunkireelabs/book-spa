-- Migration 382 (ZNLY-208, board B2.3): a tiered price follows the team member until the booking is paid.
--   * reschedule_booking v8 (from 356): the copied booking is priced from the NEW team member's tier (nobody / no tier = services.price_npr)
--     instead of copying base_amount. Combo bookings keep per-part prices. A rupee discount stays on top and never exceeds the price.
--   * trg_bookings_tier_reprice: any other change of bookings.therapist_id (assign, calendar drag, admin tools) re-prices a tiered
--     booking when the caller did not set base_amount itself; once ANY payment exists the price is locked (a changed base_amount that
--     rides along with a team member change is put back), except inside an admin correction (app.admin_correction, which needs a reason).
--   * booking_combo_items: changing a part's team member re-prices that part (its own service, its own member) and the booking total
--     (sum of parts), unless a payment exists.
--   * A change to a person's tier or a service's tier prices is NOT pushed into existing bookings: nothing here touches them until
--     their team member / slot changes.
-- final_amount is set directly in the trigger: trg_compute_final_amount is column-specific and would not fire.
-- Rollback (manual): restore reschedule_booking from migration-356; drop the two triggers and the helper below.
-- Applied: stage - / prod HELD.

BEGIN;

CREATE OR REPLACE FUNCTION public._booking_price_locked(p_booking_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$ SELECT EXISTS (SELECT 1 FROM public.payments WHERE booking_id = p_booking_id) $$;

CREATE OR REPLACE FUNCTION public.trg_bookings_tier_reprice() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_tiered boolean;
BEGIN
  IF NEW.therapist_id IS NOT DISTINCT FROM OLD.therapist_id THEN RETURN NEW; END IF;
  IF current_setting('app.admin_correction', true) = 'on' THEN RETURN NEW; END IF;
  SELECT (s.price_type = 'tiered') INTO v_tiered FROM public.services s WHERE s.id = NEW.service_id;
  IF NOT COALESCE(v_tiered, false) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.booking_combo_items ci WHERE ci.booking_id = NEW.id) THEN RETURN NEW; END IF;   -- combos: per-part prices
  IF public._booking_price_locked(NEW.id) THEN
    NEW.base_amount := OLD.base_amount;                      -- paid (or part-paid): the price is locked
  ELSIF NEW.base_amount IS NOT DISTINCT FROM OLD.base_amount THEN
    NEW.base_amount := public.service_price_for_therapist(NEW.service_id, NEW.therapist_id);
  END IF;
  NEW.discount_amount := LEAST(NEW.discount_amount, NEW.base_amount);
  NEW.final_amount := NEW.base_amount - NEW.discount_amount;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_bookings_tier_reprice ON public.bookings;
CREATE TRIGGER trg_bookings_tier_reprice BEFORE UPDATE OF therapist_id ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.trg_bookings_tier_reprice();

CREATE OR REPLACE FUNCTION public.trg_combo_item_tier_reprice() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_total numeric(10,2); v_share numeric(10,2);
BEGIN
  IF NEW.therapist_id IS NOT DISTINCT FROM OLD.therapist_id THEN RETURN NULL; END IF;
  IF current_setting('app.admin_correction', true) = 'on' OR public._booking_price_locked(NEW.booking_id) THEN RETURN NULL; END IF;
  v_share := COALESCE(public.service_price_for_therapist(NEW.service_id, NEW.therapist_id), 0);
  UPDATE public.booking_combo_items SET base_share_amount = v_share WHERE id = NEW.id AND base_share_amount IS DISTINCT FROM v_share;
  SELECT COALESCE(SUM(base_share_amount), 0) INTO v_total FROM public.booking_combo_items WHERE booking_id = NEW.booking_id;
  UPDATE public.bookings SET base_amount = v_total, discount_amount = LEAST(discount_amount, v_total), final_amount = v_total - LEAST(discount_amount, v_total)
   WHERE id = NEW.booking_id AND base_amount IS DISTINCT FROM v_total;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_combo_item_tier_reprice ON public.booking_combo_items;
CREATE TRIGGER trg_combo_item_tier_reprice AFTER UPDATE OF therapist_id ON public.booking_combo_items FOR EACH ROW EXECUTE FUNCTION public.trg_combo_item_tier_reprice();

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
    v_base, v_discount, v_orig.discount_status, v_orig.discount_approved_by,
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
VALUES ('382', 'tier-price-follows-team-member')
ON CONFLICT (version) DO NOTHING;

COMMIT;
