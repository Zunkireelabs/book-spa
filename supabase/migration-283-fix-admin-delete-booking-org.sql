-- Migration 283: admin_delete_booking() — restore the migration-239 organization check
--
-- WHAT BROKE
--   Migration-239 fixed admin_correct_booking()/admin_delete_booking() reading `(v_old->>'org_id')`: public.bookings has NO
--   org_id column, so that expression is always NULL and every call failed with
--   "admin_delete_booking: booking is not in your organization". 239 resolves the org through branches instead.
--   Migration-260 then re-created admin_delete_booking() (to add the booking_tips blocker) from the PRE-239 body, silently
--   reintroducing the bug: on any database with 260 applied, every admin "Delete permanently" fails. (Confirmed locally.)
--
-- THE FIX
--   CREATE OR REPLACE admin_delete_booking() with migration-260's body EXACTLY (same blockers: payments, refunds, referrals,
--   package redemptions AND booking_tips; same audit row; same app.admin_correction flag) with ONE change: the org check
--   resolves the booking's org via branches, as in 239.
--
-- AUDIT OF THE REST
--   admin_correct_booking(): untouched since 239 (260 only redefined reschedule_booking, mark_tips_distributed and
--   admin_delete_booking) — still correct. admin_correct_voucher_balance / admin_void_voucher_claim /
--   admin_correct_package_sessions / admin_void_package_redemption (migration-233) also read `->>'org_id'`, but from
--   vouchers / voucher_claims / packages / package_redemptions, which DO have an org_id column — correct as is.
--
-- Idempotent (CREATE OR REPLACE, same signature). ROLLBACK: re-apply migration-260's admin_delete_booking.

BEGIN;

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
  v_booking_org uuid;
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

  -- bookings has no org_id column — resolve it through branches instead (the migration-239 fix that migration-260 undid).
  SELECT org_id INTO v_booking_org FROM public.branches WHERE id = v_branch;

  IF v_booking_org IS DISTINCT FROM v_org THEN
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
VALUES ('283', 'fix-admin-delete-booking-org')
ON CONFLICT (version) DO NOTHING;

COMMIT;
