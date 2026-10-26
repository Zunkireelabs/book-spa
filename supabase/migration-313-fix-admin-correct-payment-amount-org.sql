-- Migration 313: fix admin_correct_payment_amount (migration-283) -- it selected b.org_id from public.bookings, which has no
-- org_id column, so every call failed with 42703 "column b.org_id does not exist". The org now comes from the booking's branch.
--
-- Found by the V27 smoke test (admin correction on a payment amount). Same body as migration-283 otherwise.
-- Idempotent: CREATE OR REPLACE FUNCTION on the same signature. Portable: no hardcoded UUIDs.
-- Reversible: re-apply migration-283's function body (which is the broken one -- there is no reason to).

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_correct_payment_amount(
  p_payment_id uuid,
  p_new_amount numeric,
  p_reason     text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role        user_role := get_user_role();
  v_caller_org  uuid      := get_user_org_id();
  v_booking_id  uuid;
  v_booking_org uuid;
  v_branch_id   uuid;
  v_date        date;
  v_old_amount  numeric;
  v_final       numeric;
  v_paid        numeric;
  v_txn_id      uuid;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'admin_correct_payment_amount: admin role required'
      USING ERRCODE = 'P0003';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'admin_correct_payment_amount: a reason of at least 10 characters is required'
      USING ERRCODE = 'P0003';
  END IF;

  IF p_new_amount IS NULL OR p_new_amount < 0 THEN
    RAISE EXCEPTION 'admin_correct_payment_amount: new amount must be zero or greater'
      USING ERRCODE = 'P0003';
  END IF;

  -- Lock the payment row + resolve its booking's org/branch/date/final_amount.
  SELECT p.booking_id, p.amount, br.org_id, b.branch_id, b.date, b.final_amount
    INTO v_booking_id, v_old_amount, v_booking_org, v_branch_id, v_date, v_final
  FROM public.payments p
  JOIN public.bookings b ON b.id = p.booking_id
  JOIN public.branches br ON br.id = b.branch_id
  WHERE p.id = p_payment_id
  FOR UPDATE OF p;

  IF v_booking_id IS NULL THEN
    RAISE EXCEPTION 'admin_correct_payment_amount: payment % not found', p_payment_id
      USING ERRCODE = 'P0003';
  END IF;

  IF v_booking_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'admin_correct_payment_amount: payment is not in your organization'
      USING ERRCODE = 'P0003';
  END IF;

  IF p_new_amount = v_old_amount THEN
    RAISE EXCEPTION 'admin_correct_payment_amount: new amount is the same as the current amount'
      USING ERRCODE = 'P0003';
  END IF;

  -- A closed day's daily_reports snapshot is permanent and never recomputed —
  -- correcting a payment's amount after its day is closed would leave that
  -- snapshot's totals silently wrong forever. Mirrors migration-237's
  -- identical guard.
  IF EXISTS (
    SELECT 1 FROM public.daily_reports
    WHERE branch_id = v_branch_id
      AND report_date = v_date
  ) THEN
    RAISE EXCEPTION 'admin_correct_payment_amount: that day has already been closed for this branch'
      USING ERRCODE = 'P0003';
  END IF;

  UPDATE public.payments
     SET amount = p_new_amount
   WHERE id = p_payment_id;

  -- Recompute payment_status the same way update_booking_payment_status()
  -- would on INSERT — this UPDATE doesn't fire that trigger.
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.payments WHERE booking_id = v_booking_id;

  UPDATE public.bookings
     SET payment_status = CASE
           WHEN v_paid >= v_final THEN 'paid'
           WHEN v_paid > 0        THEN 'partial'
           ELSE 'unpaid'
         END
   WHERE id = v_booking_id;

  INSERT INTO public.audit_logs
    (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by, reason)
  VALUES
    (v_branch_id, 'payments', p_payment_id, 'ADMIN_CORRECTION',
     jsonb_build_object('amount', v_old_amount, 'booking_id', v_booking_id),
     jsonb_build_object('amount', p_new_amount, 'booking_id', v_booking_id),
     auth.uid(), btrim(p_reason))
  RETURNING id INTO v_txn_id;

  RETURN v_txn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_correct_payment_amount(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_correct_payment_amount(uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_correct_payment_amount(uuid, numeric, text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('313', 'fix-admin-correct-payment-amount-org')
ON CONFLICT (version) DO NOTHING;

COMMIT;
