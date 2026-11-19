-- Migration 392: day close vs. money and unfinished bookings (ZNLY-234, found in CP5 on samis-qc 17 Nov 2026)
--
-- 1. A balance on a closed-day booking stays collectable (owner decision 2026-11-17). record_booking_payment (mig 380) and record_group_payment
--    (mig 346; checkout_booking_with_products pays its treatment through it) no longer refuse a locked booking. The payment is a new `payments`
--    row stamped NOW, so it lands in the day it is received (cash-day basis, ZNLY-232); the closed daily_reports row is never touched.
--    The only thing a locked booking may change is payment_status, and only from update_booking_payment_status (the payment trigger), which sets the
--    transaction-local flag app.closed_day_payment around its own UPDATE; enforce_booking_immutability lets exactly that one-column change through.
--    Price, discount, status, staff, products and every other edit on a locked booking stay blocked (DAY_LOCKED), and so do the wallet payment
--    functions (record_referral_wallet_payment, record_voucher_wallet_payment*), which are untouched. payments has no client INSERT grant, so the flag
--    cannot be reached except through these definer functions.
--    checkout_booking_with_products: products on a locked booking are refused (DAY_LOCKED); the balance alone is fine.
-- 2. Close Day is refused while any booking of that day is Pending, Confirmed or In-Progress (trigger on daily_reports, so no client can skip it);
--    day_unfinished_bookings() lists them for the dialog. A Completed booking with a balance may still be closed (it stays collectable, point 1).
-- 3. Wallet / voucher / referral / package tenders may pay the balance of a closed-day booking too (they are not money in; the closed day is unaffected).
-- 4. get_day_money and get_dashboard also return after_close {amount, cash}: money taken after a branch closed that day (net of later refunds),
--    so the closed-day reconciliation and the Close card can say "collected after close" while the closed daily_reports row stays frozen.
-- Applied: stage - / prod -.

BEGIN;

-- ---- 1. collect a balance after close ----
CREATE OR REPLACE FUNCTION public.enforce_booking_immutability()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Acknowledgement escape hatch (migration 335): only acknowledge_booking() sets this transaction-local flag, and the
  -- UPDATE must touch nothing but the acknowledgement columns (+ updated_at). Everything else is still fully enforced.
  IF current_setting('app.acknowledging', true) = 'on'
     AND (to_jsonb(NEW) - 'acknowledged_at' - 'acknowledged_by' - 'updated_at')
         = (to_jsonb(OLD) - 'acknowledged_at' - 'acknowledged_by' - 'updated_at') THEN
    RETURN NEW;
  END IF;

  -- Nobody can set or change "who saw it" by a direct UPDATE (bookings UPDATE RLS lets staff PATCH rows): only acknowledge_booking()
  -- may touch these columns. (admin_correct_booking never does.)
  IF NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
     OR NEW.acknowledged_by IS DISTINCT FROM OLD.acknowledged_by THEN
    RAISE EXCEPTION 'ACKNOWLEDGEMENT_PROTECTED: acknowledged_at / acknowledged_by can only be set by acknowledge_booking().'
      USING ERRCODE = 'P0001';
  END IF;

  -- Admin correction escape hatch. Requires the transaction-local flag set by
  -- admin_correct_booking()/admin_delete_booking() AND an admin role. See the
  -- header of migration 232 for why both are required.
  IF current_setting('app.admin_correction', true) = 'on'
     AND get_user_role() IS NOT DISTINCT FROM 'admin'::user_role THEN
    RETURN NEW;
  END IF;

  -- A balance on a closed-day booking stays collectable (ZNLY-234, owner decision 2026-11-17): the payment trigger
  -- (update_booking_payment_status) sets this transaction-local flag around its own UPDATE, and the UPDATE may change payment_status
  -- and nothing else. Price, discount, status, staff and everything else on a locked booking stay blocked.
  IF OLD.is_locked = true AND current_setting('app.closed_day_payment', true) = 'on'
     AND (to_jsonb(NEW) - 'payment_status' - 'updated_at') = (to_jsonb(OLD) - 'payment_status' - 'updated_at') THEN
    RETURN NEW;
  END IF;

  -- Locked bookings: no changes at all
  IF OLD.is_locked = true THEN
    RAISE EXCEPTION 'DAY_LOCKED: This day has been closed. No further modifications allowed.'
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status = 'Completed' THEN
    -- Structural fields are always immutable once completed
    IF (
      NEW.status IS DISTINCT FROM OLD.status
      OR NEW.base_amount IS DISTINCT FROM OLD.base_amount
      OR NEW.therapist_id IS DISTINCT FROM OLD.therapist_id
    ) THEN
      RAISE EXCEPTION 'BOOKING_IMMUTABLE: Completed bookings cannot be modified.'
        USING ERRCODE = 'P0002';
    END IF;

    -- Discounts stay editable until payment is taken; once paid, frozen
    IF OLD.payment_status = 'paid' AND (
      NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
      OR NEW.discount_status IS DISTINCT FROM OLD.discount_status
    ) THEN
      RAISE EXCEPTION 'BOOKING_IMMUTABLE: Cannot modify discount on a paid booking.'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_booking_payment_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_paid  numeric;
  v_final numeric;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.payments WHERE booking_id = NEW.booking_id;

  SELECT final_amount INTO v_final
  FROM public.bookings WHERE id = NEW.booking_id;

  -- ZNLY-234: lets this one payment_status write through on a closed-day booking (see enforce_booking_immutability)
  PERFORM set_config('app.closed_day_payment', 'on', true);
  UPDATE public.bookings
  SET payment_status = CASE
        WHEN v_paid >= v_final THEN 'paid'
        WHEN v_paid > 0        THEN 'partial'
        ELSE 'unpaid'
      END
  WHERE id = NEW.booking_id;
  PERFORM set_config('app.closed_day_payment', 'off', true);

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_booking_payment(p_booking_id uuid, p_rows jsonb, p_idempotency_key uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid(); v_role user_role := get_user_role(); v_org uuid := get_user_org_id();
  v_b record; v_req record; v_row jsonb; v_mode text; v_amt numeric(10,2);
  v_total numeric(10,2) := 0; v_collected numeric(10,2); v_remaining numeric(10,2); v_ids uuid[] := '{}'; v_id uuid; v_first boolean := true;
BEGIN
  IF v_actor IS NULL OR v_role IS NULL OR v_role NOT IN ('staff', 'manager', 'admin') THEN
    RAISE EXCEPTION 'record_booking_payment: staff, manager, or admin role required';
  END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'record_booking_payment: an idempotency key is required'; END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'record_booking_payment: rows must be a list'; END IF;

  SELECT b.id, b.branch_id, b.status, b.payment_status, b.final_amount, b.is_locked, br.org_id AS org INTO v_b
    FROM public.bookings b JOIN public.branches br ON br.id = b.branch_id WHERE b.id = p_booking_id FOR UPDATE OF b;
  IF v_b.id IS NULL THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND: booking not found'; END IF;
  IF v_b.org IS DISTINCT FROM v_org
     OR (v_role <> 'admin' AND NOT (v_b.branch_id = ANY ((get_user_branch_ids())::uuid[]))) THEN
    RAISE EXCEPTION 'record_booking_payment: booking is not in your organization or branch';
  END IF;

  -- a retry of the same checkout attempt: hand back the first result (checked after the lock, so a parallel twin waits for it)
  SELECT * INTO v_req FROM public.payment_requests WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_req.booking_id <> p_booking_id THEN RAISE EXCEPTION 'record_booking_payment: this key was used for another booking'; END IF;
    RETURN jsonb_build_object('payment_ids', to_jsonb(v_req.payment_ids), 'replayed', true);
  END IF;

  -- ZNLY-234: a closed day no longer blocks a payment on its booking (it lands today; the closed report never changes).

  FOR v_row IN SELECT e FROM jsonb_array_elements(p_rows) e LOOP
    v_mode := btrim(COALESCE(v_row->>'payment_mode', ''));
    v_amt := round(COALESCE((v_row->>'amount')::numeric, -1), 2);
    IF v_mode = '' OR length(v_mode) > 40 THEN RAISE EXCEPTION 'INVALID_PAYMENT_MODE: Invalid payment method.'; END IF;
    IF v_mode IN ('Membership', 'ReferralWallet', 'ReferralVoucher', 'VoucherWallet') THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_MODE: % payments go through their own function.', v_mode;
    END IF;
    IF v_amt < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT: amount must not be negative'; END IF;
    v_total := v_total + v_amt;
  END LOOP;

  SELECT COALESCE(SUM(amount), 0) INTO v_collected FROM public.payments WHERE booking_id = p_booking_id;
  v_remaining := round(v_b.final_amount - v_collected, 2);

  IF v_total > 0 THEN
    IF v_b.payment_status = 'paid' OR v_remaining <= 0 THEN RAISE EXCEPTION 'ALREADY_PAID: Payment has already been recorded for this booking.'; END IF;
    IF v_b.status NOT IN ('Confirmed', 'In-Progress', 'Completed') THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_STATE: Payment can only be recorded for Confirmed, In-Progress, or Completed bookings.';
    END IF;
    IF v_total > v_remaining THEN RAISE EXCEPTION 'OVERPAYMENT: Payment exceeds the remaining balance.'; END IF;   -- no amounts in the text: price-restricted staff
  ELSIF v_remaining > 0 THEN
    RAISE EXCEPTION 'OVERPAYMENT: a zero payment can only settle a booking with nothing left to pay.';
  END IF;

  -- nothing left to pay and already settled: a zero settle is a no-op
  IF NOT (v_total = 0 AND v_b.payment_status = 'paid') THEN
    FOR v_row IN SELECT e FROM jsonb_array_elements(p_rows) e LOOP
      INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
      VALUES (p_booking_id, round((v_row->>'amount')::numeric, 2), btrim(v_row->>'payment_mode'), v_actor, CASE WHEN v_first THEN p_notes END)
      RETURNING id INTO v_id;
      v_ids := v_ids || v_id; v_first := false;
    END LOOP;
  END IF;

  INSERT INTO public.payment_requests (idempotency_key, booking_id, payment_ids, created_by) VALUES (p_idempotency_key, p_booking_id, v_ids, v_actor);
  RETURN jsonb_build_object('payment_ids', to_jsonb(v_ids), 'replayed', false);
END $function$;

CREATE OR REPLACE FUNCTION public.record_group_payment(p_payments jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role                user_role := get_user_role();
  v_org                 uuid      := get_user_org_id();
  v_entry                jsonb;
  v_tender                jsonb;
  v_booking_id            uuid;
  v_booking               record;
  v_branch_org            uuid;
  v_collected             numeric(10,2);
  v_remaining             numeric(10,2);
  v_notes                 text;
  v_due_holder            text;
  v_npr_tender_total      numeric(10,2);
  v_tender_amt            numeric(10,2);
  v_tender_mode           text;
  v_session_package_count int;
  v_session_package_residual numeric(10,2);
  v_session_package_share numeric(10,2);
  v_session_package_idx   int;
  v_session_package_distributed numeric(10,2);
  v_tender_total          numeric(10,2);
  v_leftover              numeric(10,2);
  v_other_count           int;
  v_membership_total      numeric(10,2);
  v_referral_wallet_total numeric(10,2);
  v_voucher_pool_total    numeric(10,2);
  v_any_prior             boolean;
  v_row_notes             text;
  v_payment_id            uuid;
  v_results               jsonb := '[]'::jsonb;
BEGIN
  IF v_role NOT IN ('staff','manager','admin') THEN
    RAISE EXCEPTION 'record_group_payment: staff, manager, or admin role required';
  END IF;

  IF p_payments IS NULL OR jsonb_typeof(p_payments) != 'array' OR jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'record_group_payment: p_payments must be a non-empty JSON array';
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    v_booking_id := (v_entry->>'booking_id')::uuid;
    v_notes := v_entry->>'notes';

    IF v_booking_id IS NULL THEN
      RAISE EXCEPTION 'record_group_payment: each entry requires a booking_id';
    END IF;

    -- Lock the row for the duration of this transaction — prevents two
    -- concurrent calls to THIS RPC from racing each other on the same
    -- booking. Does not protect against a concurrent plain recordPayment()
    -- call (src/services/api.js), which takes no lock — that race
    -- pre-exists this migration and isn't introduced or closed by it.
    SELECT b.id, b.branch_id, b.status, b.payment_status, b.final_amount,
           b.is_locked, b.due_holder_name
      INTO v_booking
      FROM public.bookings b
      WHERE b.id = v_booking_id
      FOR UPDATE;

    IF v_booking IS NULL THEN
      RAISE EXCEPTION 'record_group_payment: booking % not found', v_booking_id;
    END IF;

    SELECT org_id INTO v_branch_org FROM public.branches WHERE id = v_booking.branch_id;
    IF v_branch_org IS NULL OR v_branch_org IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'record_group_payment: booking % is not in your organization', v_booking_id;
    END IF;

    -- ZNLY-234: a closed day no longer blocks a payment on its booking (it lands today; the closed report never changes).

    IF v_booking.payment_status = 'paid' THEN
      RAISE EXCEPTION 'record_group_payment: booking % has already been paid', v_booking_id;
    END IF;

    IF v_booking.status NOT IN ('Confirmed','In-Progress','Completed') THEN
      RAISE EXCEPTION 'record_group_payment: booking % is not in a payable state (%)', v_booking_id, v_booking.status;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_collected
    FROM public.payments WHERE booking_id = v_booking_id;
    v_remaining := round((v_booking.final_amount - v_collected)::numeric, 2);

    -- Nothing left to collect (e.g. a 100%-discounted booking) but
    -- payment_status isn't 'paid' yet since no payments row exists — settle
    -- with a $0 row (same trigger-firing path recordPayment's own
    -- zero-balance branch uses) and move to the next booking.
    IF v_remaining <= 0 THEN
      INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
      VALUES (v_booking_id, 0, 'No Charge', auth.uid(), v_notes);

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'booking_id', v_booking_id, 'amount_paid', 0, 'amount_due', 0, 'fully_paid', true
      ));
      CONTINUE;
    END IF;

    -- Validate every non-SessionPackage tender (basic shape + required refs),
    -- mirroring recordPayment()'s per-tender validation loop.
    v_npr_tender_total := 0;
    FOR v_tender IN SELECT * FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
      WHERE (value->>'payment_mode') IS DISTINCT FROM 'SessionPackage'
    LOOP
      v_tender_amt := (v_tender->>'amount')::numeric;
      v_tender_mode := v_tender->>'payment_mode';

      IF v_tender_amt IS NULL OR v_tender_amt <= 0 THEN
        RAISE EXCEPTION 'record_group_payment: booking % — each tender amount must be greater than zero', v_booking_id;
      END IF;
      IF v_tender_mode IS NULL OR length(btrim(v_tender_mode)) = 0 OR length(v_tender_mode) > 40 THEN
        RAISE EXCEPTION 'record_group_payment: booking % — invalid payment method %', v_booking_id, v_tender_mode;
      END IF;
      IF v_tender_mode = 'ReferralVoucher' AND (v_tender->>'referral_id') IS NULL THEN
        RAISE EXCEPTION 'record_group_payment: booking % — missing referral reference for referral voucher tender', v_booking_id;
      END IF;

      v_npr_tender_total := round((v_npr_tender_total + v_tender_amt)::numeric, 2);
    END LOOP;

    -- SessionPackage shape validation (package_id required) runs BEFORE the
    -- overpayment check below, same order recordPayment() validates in —
    -- so a submission with both a missing package_id AND an overpaying
    -- non-package total gets the same "missing package reference" error
    -- either path would give, not a misleading OVERPAYMENT instead.
    SELECT count(*) INTO v_session_package_count
    FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
    WHERE value->>'payment_mode' = 'SessionPackage';

    FOR v_tender IN SELECT * FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
      WHERE value->>'payment_mode' = 'SessionPackage'
    LOOP
      IF (v_tender->>'package_id') IS NULL THEN
        RAISE EXCEPTION 'record_group_payment: booking % — missing package reference for session package tender', v_booking_id;
      END IF;
    END LOOP;

    IF v_npr_tender_total > v_remaining THEN
      RAISE EXCEPTION 'record_group_payment: booking % — payment (NPR %) exceeds remaining balance (NPR %)', v_booking_id, v_npr_tender_total, v_remaining;
    END IF;

    -- SessionPackage tenders settle whatever balance is left after every
    -- other tender above, split evenly (remainder to the last one) — same
    -- residual logic as recordPayment()'s sessionPackageAmounts.
    v_session_package_residual := round((v_remaining - v_npr_tender_total)::numeric, 2);
    v_session_package_share := 0;
    IF v_session_package_count > 0 THEN
      v_session_package_share := floor((v_session_package_residual / v_session_package_count) * 100) / 100;
    END IF;

    -- v_session_package_residual already IS remaining - npr_total (by
    -- construction, never more), so tenderTotal is exactly npr + residual —
    -- any rounding remainder is folded into the LAST session-package
    -- tender's row (handled per-row below), not into this running total.
    -- FIX (migration-346): the residual belongs to SessionPackage tenders only. It used to be added even with none, which made
    -- v_tender_total = the whole remaining balance and v_leftover always 0 (so a part payment reported amount_due 0 /
    -- fully_paid true and the due-holder check below never fired).
    v_tender_total := CASE WHEN v_session_package_count > 0
                           THEN round((v_npr_tender_total + v_session_package_residual)::numeric, 2)
                           ELSE round(v_npr_tender_total::numeric, 2) END;

    v_leftover := round((v_remaining - v_tender_total)::numeric, 2);
    v_due_holder := COALESCE(NULLIF(btrim(v_entry->>'due_holder_name'), ''), v_booking.due_holder_name);

    IF v_leftover > 0 AND v_due_holder IS NULL THEN
      RAISE EXCEPTION 'record_group_payment: booking % — a due holder name is required to leave a balance unpaid', v_booking_id;
    END IF;

    -- ---- Insert/redeem, one category at a time, exactly mirroring
    -- ---- recordPayment()'s step 9. `notes` is attached to whichever row
    -- ---- ends up first, tracked via v_any_prior.
    v_any_prior := false;

    -- "Other" (standard) tenders — plain payments rows.
    v_other_count := 0;
    FOR v_tender IN SELECT * FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
      WHERE value->>'payment_mode' NOT IN ('Membership','ReferralWallet','ReferralVoucher','VoucherWallet','SessionPackage')
    LOOP
      v_row_notes := CASE WHEN NOT v_any_prior THEN v_notes ELSE NULL END;
      INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
      VALUES (v_booking_id, (v_tender->>'amount')::numeric, v_tender->>'payment_mode', auth.uid(), v_row_notes);
      v_any_prior := true;
      v_other_count := v_other_count + 1;
    END LOOP;

    -- Membership — single pooled deduction.
    SELECT COALESCE(SUM((value->>'amount')::numeric), 0) INTO v_membership_total
    FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
    WHERE value->>'payment_mode' = 'Membership';

    IF v_membership_total > 0 THEN
      v_row_notes := CASE WHEN NOT v_any_prior THEN v_notes ELSE NULL END;
      PERFORM public.record_membership_payment(v_booking_id, v_membership_total, v_row_notes);
      v_any_prior := true;
    END IF;

    -- ReferralWallet — single pooled deduction.
    SELECT COALESCE(SUM((value->>'amount')::numeric), 0) INTO v_referral_wallet_total
    FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
    WHERE value->>'payment_mode' = 'ReferralWallet';

    IF v_referral_wallet_total > 0 THEN
      v_row_notes := CASE WHEN NOT v_any_prior THEN v_notes ELSE NULL END;
      PERFORM public.record_referral_wallet_payment(v_booking_id, v_referral_wallet_total, v_row_notes);
      v_any_prior := true;
    END IF;

    -- ReferralVoucher — one discrete redemption per tender (not poolable).
    FOR v_tender IN SELECT * FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
      WHERE value->>'payment_mode' = 'ReferralVoucher'
    LOOP
      PERFORM public.redeem_referral_voucher((v_tender->>'referral_id')::uuid, v_booking_id);
      v_any_prior := true;
    END LOOP;

    -- VoucherWallet with a voucher_id — one redemption per specific voucher.
    FOR v_tender IN SELECT * FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
      WHERE value->>'payment_mode' = 'VoucherWallet' AND (value->>'voucher_id') IS NOT NULL
    LOOP
      PERFORM public.record_voucher_wallet_payment(v_booking_id, (v_tender->>'voucher_id')::uuid, (v_tender->>'amount')::numeric, v_notes);
      v_any_prior := true;
    END LOOP;

    -- VoucherWallet with no voucher_id — pooled draw across the customer's vouchers.
    SELECT COALESCE(SUM((value->>'amount')::numeric), 0) INTO v_voucher_pool_total
    FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
    WHERE value->>'payment_mode' = 'VoucherWallet' AND (value->>'voucher_id') IS NULL;

    IF v_voucher_pool_total > 0 THEN
      v_row_notes := CASE WHEN NOT v_any_prior THEN v_notes ELSE NULL END;
      PERFORM public.record_voucher_wallet_payment_pooled(v_booking_id, v_voucher_pool_total, v_row_notes);
      v_any_prior := true;
    END IF;

    -- SessionPackage — one redemption per tender, each posting its own
    -- payments row (redeem_package_session itself inserts no payments row).
    v_session_package_idx := 0;
    v_session_package_distributed := 0;
    FOR v_tender IN SELECT * FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
      WHERE value->>'payment_mode' = 'SessionPackage'
    LOOP
      v_session_package_idx := v_session_package_idx + 1;
      PERFORM public.redeem_package_session(
        p_package_id := (v_tender->>'package_id')::uuid,
        p_booking_id := v_booking_id,
        p_branch_claimed_id := v_booking.branch_id
      );

      v_row_notes := CASE WHEN NOT v_any_prior THEN v_notes ELSE NULL END;
      IF v_session_package_idx = v_session_package_count THEN
        -- Last one absorbs any rounding remainder, same as recordPayment().
        INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
        VALUES (v_booking_id, v_session_package_residual - v_session_package_distributed, 'SessionPackage', auth.uid(), v_row_notes);
      ELSE
        INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
        VALUES (v_booking_id, v_session_package_share, 'SessionPackage', auth.uid(), v_row_notes);
        v_session_package_distributed := round((v_session_package_distributed + v_session_package_share)::numeric, 2);
      END IF;
      v_any_prior := true;
    END LOOP;

    -- ZNLY-234: on a closed-day booking the responsible person cannot be (re)written, the payment itself still goes through
    IF v_due_holder IS DISTINCT FROM v_booking.due_holder_name AND NOT v_booking.is_locked THEN
      UPDATE public.bookings SET due_holder_name = v_due_holder WHERE id = v_booking_id;
    END IF;

    -- Non-blocking referral credit, matching recordPayment()'s step 10 —
    -- a crediting failure must never abort the payment itself.
    IF v_leftover = 0 THEN
      BEGIN
        PERFORM public.credit_pending_referral_for_booking(v_booking_id);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'booking_id', v_booking_id,
      'amount_paid', v_tender_total,
      'amount_due', v_leftover,
      'fully_paid', v_leftover = 0
    ));
  END LOOP;

  RETURN v_results;
END;
$function$;

CREATE OR REPLACE FUNCTION public.checkout_booking_with_products(p_booking_id uuid, p_tenders jsonb, p_products jsonb, p_notes text DEFAULT NULL::text, p_due_holder_name text DEFAULT NULL::text, p_additional jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role user_role := get_user_role(); v_org uuid := get_user_org_id();
  v_b record; v_line jsonb; v_lines jsonb := '[]'::jsonb; v_price numeric(10,2); v_var record;
  v_total numeric(10,2) := 0; v_need numeric(10,2); v_t jsonb; v_mode text; v_amt numeric(10,2); v_take numeric(10,2);
  v_treat jsonb := '[]'::jsonb; v_sl_mode text[] := '{}'; v_sl_amt numeric[] := '{}'; v_seen uuid[] := '{}';
  v_line_total numeric(10,2); v_pays jsonb; v_i integer; v_left numeric(10,2); v_member numeric(10,2) := 0;
  v_sale public.product_sales; v_sales jsonb := '[]'::jsonb; v_pay_result jsonb; v_entry jsonb; v_before integer; v_after integer;
  v_prod_pays jsonb := '[]'::jsonb; v_given numeric(10,2) := 0;
  v_tm text[]; v_ta numeric[]; v_tj jsonb[]; v_pass integer; v_i2 integer;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('staff', 'manager', 'admin') THEN
    RAISE EXCEPTION 'checkout_booking_with_products: staff, manager, or admin role required';
  END IF;

  SELECT b.id, b.branch_id, b.customer_id, b.status, b.is_locked, br.org_id AS org INTO v_b
    FROM public.bookings b JOIN public.branches br ON br.id = b.branch_id WHERE b.id = p_booking_id FOR UPDATE OF b;
  IF v_b.id IS NULL THEN RAISE EXCEPTION 'checkout_booking_with_products: booking not found'; END IF;
  IF v_b.org IS DISTINCT FROM v_org THEN RAISE EXCEPTION 'checkout_booking_with_products: booking is not in your organization'; END IF;
  IF jsonb_typeof(COALESCE(p_tenders, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'checkout_booking_with_products: tenders must be a list'; END IF;
  IF p_products IS NOT NULL AND jsonb_typeof(p_products) <> 'array' THEN RAISE EXCEPTION 'checkout_booking_with_products: products must be a list'; END IF;

  -- 1. Price every line from the database (never from the client). Sorted by size so two checkouts lock in the same order.
  FOR v_line IN SELECT e FROM jsonb_array_elements(COALESCE(p_products, '[]'::jsonb)) e ORDER BY e->>'variant_id' LOOP
    IF (v_line->>'variant_id') IS NULL OR COALESCE((v_line->>'qty')::integer, 0) <= 0 THEN
      RAISE EXCEPTION 'Each product line needs a size and a quantity above zero.';
    END IF;
    IF (v_line->>'variant_id')::uuid = ANY (v_seen) THEN RAISE EXCEPTION 'The same product appears twice; use the quantity instead.'; END IF;
    v_seen := v_seen || (v_line->>'variant_id')::uuid;
    SELECT pv.id, pv.retail_price, p.name INTO v_var FROM public.product_variants pv JOIN public.products p ON p.id = pv.product_id
     WHERE pv.id = (v_line->>'variant_id')::uuid AND pv.org_id = v_org;
    IF v_var.id IS NULL THEN RAISE EXCEPTION 'That product was not found in your organization.'; END IF;
    v_price := round(v_var.retail_price * (v_line->>'qty')::integer, 2);
    v_total := round(v_total + v_price, 2);
    v_lines := v_lines || jsonb_build_array(v_line || jsonb_build_object('line_total', v_price));
  END LOOP;

  -- 2. Allocate the tenders. Treatment-only credits never pay products. PLAIN money methods (cash, card, wallets of the org's list...)
  --    fill the products first, in the order listed; the Membership wallet only covers what they leave unpaid; the treatment gets
  --    whatever is left, in the original order (so by default the wallet goes to the treatment).
  v_need := v_total;
  SELECT array_agg(x.e->>'payment_mode' ORDER BY x.o), array_agg(round(COALESCE((x.e->>'amount')::numeric, 0), 2) ORDER BY x.o), array_agg(x.e ORDER BY x.o)
    INTO v_tm, v_ta, v_tj
    FROM jsonb_array_elements(COALESCE(p_tenders, '[]'::jsonb)) WITH ORDINALITY AS x(e, o);
  FOR v_pass IN 1 .. 2 LOOP                      -- pass 1: plain money, pass 2: the Membership wallet
    FOR v_i IN 1 .. COALESCE(array_length(v_tm, 1), 0) LOOP
      CONTINUE WHEN v_need <= 0 OR v_ta[v_i] <= 0 OR public._is_treatment_only_mode(v_tm[v_i]);
      CONTINUE WHEN (v_pass = 1) = (v_tm[v_i] = 'Membership');
      v_take := least(v_ta[v_i], v_need);
      v_sl_mode := v_sl_mode || v_tm[v_i]; v_sl_amt := v_sl_amt || v_take;
      v_prod_pays := v_prod_pays || jsonb_build_array(jsonb_build_object('payment_mode', v_tm[v_i], 'amount', v_take));
      v_ta[v_i] := round(v_ta[v_i] - v_take, 2);
      v_need := round(v_need - v_take, 2);
    END LOOP;
  END LOOP;
  FOR v_i IN 1 .. COALESCE(array_length(v_tm, 1), 0) LOOP
    IF v_ta[v_i] > 0 THEN v_treat := v_treat || jsonb_set(v_tj[v_i], '{amount}', to_jsonb(v_ta[v_i])); END IF;
  END LOOP;
  IF v_need > 0 THEN
    SELECT COALESCE(SUM(round((e->>'amount')::numeric, 2)), 0) INTO v_given FROM jsonb_array_elements(COALESCE(p_tenders, '[]'::jsonb)) e
     WHERE NOT public._is_treatment_only_mode(e->>'payment_mode');
    RAISE EXCEPTION 'Products are paid in full today: they come to NPR %, but cash, card, wallets and the membership wallet only cover NPR %. Vouchers and packages pay the treatment only.', v_total, v_given
      USING ERRCODE = 'P0001', HINT = 'PRODUCTS_UNDERPAID';
  END IF;

  -- 3. Products (only when there are some)
  IF v_total > 0 THEN
    IF public._inv_day_locked(v_b.branch_id) THEN RAISE EXCEPTION 'Today has been closed at this branch, so products cannot be sold.'; END IF;
    IF v_b.is_locked THEN RAISE EXCEPTION 'DAY_LOCKED: This booking''s day has been closed. Only the balance can be collected; products cannot be added.'; END IF;   -- ZNLY-234
    IF v_b.status IN ('Cancelled', 'No Show') THEN RAISE EXCEPTION 'This booking was %.', lower(v_b.status); END IF;

    SELECT COALESCE(SUM(a), 0) INTO v_member FROM unnest(v_sl_mode, v_sl_amt) AS s(m, a) WHERE m = 'Membership';
    IF v_member > 0 THEN PERFORM public._checkout_membership_deduct(p_booking_id, v_member); END IF;

    FOR v_line IN SELECT e FROM jsonb_array_elements(v_lines) e LOOP
      -- take this line's share from the product slices, in order
      v_line_total := (v_line->>'line_total')::numeric; v_left := v_line_total; v_pays := '[]'::jsonb;
      FOR v_i IN 1 .. COALESCE(array_length(v_sl_mode, 1), 0) LOOP
        EXIT WHEN v_left <= 0;
        CONTINUE WHEN v_sl_amt[v_i] <= 0;
        v_take := least(v_sl_amt[v_i], v_left);
        v_pays := v_pays || jsonb_build_array(jsonb_build_object('payment_mode', v_sl_mode[v_i], 'amount', v_take));
        v_sl_amt[v_i] := round(v_sl_amt[v_i] - v_take, 2); v_left := round(v_left - v_take, 2);
      END LOOP;

      v_before := COALESCE((SELECT quantity FROM public.product_branch_stock
                             WHERE variant_id = (v_line->>'variant_id')::uuid AND branch_id = v_b.branch_id), 0);
      v_sale := public._sell_product_line((v_line->>'variant_id')::uuid, (v_line->>'qty')::integer, v_b.branch_id, v_b.customer_id, p_booking_id,
                                          NULLIF(v_line->>'sold_by_therapist_id', '')::uuid, v_pays, NULL, NULL);
      v_after := COALESCE((SELECT quantity FROM public.product_branch_stock WHERE variant_id = v_sale.variant_id AND branch_id = v_b.branch_id), 0);
      v_sales := v_sales || jsonb_build_array(jsonb_build_object(
        'id', v_sale.id, 'variant_id', v_sale.variant_id, 'product_name', v_sale.product_name, 'variant_name', v_sale.variant_name,
        'quantity', v_sale.quantity, 'unit_price', v_sale.unit_price_npr, 'total_amount', v_sale.total_amount,
        'stock_before', v_before, 'stock_after', v_after, 'sold_by_therapist_id', v_sale.sold_by_therapist_id));
    END LOOP;
  END IF;

  -- 4. The treatment: exactly the existing group payment, with what the products left over.
  v_entry := jsonb_build_object('booking_id', p_booking_id, 'tenders', v_treat, 'notes', p_notes);
  IF NULLIF(btrim(COALESCE(p_due_holder_name, '')), '') IS NOT NULL THEN v_entry := v_entry || jsonb_build_object('due_holder_name', p_due_holder_name); END IF;
  v_pay_result := public.record_group_payment(jsonb_build_array(v_entry) || COALESCE(p_additional, '[]'::jsonb));

  RETURN jsonb_build_object('payments', v_pay_result, 'sales', v_sales, 'products_total', v_total, 'product_payments', v_prod_pays);
END $function$;

-- ---- 2. Close Day refused while a booking is unfinished ----
CREATE OR REPLACE FUNCTION public.day_unfinished_bookings(p_branch_id uuid, p_date date)
RETURNS TABLE (booking_id uuid, booking_number text, customer_name text, status text, start_time time)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT b.id, b.booking_number, b.customer_name, b.status::text, b.start_time
    FROM public.bookings b JOIN public.branches br ON br.id = b.branch_id
   WHERE b.branch_id = p_branch_id AND b.date = p_date AND b.status IN ('Pending', 'Confirmed', 'In-Progress')
     AND br.org_id = public.get_user_org_id()
     AND public.get_user_role() IN ('manager', 'admin')
     AND (public.get_user_role() = 'admin' OR p_branch_id = ANY ((public.get_user_branch_ids())::uuid[]))
   ORDER BY b.start_time, b.booking_number;
$$;
REVOKE ALL ON FUNCTION public.day_unfinished_bookings(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.day_unfinished_bookings(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.daily_reports_refuse_unfinished()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_n int; v_list text;
BEGIN
  SELECT count(*), string_agg(b.booking_number, ', ' ORDER BY b.start_time, b.booking_number) INTO v_n, v_list
    FROM public.bookings b
   WHERE b.branch_id = NEW.branch_id AND b.date = NEW.report_date AND b.status IN ('Pending', 'Confirmed', 'In-Progress');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'DAY_HAS_UNFINISHED: % booking(s) are still Pending, Confirmed or In-Progress (%). Complete, cancel or mark them no-show before closing the day.', v_n, v_list
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_daily_reports_refuse_unfinished ON public.daily_reports;
CREATE TRIGGER trg_daily_reports_refuse_unfinished BEFORE INSERT ON public.daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.daily_reports_refuse_unfinished();


-- ---- 3. wallet / voucher / package tenders on a closed-day booking (owner rule: paying the balance stays possible) ----
-- Wallet tenders are not money in (ZNLY-232), so the closed day's figures are unaffected. Price, discount, status, staff and products stay blocked.
CREATE OR REPLACE FUNCTION public.record_referral_wallet_payment(p_booking_id uuid, p_amount numeric, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_org    uuid := get_user_org_id();
  v_actor         uuid := auth.uid();
  v_customer_id   uuid;
  v_booking_org   uuid;
  v_is_locked     boolean;
  v_balance       numeric(12,2);
  v_payment_id    uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'record_referral_wallet_payment: must be signed in';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'record_referral_wallet_payment: amount must be positive';
  END IF;

  SELECT b.customer_id, br.org_id, b.is_locked
    INTO v_customer_id, v_booking_org, v_is_locked
  FROM public.bookings b
  JOIN public.branches br ON br.id = b.branch_id
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;

  IF v_booking_org IS NULL THEN
    RAISE EXCEPTION 'record_referral_wallet_payment: booking % not found', p_booking_id;
  END IF;

  IF v_booking_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_referral_wallet_payment: booking is not in your organization';
  END IF;

  -- ZNLY-234: paying the balance with a wallet / voucher stays allowed on a closed-day booking (wallets are not money in, the closed day is unaffected).

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'record_referral_wallet_payment: booking has no linked customer';
  END IF;

  -- Lock the customer row so a concurrent wallet payment on a DIFFERENT
  -- booking for the same customer can't race the balance check below —
  -- the booking-row lock above only serializes calls on this booking_id.
  PERFORM 1 FROM public.customers WHERE id = v_customer_id FOR UPDATE;

  -- Re-derive the balance server-side rather than trusting the client's read —
  -- never trust a client-computed balance for a spend.
  v_balance := public.get_referral_credit_balance(v_customer_id);

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'record_referral_wallet_payment: insufficient referral wallet balance (have %, need %)',
      v_balance, p_amount;
  END IF;

  INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
  VALUES (p_booking_id, p_amount, 'ReferralWallet', v_actor, p_notes)
  RETURNING id INTO v_payment_id;

  INSERT INTO public.customer_referral_debits
    (org_id, customer_id, amount, booking_id, payment_id, created_by)
  VALUES
    (v_caller_org, v_customer_id, p_amount, p_booking_id, v_payment_id, v_actor);

  RETURN v_payment_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_voucher_wallet_payment(p_booking_id uuid, p_voucher_id uuid, p_amount numeric, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_org      uuid := get_user_org_id();
  v_actor           uuid := auth.uid();
  v_booking_org     uuid;
  v_branch_id       uuid;
  v_customer_name   text;
  v_is_locked       boolean;
  v_voucher_org     uuid;
  v_total_issued    numeric(10,2);
  v_expiry_date     date;
  v_already_claimed numeric(10,2);
  v_payment_id      uuid;
  v_claim_id        uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment: must be signed in';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment: amount must be positive';
  END IF;

  SELECT br.org_id, b.branch_id, b.customer_name, b.is_locked
    INTO v_booking_org, v_branch_id, v_customer_name, v_is_locked
  FROM public.bookings b
  JOIN public.branches br ON br.id = b.branch_id
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;

  IF v_booking_org IS NULL THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment: booking % not found', p_booking_id;
  END IF;

  IF v_booking_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment: booking is not in your organization';
  END IF;

  -- ZNLY-234: paying the balance with a wallet / voucher stays allowed on a closed-day booking (wallets are not money in, the closed day is unaffected).

  -- Lock the voucher row so a concurrent claim/payment can't race the balance check.
  SELECT org_id, total_amount_issued, expiry_date
    INTO v_voucher_org, v_total_issued, v_expiry_date
  FROM public.vouchers
  WHERE id = p_voucher_id
  FOR UPDATE;

  IF v_voucher_org IS NULL THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment: voucher % not found', p_voucher_id;
  END IF;
  IF v_voucher_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment: voucher is not in your organization';
  END IF;

  IF v_expiry_date < (now() AT TIME ZONE 'Asia/Kathmandu')::date THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment: voucher expired on %', v_expiry_date;
  END IF;

  -- Re-derive the balance server-side rather than trusting the client's read —
  -- never trust a client-computed balance for a spend.
  SELECT COALESCE(SUM(amount_claimed), 0) INTO v_already_claimed
  FROM public.voucher_claims
  WHERE voucher_id = p_voucher_id;

  IF p_amount > (v_total_issued - v_already_claimed) THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment: amount % exceeds remaining voucher balance %',
      p_amount, (v_total_issued - v_already_claimed);
  END IF;

  INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
  VALUES (p_booking_id, p_amount, 'VoucherWallet', v_actor, p_notes)
  RETURNING id INTO v_payment_id;

  INSERT INTO public.voucher_claims (
    voucher_id, org_id, redeemed_date, guest_name_used_by, service_claimed,
    branch_claimed_id, amount_claimed, notes, performed_by, booking_id, payment_id
  )
  VALUES (
    p_voucher_id, v_caller_org, (now() AT TIME ZONE 'Asia/Kathmandu')::date, v_customer_name, NULL,
    v_branch_id, p_amount, p_notes, v_actor, p_booking_id, v_payment_id
  )
  RETURNING id INTO v_claim_id;

  RETURN v_payment_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_voucher_wallet_payment_pooled(p_booking_id uuid, p_amount numeric, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_org        uuid := get_user_org_id();
  v_actor             uuid := auth.uid();
  v_booking_org       uuid;
  v_branch_id         uuid;
  v_customer_id       uuid;
  v_customer_name     text;
  v_is_locked         boolean;
  v_payment_id        uuid;
  v_remaining         numeric(10,2);
  v_take              numeric(10,2);
  v_voucher_id        uuid;
  v_total_issued      numeric(10,2);
  v_already_claimed   numeric(10,2);
  v_voucher_remaining numeric(10,2);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment_pooled: must be signed in';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment_pooled: amount must be positive';
  END IF;

  SELECT br.org_id, b.branch_id, b.customer_id, b.customer_name, b.is_locked
    INTO v_booking_org, v_branch_id, v_customer_id, v_customer_name, v_is_locked
  FROM public.bookings b
  JOIN public.branches br ON br.id = b.branch_id
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;

  IF v_booking_org IS NULL THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment_pooled: booking % not found', p_booking_id;
  END IF;
  IF v_booking_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment_pooled: booking is not in your organization';
  END IF;
  -- ZNLY-234: paying the balance with a wallet / voucher stays allowed on a closed-day booking (wallets are not money in, the closed day is unaffected).
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment_pooled: this booking has no linked customer account';
  END IF;

  INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
  VALUES (p_booking_id, p_amount, 'VoucherWallet', v_actor, p_notes)
  RETURNING id INTO v_payment_id;

  v_remaining := p_amount;

  -- Lock soonest-expiring vouchers first (so nothing is left to expire
  -- unused), one row at a time via the cursor's FOR UPDATE -- no join here,
  -- so the lock is acquired against the bare voucher row, exactly like
  -- record_voucher_wallet_payment's single-voucher lock.
  FOR v_voucher_id, v_total_issued IN
    SELECT v.id, v.total_amount_issued
    FROM public.vouchers v
    WHERE v.customer_id = v_customer_id
      AND v.org_id = v_caller_org
      AND v.expiry_date >= (now() AT TIME ZONE 'Asia/Kathmandu')::date
    ORDER BY v.expiry_date ASC, v.created_at ASC
    FOR UPDATE OF v
  LOOP
    EXIT WHEN v_remaining <= 0;

    -- Row is locked now -- re-derive the balance server-side rather than
    -- trusting anything computed before the lock. Any concurrent claim
    -- against this voucher (pooled or single) must already have committed
    -- (and released the lock) or be blocked waiting behind us, so this SUM
    -- is guaranteed accurate.
    SELECT COALESCE(SUM(amount_claimed), 0) INTO v_already_claimed
    FROM public.voucher_claims
    WHERE voucher_id = v_voucher_id;

    v_voucher_remaining := v_total_issued - v_already_claimed;
    IF v_voucher_remaining <= 0 THEN
      CONTINUE;
    END IF;

    v_take := LEAST(v_remaining, v_voucher_remaining);

    INSERT INTO public.voucher_claims (
      voucher_id, org_id, redeemed_date, guest_name_used_by, service_claimed,
      branch_claimed_id, amount_claimed, notes, performed_by, booking_id, payment_id
    )
    VALUES (
      v_voucher_id, v_caller_org, (now() AT TIME ZONE 'Asia/Kathmandu')::date, v_customer_name, NULL,
      v_branch_id, v_take, p_notes, v_actor, p_booking_id, v_payment_id
    );

    v_remaining := round(v_remaining - v_take, 2);
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment_pooled: amount % exceeds combined voucher balance (short by %)',
      p_amount, v_remaining;
  END IF;

  RETURN v_payment_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.redeem_referral_voucher(p_referral_id uuid, p_booking_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_org      uuid := get_user_org_id();
  v_actor           uuid := auth.uid();
  v_referral_org    uuid;
  v_referring_cust  uuid;
  v_reward_type     text;
  v_reward_status   text;
  v_redeemed_at     timestamptz;
  v_catalog_value   numeric(12,2);
  v_requested       numeric(12,2);
  v_value           numeric(12,2);
  v_booking_org     uuid;
  v_booking_customer uuid;
  v_is_locked       boolean;
  v_payment_id      uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'redeem_referral_voucher: must be signed in';
  END IF;

  SELECT cr.org_id, cr.referring_customer_id, cr.reward_type, cr.reward_status,
         cr.redeemed_at, rc.value, cr.requested_reward_amount
    INTO v_referral_org, v_referring_cust, v_reward_type, v_reward_status,
         v_redeemed_at, v_catalog_value, v_requested
  FROM public.customer_referrals cr
  LEFT JOIN public.reward_catalog rc ON rc.id = cr.reward_catalog_id
  WHERE cr.id = p_referral_id
  FOR UPDATE OF cr;

  IF v_referral_org IS NULL THEN
    RAISE EXCEPTION 'redeem_referral_voucher: referral % not found', p_referral_id;
  END IF;
  IF v_referral_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'redeem_referral_voucher: referral is not in your organization';
  END IF;
  IF v_reward_type IS DISTINCT FROM 'voucher' THEN
    RAISE EXCEPTION 'redeem_referral_voucher: referral % is not a voucher reward', p_referral_id;
  END IF;
  IF v_reward_status IS DISTINCT FROM 'credited' THEN
    RAISE EXCEPTION 'redeem_referral_voucher: reward has not been credited yet';
  END IF;
  IF v_redeemed_at IS NOT NULL THEN
    RAISE EXCEPTION 'redeem_referral_voucher: voucher has already been redeemed';
  END IF;

  SELECT b.customer_id, br.org_id, b.is_locked
    INTO v_booking_customer, v_booking_org, v_is_locked
  FROM public.bookings b
  JOIN public.branches br ON br.id = b.branch_id
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;

  IF v_booking_org IS NULL THEN
    RAISE EXCEPTION 'redeem_referral_voucher: booking % not found', p_booking_id;
  END IF;
  IF v_booking_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'redeem_referral_voucher: booking is not in your organization';
  END IF;
  -- ZNLY-234: paying the balance with a wallet / voucher stays allowed on a closed-day booking (wallets are not money in, the closed day is unaffected).
  IF v_booking_customer IS DISTINCT FROM v_referring_cust THEN
    RAISE EXCEPTION 'redeem_referral_voucher: voucher belongs to a different customer than this booking';
  END IF;

  v_value := COALESCE(v_catalog_value, v_requested);
  IF v_value IS NULL OR v_value <= 0 THEN
    RAISE EXCEPTION 'redeem_referral_voucher: voucher has no redeemable value';
  END IF;

  INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
  VALUES (p_booking_id, v_value, 'ReferralVoucher', v_actor, NULL)
  RETURNING id INTO v_payment_id;

  UPDATE public.customer_referrals
     SET redeemed_at         = now(),
         redeemed_booking_id = p_booking_id,
         redeemed_by         = v_actor
   WHERE id = p_referral_id;

  RETURN v_payment_id;
END;
$function$;


-- ---- 4. "Collected after close": money taken after a branch closed that day, for the dashboard + the closed-day reconciliation ----
-- _dashboard_money_in now also says which branch and WHEN each row was taken; _dashboard_refund_rows does the same for refunds.
DROP FUNCTION IF EXISTS public._dashboard_money_in(uuid[], date);
CREATE OR REPLACE FUNCTION public._dashboard_money_in(p_branches uuid[], p_day date)
RETURNS TABLE (payment_mode text, amount numeric, src text, branch_id uuid, at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH w AS (SELECT p_day::timestamp AT TIME ZONE 'Asia/Kathmandu' AS d0, (p_day + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu' AS d1),
  skip AS (SELECT unnest(ARRAY['Membership', 'ReferralWallet', 'VoucherWallet', 'ReferralVoucher', 'SessionPackage']) AS m)
  SELECT public._dashboard_canon_mode(x.payment_mode) AS payment_mode, x.amount, x.src, x.branch_id, x.at FROM (
    SELECT p.payment_mode, p.amount, 'booking'::text AS src, pb.branch_id, p.created_at AS at FROM public.payments p JOIN public.bookings pb ON pb.id = p.booking_id, w
     WHERE pb.branch_id = ANY (p_branches) AND p.created_at >= w.d0 AND p.created_at < w.d1
    UNION ALL
    SELECT sp.payment_mode, sp.amount, 'product', ps.branch_id, sp.created_at FROM public.product_sale_payments sp JOIN public.product_sales ps ON ps.id = sp.sale_id, w
     WHERE ps.branch_id = ANY (p_branches) AND ps.refunded_at IS NULL AND ps.created_at >= w.d0 AND ps.created_at < w.d1
    UNION ALL
    SELECT vp.payment_mode, vp.amount, 'voucher', v.branch_id, vp.created_at FROM public.voucher_payments vp JOIN public.vouchers v ON v.id = vp.voucher_id
     WHERE v.branch_id = ANY (p_branches) AND v.issued_date = p_day
    UNION ALL
    SELECT COALESCE(mt.payment_mode, 'Cash'), mt.amount, 'membership', mt.branch_id, mt.created_at FROM public.membership_transactions mt, w
     WHERE mt.kind = 'deposit' AND mt.branch_id = ANY (p_branches) AND mt.created_at >= w.d0 AND mt.created_at < w.d1
    UNION ALL
    SELECT COALESCE(pk.payment_method, 'Cash'), pk.paid_amount, 'package', pk.branch_id, pk.created_at FROM public.packages pk
     WHERE pk.branch_id = ANY (p_branches) AND pk.issued_date = p_day
  ) x WHERE public._dashboard_canon_mode(x.payment_mode) NOT IN (SELECT m FROM skip) AND x.amount <> 0;
$$;
REVOKE ALL ON FUNCTION public._dashboard_money_in(uuid[], date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._dashboard_refund_rows(p_branches uuid[], p_day date)
RETURNS TABLE (amount numeric, branch_id uuid, at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH w AS (SELECT p_day::timestamp AT TIME ZONE 'Asia/Kathmandu' AS d0, (p_day + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu' AS d1)
  SELECT rf.amount, rb.branch_id, rf.created_at FROM public.payment_refunds rf JOIN public.bookings rb ON rb.id = rf.booking_id, w
   WHERE rb.branch_id = ANY (p_branches) AND rf.created_at >= w.d0 AND rf.created_at < w.d1
  UNION ALL
  SELECT sp.amount, ps.branch_id, ps.refunded_at FROM public.product_sale_payments sp JOIN public.product_sales ps ON ps.id = sp.sale_id, w
   WHERE ps.branch_id = ANY (p_branches) AND ps.refunded_at >= w.d0 AND ps.refunded_at < w.d1 AND ps.created_at < w.d0
     AND public._dashboard_canon_mode(sp.payment_mode) NOT IN ('Membership', 'ReferralWallet', 'VoucherWallet', 'ReferralVoucher', 'SessionPackage');
$$;
REVOKE ALL ON FUNCTION public._dashboard_refund_rows(uuid[], date) FROM PUBLIC, anon, authenticated;

-- Money taken AFTER each branch closed p_day (net of refunds made after the close), and the cash part of it. Zero when no branch closed that day.
CREATE OR REPLACE FUNCTION public._dashboard_after_close(p_branches uuid[], p_day date)
RETURNS TABLE (amount numeric, cash numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH closed AS (SELECT dr.branch_id, dr.closed_at FROM public.daily_reports dr WHERE dr.branch_id = ANY (p_branches) AND dr.report_date = p_day),
  i AS (SELECT mi.payment_mode, mi.amount FROM public._dashboard_money_in(p_branches, p_day) mi JOIN closed c ON c.branch_id = mi.branch_id AND mi.at > c.closed_at),
  r AS (SELECT rr.amount FROM public._dashboard_refund_rows(p_branches, p_day) rr JOIN closed c ON c.branch_id = rr.branch_id AND rr.at > c.closed_at)
  SELECT COALESCE((SELECT sum(amount) FROM i), 0) - COALESCE((SELECT sum(amount) FROM r), 0),
         COALESCE((SELECT sum(amount) FROM i WHERE payment_mode = 'Cash'), 0) - COALESCE((SELECT sum(amount) FROM r), 0);
$$;
REVOKE ALL ON FUNCTION public._dashboard_after_close(uuid[], date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._dashboard_refunds(p_branches uuid[], p_day date)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT COALESCE(sum(amount), 0) FROM public._dashboard_refund_rows(p_branches, p_day); $$;
REVOKE ALL ON FUNCTION public._dashboard_refunds(uuid[], date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_dashboard(p_branch_ids uuid[], p_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_role    text;
  v_org     uuid;
  v_date    date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Kathmandu')::date);
  v_now_min int  := (EXTRACT(EPOCH FROM (now() AT TIME ZONE 'Asia/Kathmandu')::time) / 60)::int;
  v_now     timestamptz := now();
  v_is_today boolean := v_date = (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_money   boolean;
  v_ids     uuid[];
  v_mine    uuid[];
  d0 timestamptz; d1 timestamptz;
  v_pulse jsonb; v_floor jsonb := '[]'; v_week jsonb; v_branches jsonb; v_money_j jsonb;
  v_tomorrow jsonb; v_my jsonb;
  r record; rr jsonb; v_cursor int; v_busy int; v_blocks jsonb; v_gaps jsonb; v_state text; v_list jsonb := '[]'; v_sh jsonb;
  v_f int; v_e int; v_k text;
  v_prev date; v_sh_prev jsonb; v_prev_rev numeric; v_prev_share numeric;
BEGIN
  SELECT u.role::text, u.org_id INTO v_role, v_org FROM public.users u WHERE u.id = v_uid;
  IF v_role IS NULL THEN RETURN '{}'::jsonb; END IF;
  v_money := v_role IN ('manager', 'admin', 'admin_viewer');
  d0 := v_date::timestamp AT TIME ZONE 'Asia/Kathmandu';
  d1 := (v_date + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu';

  SELECT COALESCE(array_agg(br.id), '{}') INTO v_ids
    FROM public.branches br
   WHERE br.org_id = v_org
     AND br.id = ANY (COALESCE(p_branch_ids, '{}'))
     AND (v_role IN ('admin', 'admin_viewer') OR br.id = ANY (public.get_user_branch_ids()));
  IF cardinality(v_ids) = 0 THEN RETURN '{}'::jsonb; END IF;

  -- pulse: today's bookings by state, and (money roles) what was collected --------------------------------------------
  SELECT jsonb_build_object(
           'bookings',    count(*) FILTER (WHERE bk.status <> 'Cancelled'),
           'pending',     count(*) FILTER (WHERE bk.status = 'Pending'),
           'confirmed',   count(*) FILTER (WHERE bk.status = 'Confirmed'),
           'in_progress', count(*) FILTER (WHERE bk.status = 'In-Progress'),
           'completed',   count(*) FILTER (WHERE bk.status = 'Completed'),
           'cancelled',   count(*) FILTER (WHERE bk.status = 'Cancelled'),
           'no_show',     count(*) FILTER (WHERE bk.status = 'No Show'),
           -- late: start time passed (Nepal time) and still Pending/Confirmed, so "to come" = pending + confirmed - late
           'late',        count(*) FILTER (WHERE v_is_today AND bk.status IN ('Pending', 'Confirmed') AND bk.start_time < (now() AT TIME ZONE 'Asia/Kathmandu')::time),
           'revenue',     CASE WHEN v_money THEN public._dashboard_net(v_ids, v_date) END)
    INTO v_pulse
    FROM public.bookings bk WHERE bk.branch_id = ANY (v_ids) AND bk.date = v_date;

  -- shifts: the availability rule once per branch for the whole 7-day window; floor, week, branches and tomorrow all read this ----
  SELECT COALESCE(jsonb_agg(to_jsonb(s) || jsonb_build_object('branch_id', bid)), '[]') INTO v_sh
    FROM unnest(v_ids) bid CROSS JOIN LATERAL public.therapist_shifts_for_range(bid, v_date, v_date + 6) s;

  -- same weekday last week, for the pulse comparisons (revenue only for money roles; booked share from the same shift rule)
  v_prev := v_date - 7;
  SELECT COALESCE(jsonb_agg(to_jsonb(s) || jsonb_build_object('branch_id', bid)), '[]') INTO v_sh_prev
    FROM unnest(v_ids) bid CROSS JOIN LATERAL public.therapist_shifts_for_range(bid, v_prev, v_prev) s;
  IF v_money THEN
    v_prev_rev := CASE WHEN EXISTS (SELECT 1 FROM public._dashboard_money_in(v_ids, v_prev)) THEN public._dashboard_net(v_ids, v_prev) END;  -- no money in that day: "no data", not a 0 baseline
  END IF;
  SELECT CASE WHEN a.avail > 0 THEN round(COALESCE(bk.booked, 0)::numeric / a.avail, 3) END INTO v_prev_share
    FROM (SELECT COALESCE(sum(GREATEST(0, (EXTRACT(EPOCH FROM x.end_time - x.start_time) / 60)::int
                 - COALESCE((SELECT sum((y->>'end_min')::int - (y->>'start_min')::int) FROM jsonb_array_elements(x.breaks) y), 0)
                 - COALESCE((SELECT sum((y->>'end_min')::int - (y->>'start_min')::int) FROM jsonb_array_elements(x.off) y), 0))), 0)::int AS avail
            FROM jsonb_to_recordset(v_sh_prev) AS x(works boolean, start_time time, end_time time, breaks jsonb, off jsonb)
           WHERE x.works AND x.start_time IS NOT NULL) a,
         (SELECT COALESCE(sum((EXTRACT(EPOCH FROM COALESCE(bt.end_time, b2.end_time) - COALESCE(bt.start_time, b2.start_time)) / 60)::int), 0)::int AS booked
            FROM public.booking_therapists bt JOIN public.bookings b2 ON b2.id = bt.booking_id
           WHERE b2.branch_id = ANY (v_ids) AND b2.date = v_prev AND b2.status NOT IN ('Cancelled', 'No Show')) bk;

  -- floor: per branch, the therapists working that day with their blocks and gaps >= 1h, busiest first ---------------
  FOR r IN
    WITH sh AS (
      SELECT x.branch_id, x.therapist_id, x.start_time, x.end_time, x.breaks, x.off
        FROM jsonb_to_recordset(v_sh) AS x(branch_id uuid, therapist_id uuid, shift_date date, works boolean, start_time time, end_time time, source text, breaks jsonb, off jsonb)
       WHERE x.shift_date = v_date AND x.works AND x.start_time IS NOT NULL AND x.source IS DISTINCT FROM 'none'  -- Therapists page rule: a real shift, not "No hours set"
         AND EXISTS (SELECT 1 FROM public.therapists st WHERE st.id = x.therapist_id AND st.is_service_staff IS NOT FALSE)  -- support staff are not bookable
    )
    SELECT sh.branch_id, sh.therapist_id, t.name, t.position,
           (EXTRACT(EPOCH FROM sh.start_time) / 60)::int AS s_min,
           LEAST(1440, (EXTRACT(EPOCH FROM sh.end_time) / 60)::int + CASE WHEN sh.end_time = '23:59:59' THEN 1 ELSE 0 END) AS e_min,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object('k', q.k, 'f', q.f, 'e', q.e, 'id', q.bid, 'label', q.lbl) ORDER BY q.f, q.e), '[]') FROM (
              SELECT CASE bk.status WHEN 'Completed' THEN 'done' WHEN 'In-Progress' THEN 'now' WHEN 'Confirmed' THEN 'booked' ELSE 'unconfirmed' END AS k,
                     (EXTRACT(EPOCH FROM COALESCE(bt.start_time, bk.start_time)) / 60)::int AS f,
                     (EXTRACT(EPOCH FROM COALESCE(bt.end_time, bk.end_time)) / 60)::int AS e,
                     bk.id AS bid, concat_ws(' · ', bk.customer_name, bk.service_name_snapshot) AS lbl
                FROM public.booking_therapists bt JOIN public.bookings bk ON bk.id = bt.booking_id
               WHERE bt.therapist_id = sh.therapist_id AND bk.date = v_date AND bk.status NOT IN ('Cancelled', 'No Show')
              UNION ALL
              SELECT 'break', (y->>'start_min')::int, (y->>'end_min')::int, NULL::uuid, 'Break' FROM jsonb_array_elements(COALESCE(sh.breaks, '[]')) y
              UNION ALL
              SELECT 'leave', (y->>'start_min')::int, (y->>'end_min')::int, NULL::uuid, 'Off' FROM jsonb_array_elements(COALESCE(sh.off, '[]')) y
           ) q) AS ranges
      FROM sh JOIN public.therapists t ON t.id = sh.therapist_id
  LOOP
    v_blocks := '[]'; v_gaps := '[]'; v_cursor := r.s_min; v_busy := 0;
    FOR rr IN SELECT e FROM jsonb_array_elements(r.ranges) e LOOP
      v_k := rr->>'k'; v_f := (rr->>'f')::int; v_e := (rr->>'e')::int;
      IF v_f - v_cursor >= 60 THEN
        v_gaps := v_gaps || jsonb_build_object('from', public.minutes_to_hhmm(v_cursor), 'to', public.minutes_to_hhmm(v_f), 'from_min', v_cursor, 'to_min', v_f);
      END IF;
      v_blocks := v_blocks || jsonb_build_object('kind', v_k, 'from', public.minutes_to_hhmm(v_f), 'to', public.minutes_to_hhmm(v_e),
                                                 'from_min', v_f, 'to_min', v_e, 'booking_id', rr->>'id', 'label', rr->>'label');
      IF v_k NOT IN ('break', 'leave') THEN v_busy := v_busy + GREATEST(0, v_e - v_f); END IF;
      v_cursor := GREATEST(v_cursor, v_e);
    END LOOP;
    IF r.e_min - v_cursor >= 60 THEN
      v_gaps := v_gaps || jsonb_build_object('from', public.minutes_to_hhmm(v_cursor), 'to', public.minutes_to_hhmm(r.e_min), 'from_min', v_cursor, 'to_min', r.e_min);
    END IF;
    v_state := CASE WHEN v_is_today AND v_blocks @> '[{"kind":"now"}]' THEN 'now' END;
    v_list := v_list || jsonb_build_object('branch_id', r.branch_id, 'therapist_id', r.therapist_id, 'name', r.name, 'position', r.position,
                'shift_from', public.minutes_to_hhmm(r.s_min), 'shift_to', public.minutes_to_hhmm(r.e_min), 'shift_from_min', r.s_min, 'shift_to_min', r.e_min,
                'busy_minutes', v_busy, 'state', v_state,
                'checked_in',  EXISTS (SELECT 1 FROM public.therapist_attendance ta WHERE ta.therapist_id = r.therapist_id AND ta.date = v_date AND ta.check_in_time IS NOT NULL AND ta.check_out_time IS NULL),
                'checked_out', EXISTS (SELECT 1 FROM public.therapist_attendance ta WHERE ta.therapist_id = r.therapist_id AND ta.date = v_date AND ta.check_out_time IS NOT NULL), 'blocks', v_blocks, 'gaps', v_gaps);
  END LOOP;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'branch_id', bid,
           'headcount', public._dashboard_working(v_sh, ARRAY[bid], v_date),  -- same population as 'working'
           'working', (SELECT count(*) FROM jsonb_array_elements(v_list) e WHERE e->>'branch_id' = bid::text),
           'therapists', (SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'busy_minutes')::int DESC, e->>'name'), '[]')
                            FROM jsonb_array_elements(v_list) e WHERE e->>'branch_id' = bid::text))), '[]')
    INTO v_floor FROM unnest(v_ids) bid;

  -- week: booked share of therapist hours, 7 days from p_date ---------------------------------------------------------
  WITH sh AS (
    SELECT x.shift_date, x.start_time, x.end_time, x.breaks, x.off
      FROM jsonb_to_recordset(v_sh) AS x(shift_date date, works boolean, start_time time, end_time time, breaks jsonb, off jsonb)
     WHERE x.works AND x.start_time IS NOT NULL
  ), avail AS (
    SELECT sh.shift_date AS day,
           sum(GREATEST(0, (EXTRACT(EPOCH FROM sh.end_time - sh.start_time) / 60)::int
               - COALESCE((SELECT sum((y->>'end_min')::int - (y->>'start_min')::int) FROM jsonb_array_elements(sh.breaks) y), 0)
               - COALESCE((SELECT sum((y->>'end_min')::int - (y->>'start_min')::int) FROM jsonb_array_elements(sh.off) y), 0)))::int AS avail
      FROM sh GROUP BY sh.shift_date
  ), booked AS (
    SELECT bk.date AS day, sum((EXTRACT(EPOCH FROM COALESCE(bt.end_time, bk.end_time) - COALESCE(bt.start_time, bk.start_time)) / 60)::int)::int AS booked
      FROM public.booking_therapists bt JOIN public.bookings bk ON bk.id = bt.booking_id
     WHERE bk.branch_id = ANY (v_ids) AND bk.date BETWEEN v_date AND v_date + 6 AND bk.status NOT IN ('Cancelled', 'No Show')
     GROUP BY bk.date
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('date', a.day, 'available_minutes', a.avail, 'booked_minutes', COALESCE(bd.booked, 0),
           'booked_share', CASE WHEN a.avail > 0 THEN round(COALESCE(bd.booked, 0)::numeric / a.avail, 3) END) ORDER BY a.day), '[]')
    INTO v_week FROM avail a LEFT JOIN booked bd ON bd.day = a.day;

  -- branches: one row per branch (scene D) ----------------------------------------------------------------------------
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'branch_id', br.id, 'name', br.name,
           'bookings',  (SELECT count(*) FROM public.bookings bk WHERE bk.branch_id = br.id AND bk.date = v_date AND bk.status <> 'Cancelled'),
           'completed', (SELECT count(*) FROM public.bookings bk WHERE bk.branch_id = br.id AND bk.date = v_date AND bk.status = 'Completed'),
           'revenue',   CASE WHEN v_money THEN public._dashboard_net(ARRAY[br.id], v_date) END,
           'working',   public._dashboard_working(v_sh, ARRAY[br.id], v_date),
           -- scene D columns: manager, "x of y busy" (working = y), vs last same weekday, booked hours, unpaid
           'manager',   (SELECT u.full_name FROM public.users u
                          WHERE u.role = 'manager' AND (u.branch_id = br.id OR EXISTS (SELECT 1 FROM public.user_branches ub WHERE ub.user_id = u.id AND ub.branch_id = br.id))
                          ORDER BY u.full_name LIMIT 1),
           'busy_now',  (SELECT count(*) FROM jsonb_array_elements(v_list) e WHERE e->>'branch_id' = br.id::text AND e->>'state' = 'now'),
           'revenue_prev', CASE WHEN v_money AND EXISTS (SELECT 1 FROM public._dashboard_money_in(ARRAY[br.id], v_prev)) THEN public._dashboard_net(ARRAY[br.id], v_prev) END,
           'booked_share',      public._dashboard_booked_share(br.id, v_date, v_sh),
           'booked_share_prev', public._dashboard_booked_share(br.id, v_prev, v_sh_prev),
           'unpaid',    CASE WHEN v_money THEN (SELECT COALESCE(sum(GREATEST(bk.final_amount - COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.booking_id = bk.id), 0), 0)), 0)
                                  FROM public.bookings bk WHERE bk.branch_id = br.id AND bk.status = 'Completed' AND bk.payment_status <> 'paid' AND bk.date <= v_date) END,
           -- needs someone: per-kind counts of the one rule (_dashboard_need_kind)
           'needs',     (SELECT jsonb_build_object('discount', count(*) FILTER (WHERE q.k = 'discount'), 'owed', count(*) FILTER (WHERE q.k = 'owed'),
                                'not_closed', count(*) FILTER (WHERE q.k = 'not_closed'), 'unconfirmed', count(*) FILTER (WHERE q.k = 'unconfirmed'),
                                'unassigned', count(*) FILTER (WHERE q.k = 'unassigned'), 'total', count(*),
                                'oldest_not_closed', min(q.d) FILTER (WHERE q.k = 'not_closed'))
                           FROM (SELECT bk.date AS d, public._dashboard_need_kind(bk, v_now, v_date) AS k FROM public.bookings bk
                                  WHERE bk.branch_id = br.id AND bk.date <= v_date
                                    AND (bk.status IN ('Pending', 'Confirmed', 'In-Progress') OR bk.discount_status::text = 'pending'
                                         OR (bk.status = 'Completed' AND bk.payment_status <> 'paid'))) q
                          WHERE q.k IS NOT NULL)
         ) ORDER BY br.name), '[]')
    INTO v_branches FROM public.branches br WHERE br.id = ANY (v_ids);

  -- money: by method, cash expected, tips (not revenue) ---------------------------------------------------------------
  IF v_money THEN
    SELECT jsonb_build_object(
             'by_method', COALESCE((SELECT jsonb_object_agg(m.payment_mode, m.total) FROM (
                 SELECT mi.payment_mode, sum(mi.amount) AS total FROM public._dashboard_money_in(v_ids, v_date) mi GROUP BY mi.payment_mode) m), '{}'),
             'refunds', public._dashboard_refunds(v_ids, v_date),
             'taken', public._dashboard_net(v_ids, v_date),
             -- money taken AFTER each branch's day was closed (not in the closed daily_reports row): ZNLY-234
             'after_close', (SELECT jsonb_build_object('amount', ac.amount, 'cash', ac.cash) FROM public._dashboard_after_close(v_ids, v_date) ac),
             'cash_expected', COALESCE((SELECT sum(mi.amount) FROM public._dashboard_money_in(v_ids, v_date) mi WHERE mi.payment_mode = 'Cash'), 0)
                  - public._dashboard_refunds(v_ids, v_date),
             'tips', COALESCE((SELECT sum(tp.amount) FROM public.booking_tips tp JOIN public.bookings tb ON tb.id = tp.booking_id
                  WHERE tb.branch_id = ANY (v_ids) AND tp.created_at >= d0 AND tp.created_at < d1), 0))
      INTO v_money_j;
  END IF;

  -- tomorrow ----------------------------------------------------------------------------------------------------------
  SELECT jsonb_build_object(
           'bookings',    count(*) FILTER (WHERE bk.status <> 'Cancelled'),
           'unconfirmed', count(*) FILTER (WHERE bk.status = 'Pending'),
           'working', public._dashboard_working(v_sh, v_ids, v_date + 1))
    INTO v_tomorrow FROM public.bookings bk WHERE bk.branch_id = ANY (v_ids) AND bk.date = v_date + 1;

  -- my_day: the caller's own bookings today (see header re ZNLY-150) ---------------------------------------------------
  v_mine := public._dashboard_my_therapist_ids();
  SELECT jsonb_build_object(
           'therapist_ids', to_jsonb(v_mine),
           'bookings', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', bk.id, 'number', bk.booking_number, 'branch_id', bk.branch_id,
                'start', to_char(COALESCE(bt.start_time, bk.start_time), 'HH24:MI'), 'end', to_char(COALESCE(bt.end_time, bk.end_time), 'HH24:MI'),
                'customer', bk.customer_name, 'service', bk.service_name_snapshot, 'status', bk.status, 'room', bk.room_name_snapshot,
                'visit', CASE WHEN bk.customer_id IS NULL THEN NULL ELSE (SELECT count(*) FROM public.bookings pv
                           WHERE pv.customer_id = bk.customer_id AND pv.status NOT IN ('Cancelled', 'No Show') AND (pv.date, pv.start_time) <= (bk.date, bk.start_time)) END)
                ORDER BY COALESCE(bt.start_time, bk.start_time))
              FROM public.booking_therapists bt JOIN public.bookings bk ON bk.id = bt.booking_id
             WHERE bt.therapist_id = ANY (v_mine) AND bk.date = v_date AND bk.branch_id = ANY (v_ids) AND bk.status <> 'Cancelled'), '[]'),
           'tips', (SELECT COALESCE(sum(tp.amount), 0) FROM public.booking_tips tp
                      JOIN public.bookings tb ON tb.id = tp.booking_id
                     WHERE tp.received_by = v_uid AND tb.branch_id = ANY (v_ids) AND tp.created_at >= d0 AND tp.created_at < d1),
           'tips_month', (SELECT COALESCE(sum(tp.amount), 0) FROM public.booking_tips tp
                      JOIN public.bookings tb ON tb.id = tp.booking_id
                     WHERE tp.received_by = v_uid AND tb.branch_id = ANY (v_ids) AND tp.created_at >= (date_trunc('month', v_date)::timestamp AT TIME ZONE 'Asia/Kathmandu') AND tp.created_at < d1),
           'commission', NULL,
           'commission_inputs_month', jsonb_build_object(
              'service_revenue', (SELECT COALESCE(sum(bk.final_amount), 0) FROM public.bookings bk
                                   WHERE bk.therapist_id = ANY (v_mine) AND bk.date BETWEEN date_trunc('month', v_date)::date AND v_date AND bk.status = 'Completed' AND bk.payment_status = 'paid'),
              'referral_rows', COALESCE((SELECT jsonb_agg(jsonb_build_object('final_amount', bk.final_amount, 'type', bk.referral_commission_type,
                                              'value', bk.referral_commission_value))
                                   FROM public.bookings bk JOIN public.therapists mt ON mt.id = ANY (v_mine)
                                  WHERE bk.date BETWEEN date_trunc('month', v_date)::date AND v_date AND bk.status = 'Completed' AND bk.payment_status = 'paid'
                                    AND bk.branch_id = ANY (v_ids) AND lower(btrim(bk.referred_by)) = lower(btrim(mt.name))), '[]')),
           'commission_inputs', jsonb_build_object(
              'service_revenue', (SELECT COALESCE(sum(bk.final_amount), 0) FROM public.bookings bk
                                   WHERE bk.therapist_id = ANY (v_mine) AND bk.date = v_date AND bk.status = 'Completed' AND bk.payment_status = 'paid'),
              'referral_rows', COALESCE((SELECT jsonb_agg(jsonb_build_object('final_amount', bk.final_amount, 'type', bk.referral_commission_type,
                                              'value', bk.referral_commission_value))
                                   FROM public.bookings bk JOIN public.therapists mt ON mt.id = ANY (v_mine)
                                  WHERE bk.date = v_date AND bk.status = 'Completed' AND bk.payment_status = 'paid'
                                    AND bk.branch_id = ANY (v_ids) AND lower(btrim(bk.referred_by)) = lower(btrim(mt.name))), '[]'),
              'commission_rate', (SELECT sc.commission_rate FROM public.staff_compensation sc WHERE sc.therapist_id = ANY (v_mine) LIMIT 1)))
    INTO v_my;

  RETURN jsonb_build_object('date', v_date, 'role', v_role, 'branch_ids', to_jsonb(v_ids),
           'pulse', v_pulse || jsonb_build_object('revenue_prev', v_prev_rev, 'booked_share_prev', v_prev_share), 'floor', v_floor, 'week', v_week, 'branches', v_branches,
           'money', v_money_j, 'tomorrow', v_tomorrow, 'my_day', v_my);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_dashboard(uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard(uuid[], date) TO authenticated;

-- What the closed day held AT CLOSE: the same rule as the day's money, limited to rows taken at or before the branch's closed_at (single branch only;
-- NULL when the day is not closed). The closed-day reconciliation shows this as "At close", the after_close figure as "After close", and the live
-- figures as "Now", so the three never mix. Derived from the rows (not the stored snapshot), so it also works for snapshots saved before per-method figures.
CREATE OR REPLACE FUNCTION public._dashboard_at_close(p_branches uuid[], p_day date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_c timestamptz; v_in numeric; v_cash numeric; v_ref numeric;
BEGIN
  IF cardinality(p_branches) <> 1 THEN RETURN NULL; END IF;
  SELECT dr.closed_at INTO v_c FROM public.daily_reports dr WHERE dr.branch_id = p_branches[1] AND dr.report_date = p_day;
  IF v_c IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(sum(mi.amount), 0), COALESCE(sum(mi.amount) FILTER (WHERE mi.payment_mode = 'Cash'), 0) INTO v_in, v_cash
    FROM public._dashboard_money_in(p_branches, p_day) mi WHERE mi.at <= v_c;
  SELECT COALESCE(sum(rr.amount), 0) INTO v_ref FROM public._dashboard_refund_rows(p_branches, p_day) rr WHERE rr.at <= v_c;
  RETURN jsonb_build_object('closed_at', v_c,
    'by_method', COALESCE((SELECT jsonb_object_agg(x.payment_mode, x.total) FROM (
        SELECT mi.payment_mode, sum(mi.amount) AS total FROM public._dashboard_money_in(p_branches, p_day) mi WHERE mi.at <= v_c GROUP BY mi.payment_mode) x), '{}'),
    'refunds', v_ref, 'taken', v_in - v_ref, 'cash_expected', v_cash - v_ref);
END;
$$;
REVOKE ALL ON FUNCTION public._dashboard_at_close(uuid[], date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_day_money(p_branch_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_role text; v_org uuid; v_ids uuid[]; v_refunds numeric; v_in numeric; v_cash numeric; v_svc numeric;
BEGIN
  SELECT u.role::text, u.org_id INTO v_role, v_org FROM public.users u WHERE u.id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('manager', 'admin', 'admin_viewer') THEN RETURN '{}'::jsonb; END IF;
  SELECT COALESCE(array_agg(br.id), '{}') INTO v_ids FROM public.branches br
   WHERE br.org_id = v_org AND (p_branch_id IS NULL OR br.id = p_branch_id)
     AND (v_role IN ('admin', 'admin_viewer') OR br.id = ANY (public.get_user_branch_ids()));
  IF cardinality(v_ids) = 0 THEN RETURN '{}'::jsonb; END IF;
  v_refunds := public._dashboard_refunds(v_ids, p_date);
  SELECT COALESCE(sum(amount), 0), COALESCE(sum(amount) FILTER (WHERE payment_mode = 'Cash'), 0), COALESCE(sum(amount) FILTER (WHERE src = 'booking'), 0)
    INTO v_in, v_cash, v_svc FROM public._dashboard_money_in(v_ids, p_date);
  RETURN jsonb_build_object(
    'by_method', COALESCE((SELECT jsonb_object_agg(m.payment_mode, m.total) FROM (
        SELECT mi.payment_mode, sum(mi.amount) AS total FROM public._dashboard_money_in(v_ids, p_date) mi GROUP BY mi.payment_mode) m), '{}'),
    'refunds', v_refunds, 'taken', v_in - v_refunds, 'cash_expected', v_cash - v_refunds, 'service_in', v_svc,
    'after_close', (SELECT jsonb_build_object('amount', ac.amount, 'cash', ac.cash) FROM public._dashboard_after_close(v_ids, p_date) ac),   -- ZNLY-234: taken after the day was closed
    'at_close', public._dashboard_at_close(v_ids, p_date),   -- ZNLY-234: what the closed day held at close (NULL when open)
    -- where the non-booking money came from: product / voucher / membership / package
    'sources', COALESCE((SELECT jsonb_object_agg(x.src, x.total) FROM (
        SELECT mi.src, sum(mi.amount) AS total FROM public._dashboard_money_in(v_ids, p_date) mi WHERE mi.src <> 'booking' GROUP BY mi.src) x), '{}'));
END;
$function$;

REVOKE ALL ON FUNCTION public.get_day_money(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_day_money(uuid, date) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('392', 'day-close-collect-after-close')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
