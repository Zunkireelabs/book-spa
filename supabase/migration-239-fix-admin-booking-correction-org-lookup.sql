-- Migration 239: fix the org-lookup bug in admin_correct_booking() and
-- admin_delete_booking() — the identical root cause just fixed in
-- admin_correct_payment_mode() (migration-238), found while investigating
-- that bug and confirmed by code inspection here.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, same signatures as migration-232
-- (no DROP FUNCTION needed, no re-grant needed).
-- Reversible (manual): re-run migration-232's original CREATE OR REPLACE
-- FUNCTION bodies for both functions.
-- Portable: no hardcoded UUIDs.
--
--
-- The bug
--
-- Both functions do:
--   SELECT to_jsonb(b), b.branch_id INTO v_old, v_branch
--   FROM public.bookings b WHERE b.id = p_booking_id;
--   ...
--   IF (v_old->>'org_id')::uuid IS DISTINCT FROM v_org THEN RAISE EXCEPTION ...
--
-- public.bookings has no org_id column at all (confirmed in supabase/schema.sql
-- — bookings only carries branch_id; org lives on branches, derived via
-- branch_id, same as every other org-scoping query/RLS policy in this
-- codebase, e.g. migration-012-org-rls-policies.sql and migration-178's
-- `SELECT org_id INTO v_branch_org FROM public.branches WHERE id = ...`
-- pattern).
--
-- Unlike the migration-238 payments bug, this doesn't crash: `jsonb ->> 'key'`
-- on a missing key returns SQL NULL rather than erroring, and
-- `NULL IS DISTINCT FROM <any real uuid>` is always true. So both functions
-- raise "booking is not in your organization" on literally every call, for
-- every org — a silent, total block rather than a loud crash, which is why it
-- went unnoticed until the payments equivalent's crash forced the comparison.
--
-- Fixed by resolving org_id through branches (already looked up as v_branch
-- for the audit_logs row), same pattern as migration-238.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_correct_booking(
  p_booking_id uuid,
  p_changes    jsonb,
  p_reason     text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role        user_role := get_user_role();
  v_org         uuid      := get_user_org_id();
  v_old         jsonb;
  v_new         jsonb;
  v_branch      uuid;
  v_booking_org uuid;
  v_key         text;
  v_allowed     text[] := ARRAY[
    'status', 'payment_status', 'date', 'start_time', 'end_time',
    'therapist_id', 'room_id', 'service_id', 'branch_id',
    'base_amount', 'discount_amount', 'discount_status', 'discount_reason',
    'customer_name', 'customer_phone', 'customer_id',
    'special_requests', 'notes'
  ];
  -- Tables whose org must be re-checked when a correction repoints the booking
  -- at a different row. See the org-scoping block below.
  v_bad     text;
  v_sql       text;
  v_sets      text[] := '{}';
  v_paid      numeric;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'admin_correct_booking: admin role required'
      USING ERRCODE = 'P0003';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'admin_correct_booking: a reason of at least 10 characters is required'
      USING ERRCODE = 'P0003';
  END IF;

  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'admin_correct_booking: p_changes must be a non-empty json object'
      USING ERRCODE = 'P0003';
  END IF;

  SELECT to_jsonb(b), b.branch_id INTO v_old, v_branch
  FROM public.bookings b WHERE b.id = p_booking_id;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'admin_correct_booking: booking % not found', p_booking_id
      USING ERRCODE = 'P0003';
  END IF;

  -- bookings has no org_id column — resolve it through branches instead
  -- (fixed bug; see header).
  SELECT org_id INTO v_booking_org FROM public.branches WHERE id = v_branch;

  IF v_booking_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'admin_correct_booking: booking is not in your organization'
      USING ERRCODE = 'P0003';
  END IF;

  -- Reject unknown/forbidden keys loudly rather than silently ignoring them —
  -- an admin who thinks they corrected a field that was quietly dropped is
  -- worse off than one who gets an error.
  FOR v_key IN SELECT jsonb_object_keys(p_changes) LOOP
    IF NOT (v_key = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'admin_correct_booking: column % is not correctable', v_key
        USING ERRCODE = 'P0003';
    END IF;
    v_sets := v_sets || format('%I = ($1->>%L)::text::%s', v_key, v_key,
      (SELECT format_type(a.atttypid, a.atttypmod)
         FROM pg_attribute a
        WHERE a.attrelid = 'public.bookings'::regclass
          AND a.attname = v_key AND a.attnum > 0));
  END LOOP;

  -- Org-scope every foreign key the correction repoints.
  --
  -- Checking that the *booking* belongs to the caller's org is not enough: the
  -- whitelist lets a correction write branch_id / customer_id / therapist_id /
  -- service_id / room_id, and nothing else validates those values. Writing
  -- another tenant's branch_id moves the booking into that tenant's view,
  -- because the RLS read policies are org-scoped on exactly that column. This
  -- is a multi-tenant boundary and must not depend on nobody pasting the wrong
  -- UUID.
  --
  -- rooms carries no org_id, only branch_id, so it is validated one hop out
  -- through branches.
  IF p_changes ? 'branch_id' AND p_changes->>'branch_id' IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.branches
                    WHERE id = (p_changes->>'branch_id')::uuid AND org_id = v_org) THEN
      v_bad := 'branch_id';
    END IF;
  END IF;

  IF v_bad IS NULL AND p_changes ? 'customer_id' AND p_changes->>'customer_id' IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.customers
                    WHERE id = (p_changes->>'customer_id')::uuid AND org_id = v_org) THEN
      v_bad := 'customer_id';
    END IF;
  END IF;

  IF v_bad IS NULL AND p_changes ? 'therapist_id' AND p_changes->>'therapist_id' IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.therapists
                    WHERE id = (p_changes->>'therapist_id')::uuid AND org_id = v_org) THEN
      v_bad := 'therapist_id';
    END IF;
  END IF;

  IF v_bad IS NULL AND p_changes ? 'service_id' AND p_changes->>'service_id' IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.services
                    WHERE id = (p_changes->>'service_id')::uuid AND org_id = v_org) THEN
      v_bad := 'service_id';
    END IF;
  END IF;

  IF v_bad IS NULL AND p_changes ? 'room_id' AND p_changes->>'room_id' IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.rooms r
                     JOIN public.branches b ON b.id = r.branch_id
                    WHERE r.id = (p_changes->>'room_id')::uuid AND b.org_id = v_org) THEN
      v_bad := 'room_id';
    END IF;
  END IF;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'admin_correct_booking: % does not belong to your organization', v_bad
      USING ERRCODE = 'P0003';
  END IF;

  PERFORM set_config('app.admin_correction', 'on', true);

  v_sql := format('UPDATE public.bookings SET %s WHERE id = %L',
                  array_to_string(v_sets, ', '), p_booking_id);
  EXECUTE v_sql USING p_changes;

  SELECT to_jsonb(b) INTO v_new FROM public.bookings b WHERE b.id = p_booking_id;

  -- Do not let a correction leave the booking owing less than was actually
  -- collected. trg_compute_final_amount recomputes final_amount from
  -- base_amount/discount_amount, but the payments rows do not move and
  -- payment_status stays 'paid' — so lowering the price on a settled booking
  -- silently produces a row that claims to be paid in full for less money than
  -- the drawer received. Checked after the UPDATE so the trigger-computed
  -- final_amount is the value being judged, and raising here rolls the whole
  -- transaction back.
  --
  -- Scoped to corrections that actually move money. An already-overpaid booking
  -- (possible via group payments recorded against one row) would otherwise have
  -- every correction blocked, including harmless ones like fixing a misspelt
  -- customer name — a guard that punishes the wrong edit. Production currently
  -- has zero such bookings, so this is about not leaving a trap behind.
  IF (p_changes ? 'base_amount' OR p_changes ? 'discount_amount') THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.payments WHERE booking_id = p_booking_id;
  ELSE
    v_paid := 0;
  END IF;

  IF v_paid > 0 AND (v_new->>'final_amount')::numeric < v_paid THEN
    RAISE EXCEPTION 'CORRECTION_BELOW_PAID: this correction would set the total to % while % has already been paid. Record a refund first, then correct the amount.',
      (v_new->>'final_amount')::numeric, v_paid
      USING ERRCODE = 'P0004';
  END IF;

  INSERT INTO public.audit_logs
    (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by, reason)
  VALUES
    (v_branch, 'bookings', p_booking_id, 'ADMIN_CORRECTION', v_old, v_new, auth.uid(), btrim(p_reason));

  RETURN p_booking_id;
END;
$function$;

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
  v_role        user_role := get_user_role();
  v_org         uuid      := get_user_org_id();
  v_old         jsonb;
  v_branch      uuid;
  v_booking_org uuid;
  v_blockers    text[] := '{}';
  v_links       jsonb;
  v_n           int;
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

  -- bookings has no org_id column — resolve it through branches instead
  -- (fixed bug; see header).
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
VALUES ('239', 'fix-admin-booking-correction-org-lookup')
ON CONFLICT (version) DO NOTHING;

COMMIT;
