-- Migration 237: admin-only correction of a recorded payment's method.
--
-- Idempotent: CREATE OR REPLACE FUNCTION on a brand-new function name.
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.admin_correct_payment_mode(uuid, text, text);
-- Portable: no hardcoded UUIDs.
--
--
-- Why this exists
--
-- public.payments has no UPDATE/DELETE RLS policy at all (supabase/rls.sql) —
-- true immutability, not a trigger-based one like bookings (migration-232).
-- A payment can still be mistakenly recorded with the wrong method (e.g.
-- MobileBanking instead of Cash) and there is currently no way to fix it short
-- of a manual DB edit. This gives admins the same audited-correction posture
-- migration-232/233/236 already established for bookings/vouchers/packages/
-- membership transactions, specifically for payments.payment_mode.
--
--
-- Why a new RPC instead of extending admin_correct_booking
--
-- admin_correct_booking's whitelist only ever writes columns on the bookings
-- table (migration-232's v_allowed array). payment_mode lives on payments, a
-- different table with its own immutability posture (RLS absence, not a
-- trigger) — bypassing that requires its own SECURITY DEFINER function, the
-- same bypass mechanism admin_correct_booking already uses for bookings.
--
--
-- Why the day-closed guard
--
-- daily_reports.cash_total/card_total/fonepay_total are frozen forever once a
-- day is closed, with no recompute mechanism (same gap migration-236's fix
-- closed for membership transactions). Live (not-yet-closed) dashboard
-- functions re-derive their payment-mode breakdowns from payments at query
-- time, so they self-correct automatically once the row is fixed — but a
-- closed day's snapshot would silently and permanently desync from the
-- corrected row. Rejecting the correction entirely on a closed day is the
-- same posture as migration-236's identical guard.
--
--
-- Why payment_mode validity is NOT re-defined here
--
-- payments_payment_mode_check (migration-052) already enforces non-empty,
-- <=40 chars on the column itself. Duplicating that here would just be a
-- second place to keep in sync; the UPDATE below lets the table's own CHECK
-- reject an invalid value, same as every other write path into payments.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_correct_payment_mode(
  p_payment_id uuid,
  p_new_mode   text,
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
  v_old_mode    text;
  v_txn_id      uuid;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'admin_correct_payment_mode: admin role required'
      USING ERRCODE = 'P0003';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'admin_correct_payment_mode: a reason of at least 10 characters is required'
      USING ERRCODE = 'P0003';
  END IF;

  IF p_new_mode IS NULL OR length(btrim(p_new_mode)) = 0 THEN
    RAISE EXCEPTION 'admin_correct_payment_mode: new payment mode is required'
      USING ERRCODE = 'P0003';
  END IF;

  -- Lock the payment row + resolve its booking's org/branch/date.
  SELECT p.booking_id, p.payment_mode, b.org_id, b.branch_id, b.date
    INTO v_booking_id, v_old_mode, v_booking_org, v_branch_id, v_date
  FROM public.payments p
  JOIN public.bookings b ON b.id = p.booking_id
  WHERE p.id = p_payment_id
  FOR UPDATE OF p;

  IF v_booking_id IS NULL THEN
    RAISE EXCEPTION 'admin_correct_payment_mode: payment % not found', p_payment_id
      USING ERRCODE = 'P0003';
  END IF;

  IF v_booking_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'admin_correct_payment_mode: payment is not in your organization'
      USING ERRCODE = 'P0003';
  END IF;

  IF btrim(p_new_mode) = v_old_mode THEN
    RAISE EXCEPTION 'admin_correct_payment_mode: new mode is the same as the current mode'
      USING ERRCODE = 'P0003';
  END IF;

  -- A closed day's daily_reports snapshot is permanent and never recomputed —
  -- correcting a payment's mode after its day is closed would leave that
  -- snapshot's cash/card/mobile split silently wrong forever. Mirrors
  -- migration-236's identical guard.
  IF EXISTS (
    SELECT 1 FROM public.daily_reports
    WHERE branch_id = v_branch_id
      AND report_date = v_date
  ) THEN
    RAISE EXCEPTION 'admin_correct_payment_mode: that day has already been closed for this branch'
      USING ERRCODE = 'P0003';
  END IF;

  UPDATE public.payments
     SET payment_mode = btrim(p_new_mode)
   WHERE id = p_payment_id;

  INSERT INTO public.audit_logs
    (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by, reason)
  VALUES
    (v_branch_id, 'payments', p_payment_id, 'ADMIN_CORRECTION',
     jsonb_build_object('payment_mode', v_old_mode, 'booking_id', v_booking_id),
     jsonb_build_object('payment_mode', btrim(p_new_mode), 'booking_id', v_booking_id),
     auth.uid(), btrim(p_reason))
  RETURNING id INTO v_txn_id;

  RETURN v_txn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_correct_payment_mode(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_correct_payment_mode(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_correct_payment_mode(uuid, text, text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('237', 'admin-payment-mode-correction')
ON CONFLICT (version) DO NOTHING;

COMMIT;
