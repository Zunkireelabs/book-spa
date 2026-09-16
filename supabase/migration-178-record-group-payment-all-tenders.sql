-- ============================================================
-- Migration 178: extend atomic group payment to every tender type
-- ============================================================
--
-- migration-177's record_group_payment_standard() only accepted "standard"
-- tenders (Cash/Card/Bank/etc, inserted as a plain payments row) — a bundle
-- containing Membership/ReferralWallet/ReferralVoucher/VoucherWallet/
-- SessionPackage tenders fell back to the old sequential per-booking
-- recordPayment() loop (src/services/api.js), which is NOT atomic across
-- bookings (payments rows are immutable, so a mid-loop failure can't be
-- rolled back) — leaving that failure mode open for exactly the tender
-- types that need it most (wallet/voucher/package deductions).
--
-- That restriction turns out to be unnecessary: record_membership_payment(),
-- record_referral_wallet_payment(), redeem_referral_voucher(),
-- record_voucher_wallet_payment[_pooled](), and redeem_package_session()
-- are all plain plpgsql functions — calling them from INSIDE this function
-- runs them in the SAME transaction as everything else here, with no extra
-- work needed to make that atomic. This migration replaces
-- record_group_payment_standard() with record_group_payment(), which
-- mirrors recordPayment()'s full tender-categorization logic (steps 7-11 of
-- that function, src/services/api.js) for every booking in the bundle,
-- inside one transaction.
--
-- p_payments shape (jsonb array), one element per booking:
--   {
--     "booking_id": uuid,
--     "tenders": [
--       {"amount": numeric, "payment_mode": text,
--        "referral_id": uuid,   -- required for ReferralVoucher
--        "voucher_id": uuid,    -- optional for VoucherWallet (absent = pooled draw)
--        "package_id": uuid},   -- required for SessionPackage
--       ...
--     ],
--     "due_holder_name": text | null,
--     "notes": text | null
--   }
--
-- Returns a jsonb array, one result object per booking:
--   {"booking_id": uuid, "amount_paid": numeric, "amount_due": numeric, "fully_paid": boolean}
--
-- Safe to run multiple times.
-- ============================================================

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

    IF v_booking.is_locked THEN
      RAISE EXCEPTION 'record_group_payment: booking % — this day has been closed', v_booking_id;
    END IF;

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
    v_tender_total := round((v_npr_tender_total + v_session_package_residual)::numeric, 2);

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

    IF v_due_holder IS DISTINCT FROM v_booking.due_holder_name THEN
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

REVOKE ALL ON FUNCTION public.record_group_payment(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_group_payment(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_group_payment(jsonb) TO authenticated;

-- Superseded by record_group_payment above (handles every tender type, not
-- just standard ones) — drop the old one so there's a single source of truth.
DROP FUNCTION IF EXISTS public.record_group_payment_standard(jsonb);

-- ============================================================
-- MIGRATION 178 COMPLETE
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('178', 'record-group-payment-all-tenders')
ON CONFLICT (version) DO NOTHING;
