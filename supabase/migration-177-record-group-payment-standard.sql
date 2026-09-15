-- ============================================================
-- Migration 177: atomic bundled payment for standard tenders
-- ============================================================
--
-- recordPayment() (src/services/api.js) records one booking's payment per
-- call — bundling N booking siblings into "Pay N Services" today means N
-- independent client round-trips, no shared transaction. payments rows are
-- immutable (no UPDATE/DELETE), so a failure partway through a bundle
-- cannot be rolled back client-side — the group is left genuinely
-- half-paid. This is a second, distinct failure mode from the
-- BK-20260915-0025/-0026/-0027 incident (which was a stale-related-list
-- display bug, fixed in application code, not here) but produces the same
-- symptom: "the group looks paid, only some of it is."
--
-- This RPC closes that gap for the common case: tenders that recordPayment
-- already inserts as a plain payments row with no side-effect RPC of their
-- own (Cash/Card/Bank/Online/custom bank methods — anything that is NOT
-- Membership, ReferralWallet, ReferralVoucher, VoucherWallet, or
-- SessionPackage, each of which deducts from a wallet/voucher/package via
-- its own SECURITY DEFINER RPC with side effects outside this table).
-- Bundles containing any of those five keep using today's sequential
-- recordPayment loop — porting their side effects into one transaction is
-- out of scope here.
--
-- Every booking in p_payments is validated and inserted inside ONE
-- function call. A RAISE EXCEPTION anywhere aborts the whole call — since a
-- SECURITY DEFINER function body runs inside the caller's transaction
-- (no nested BEGIN/EXCEPTION here), nothing committed by an earlier
-- iteration survives a later iteration's failure. All or nothing.
--
-- p_payments shape (jsonb array), one element per booking:
--   {
--     "booking_id": uuid,
--     "tenders": [{"amount": numeric, "payment_mode": text}, ...],
--     "due_holder_name": text | null,
--     "notes": text | null
--   }
--
-- Returns a jsonb array, one result object per booking:
--   {"booking_id": uuid, "amount_paid": numeric, "amount_due": numeric, "fully_paid": boolean}
--
-- Safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_group_payment_standard(p_payments jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role           user_role := get_user_role();
  v_org            uuid      := get_user_org_id();
  v_entry          jsonb;
  v_tender         jsonb;
  v_booking_id     uuid;
  v_booking        record;
  v_branch_org     uuid;
  v_collected      numeric(10,2);
  v_remaining      numeric(10,2);
  v_tender_total   numeric(10,2);
  v_tender_amt     numeric(10,2);
  v_tender_mode    text;
  v_leftover       numeric(10,2);
  v_due_holder     text;
  v_notes          text;
  v_first_row      boolean;
  v_results        jsonb := '[]'::jsonb;
BEGIN
  IF v_role NOT IN ('staff','manager','admin') THEN
    RAISE EXCEPTION 'record_group_payment_standard: staff, manager, or admin role required';
  END IF;

  IF p_payments IS NULL OR jsonb_typeof(p_payments) != 'array' OR jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'record_group_payment_standard: p_payments must be a non-empty JSON array';
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    v_booking_id := (v_entry->>'booking_id')::uuid;
    v_notes := v_entry->>'notes';

    IF v_booking_id IS NULL THEN
      RAISE EXCEPTION 'record_group_payment_standard: each entry requires a booking_id';
    END IF;

    -- Lock the row for the duration of this transaction — prevents a
    -- concurrent payment attempt on the same booking from racing this one.
    SELECT b.id, b.branch_id, b.status, b.payment_status, b.final_amount,
           b.is_locked, b.due_holder_name
      INTO v_booking
      FROM public.bookings b
      WHERE b.id = v_booking_id
      FOR UPDATE;

    IF v_booking IS NULL THEN
      RAISE EXCEPTION 'record_group_payment_standard: booking % not found', v_booking_id;
    END IF;

    SELECT org_id INTO v_branch_org FROM public.branches WHERE id = v_booking.branch_id;
    IF v_branch_org IS NULL OR v_branch_org IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'record_group_payment_standard: booking % is not in your organization', v_booking_id;
    END IF;

    IF v_booking.is_locked THEN
      RAISE EXCEPTION 'record_group_payment_standard: booking % — this day has been closed', v_booking_id;
    END IF;

    IF v_booking.payment_status = 'paid' THEN
      RAISE EXCEPTION 'record_group_payment_standard: booking % has already been paid', v_booking_id;
    END IF;

    IF v_booking.status NOT IN ('Confirmed','In-Progress','Completed') THEN
      RAISE EXCEPTION 'record_group_payment_standard: booking % is not in a payable state (%)', v_booking_id, v_booking.status;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_collected
    FROM public.payments WHERE booking_id = v_booking_id;
    v_remaining := round((v_booking.final_amount - v_collected)::numeric, 2);

    v_tender_total := 0;
    v_first_row := true;

    FOR v_tender IN SELECT * FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
    LOOP
      v_tender_amt := (v_tender->>'amount')::numeric;
      v_tender_mode := v_tender->>'payment_mode';

      IF v_tender_amt IS NULL OR v_tender_amt <= 0 THEN
        RAISE EXCEPTION 'record_group_payment_standard: booking % — each tender amount must be greater than zero', v_booking_id;
      END IF;
      IF v_tender_mode IS NULL OR length(btrim(v_tender_mode)) = 0 OR length(v_tender_mode) > 40 THEN
        RAISE EXCEPTION 'record_group_payment_standard: booking % — invalid payment method %', v_booking_id, v_tender_mode;
      END IF;
      IF v_tender_mode IN ('Membership','ReferralWallet','ReferralVoucher','VoucherWallet','SessionPackage') THEN
        RAISE EXCEPTION 'record_group_payment_standard: booking % — payment mode % is not supported by this RPC, use the standard recordPayment flow', v_booking_id, v_tender_mode;
      END IF;

      v_tender_total := round((v_tender_total + v_tender_amt)::numeric, 2);
    END LOOP;

    IF v_tender_total > v_remaining THEN
      RAISE EXCEPTION 'record_group_payment_standard: booking % — payment (NPR %) exceeds remaining balance (NPR %)', v_booking_id, v_tender_total, v_remaining;
    END IF;

    v_leftover := round((v_remaining - v_tender_total)::numeric, 2);
    v_due_holder := COALESCE(NULLIF(btrim(v_entry->>'due_holder_name'), ''), v_booking.due_holder_name);

    IF v_leftover > 0 AND v_due_holder IS NULL THEN
      RAISE EXCEPTION 'record_group_payment_standard: booking % — a due holder name is required to leave a balance unpaid', v_booking_id;
    END IF;

    FOR v_tender IN SELECT * FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
    LOOP
      INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
      VALUES (
        v_booking_id,
        (v_tender->>'amount')::numeric,
        v_tender->>'payment_mode',
        auth.uid(),
        CASE WHEN v_first_row THEN v_notes ELSE NULL END
      );
      v_first_row := false;
    END LOOP;

    IF v_due_holder IS DISTINCT FROM v_booking.due_holder_name THEN
      UPDATE public.bookings SET due_holder_name = v_due_holder WHERE id = v_booking_id;
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

REVOKE ALL ON FUNCTION public.record_group_payment_standard(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_group_payment_standard(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_group_payment_standard(jsonb) TO authenticated;

-- ============================================================
-- MIGRATION 177 COMPLETE
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('177', 'record-group-payment-standard')
ON CONFLICT (version) DO NOTHING;
