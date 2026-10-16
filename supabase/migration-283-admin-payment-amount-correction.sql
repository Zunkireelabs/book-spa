-- Migration 283: admin-only correction of a recorded payment's amount.
--
-- Idempotent: CREATE OR REPLACE FUNCTION on a brand-new function name.
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.admin_correct_payment_amount(uuid, numeric, text);
-- Portable: no hardcoded UUIDs.
--
--
-- Why this exists
--
-- public.payments has no UPDATE/DELETE RLS policy at all (supabase/rls.sql) —
-- true immutability, not a trigger-based one like bookings (migration-232).
-- A payment can still be mistakenly recorded with the wrong amount (fat-
-- fingered NPR figure) and there is currently no way to fix it short of a
-- manual DB edit. This gives admins the same audited-correction posture
-- migration-237 already established for payments.payment_mode, this time for
-- payments.amount.
--
--
-- Why a new RPC instead of extending admin_correct_booking
--
-- Same reasoning as migration-237: admin_correct_booking's whitelist only
-- ever writes columns on the bookings table. amount lives on payments, a
-- different table with its own immutability posture, so it needs its own
-- SECURITY DEFINER bypass.
--
--
-- Why payment_status is recomputed manually here
--
-- trg_payment_update_booking_status (migration-042's update_booking_payment_status())
-- only fires AFTER INSERT ON payments, not AFTER UPDATE — a direct UPDATE to
-- payments.amount here would silently desync bookings.payment_status from the
-- corrected total otherwise. Recomputes the exact same SUM(amount) vs
-- final_amount >= / > / else logic the trigger uses, inline, after the
-- correction commits.
--
--
-- Why the day-closed guard
--
-- Same posture as migration-237: daily_reports.cash_total/card_total/
-- fonepay_total are frozen forever once a day is closed, with no recompute
-- mechanism. Correcting a payment's amount after its day is closed would
-- leave that snapshot silently and permanently wrong.

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
  SELECT p.booking_id, p.amount, b.org_id, b.branch_id, b.date, b.final_amount
    INTO v_booking_id, v_old_amount, v_booking_org, v_branch_id, v_date, v_final
  FROM public.payments p
  JOIN public.bookings b ON b.id = p.booking_id
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
VALUES ('283', 'admin-payment-amount-correction')
ON CONFLICT (version) DO NOTHING;

COMMIT;
