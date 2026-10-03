-- Migration 238: fix admin_correct_payment_mode's org-lookup crash, and allow
-- the correction on an already-closed day by recomputing the affected
-- daily_reports row's cash/card/fonepay split instead of rejecting outright.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, same signature as migration-237 (no
-- DROP FUNCTION needed, no re-grant needed).
-- Reversible (manual): re-run migration-237's original CREATE OR REPLACE
-- FUNCTION body.
-- Portable: no hardcoded UUIDs.
--
--
-- Bug 1 — org_id does not exist on bookings
--
-- migration-237 selected `b.org_id` directly off `public.bookings`, which has
-- no such column (confirmed in supabase/schema.sql — bookings only carries
-- branch_id; org_id lives on branches, derived via branch_id, same as every
-- other org-scoping query/RLS policy in this codebase, e.g.
-- migration-012-org-rls-policies.sql and migration-178's
-- `SELECT org_id INTO v_branch_org FROM public.branches WHERE id = ...`
-- pattern). That made every call to admin_correct_payment_mode fail outright
-- with "column b.org_id does not exist" — the feature shipped completely
-- broken, not just the org-check logic. Fixed by joining branches for org_id
-- instead.
--
--
-- Bug 2 (by decision, not a crash) — closed-day rejection defeats the feature
--
-- migration-237 rejected the correction entirely once the payment's day had a
-- daily_reports row. But admin corrections exist specifically to fix human
-- mistakes, and mistakes get noticed after a day closes just as often as
-- before — rejecting on a closed day defeats the whole point of the feature.
--
-- The alternative isn't a plain unlock (that would silently desync the closed
-- snapshot forever — the exact bug class this whole migration chain exists to
-- fix). Instead: allow the correction, and shift the payment's amount between
-- the old mode's bucket and the new mode's bucket on the existing
-- daily_reports row, in the same transaction as the payments.payment_mode
-- UPDATE. The delta is fully known (old bucket -amount, new bucket +amount),
-- so this is a 3-number adjustment, not a full day recompute. net_revenue /
-- gross_revenue / other totals are untouched — the total money collected that
-- day hasn't changed, only which bucket it's recorded under.
--
-- If the day isn't closed yet, there's no daily_reports row to touch — that's
-- fine, the live (not-yet-closed) dashboard already re-derives its
-- cash/card/mobile breakdown from payments.payment_mode at query time, so it
-- self-corrects automatically.
--
-- classify_payment_mode below mirrors src/services/api.js's
-- classifyPaymentMode() bucketing exactly (Cash -> cash, anything containing
-- 'Card' -> card, everything else -> fonepay), kept as a local CASE rather
-- than a shared SQL function since this is the only PL/pgSQL call site that
-- needs it.

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
  v_role         user_role := get_user_role();
  v_caller_org   uuid      := get_user_org_id();
  v_booking_id   uuid;
  v_booking_org  uuid;
  v_branch_id    uuid;
  v_date         date;
  v_old_mode     text;
  v_amount       numeric(10,2);
  v_old_bucket   text;
  v_new_bucket   text;
  v_report_touched boolean := false;
  v_txn_id       uuid;
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

  -- Lock the payment row + resolve its booking's branch/date and the
  -- branch's org (bookings itself has no org_id column — fixed bug).
  SELECT p.booking_id, p.payment_mode, p.amount, br.org_id, b.branch_id, b.date
    INTO v_booking_id, v_old_mode, v_amount, v_booking_org, v_branch_id, v_date
  FROM public.payments p
  JOIN public.bookings b  ON b.id = p.booking_id
  JOIN public.branches br ON br.id = b.branch_id
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

  v_old_bucket := CASE WHEN v_old_mode = 'Cash' THEN 'cash'
                       WHEN v_old_mode ILIKE '%Card%' THEN 'card'
                       ELSE 'fonepay' END;
  v_new_bucket := CASE WHEN btrim(p_new_mode) = 'Cash' THEN 'cash'
                       WHEN btrim(p_new_mode) ILIKE '%Card%' THEN 'card'
                       ELSE 'fonepay' END;

  UPDATE public.payments
     SET payment_mode = btrim(p_new_mode)
   WHERE id = p_payment_id;

  -- Shift the bucket on the branch's closed-day snapshot, if one exists for
  -- this date. No-op (and no row touched) when the bucket didn't actually
  -- change, or when the day isn't closed yet.
  IF v_old_bucket IS DISTINCT FROM v_new_bucket THEN
    UPDATE public.daily_reports
       SET cash_total    = cash_total    - CASE WHEN v_old_bucket = 'cash'    THEN v_amount ELSE 0 END
                                          + CASE WHEN v_new_bucket = 'cash'    THEN v_amount ELSE 0 END,
           card_total    = card_total    - CASE WHEN v_old_bucket = 'card'    THEN v_amount ELSE 0 END
                                          + CASE WHEN v_new_bucket = 'card'    THEN v_amount ELSE 0 END,
           fonepay_total = fonepay_total - CASE WHEN v_old_bucket = 'fonepay' THEN v_amount ELSE 0 END
                                          + CASE WHEN v_new_bucket = 'fonepay' THEN v_amount ELSE 0 END
     WHERE branch_id = v_branch_id AND report_date = v_date;

    IF FOUND THEN
      v_report_touched := true;
    END IF;
  END IF;

  INSERT INTO public.audit_logs
    (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by, reason)
  VALUES
    (v_branch_id, 'payments', p_payment_id, 'ADMIN_CORRECTION',
     jsonb_build_object('payment_mode', v_old_mode, 'booking_id', v_booking_id),
     jsonb_build_object('payment_mode', btrim(p_new_mode), 'booking_id', v_booking_id,
                         'closed_day_report_adjusted', v_report_touched),
     auth.uid(), btrim(p_reason))
  RETURNING id INTO v_txn_id;

  RETURN v_txn_id;
END;
$$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('238', 'fix-payment-mode-correction-closed-day')
ON CONFLICT (version) DO NOTHING;

COMMIT;
