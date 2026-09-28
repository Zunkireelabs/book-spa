-- Migration 232: let an admin correct or delete a booking that the immutability
-- trigger would otherwise freeze — a closed (locked) day, or a Completed
-- booking — with a mandatory reason and an audit_logs row for every change.
--
-- Idempotent: CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS.
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.admin_correct_booking(uuid, jsonb, text);
--   DROP FUNCTION IF EXISTS public.admin_delete_booking(uuid, text);
--   -- and restore the pre-232 body of enforce_booking_immutability() from
--   -- supabase/schema.sql. The ALTER TABLE below is additive and can stay.
--
--
-- Why this exists
--
-- Real production data is wrong: bookings recorded incorrectly, memberships
-- issued in error, wallet balances that do not match reality. Staff cannot fix
-- any of it once a day is closed, because `enforce_booking_immutability()`
-- raises DAY_LOCKED for ANY change to a row with is_locked = true, and
-- BOOKING_IMMUTABLE for structural changes to a Completed booking. That
-- trigger has no notion of role, so an admin is blocked exactly like a staff
-- member. The existing choices were to leave the data wrong or to edit
-- production by hand, and the second is how untracked state gets created.
--
-- Note what is NOT the problem here: memberships already have this. The
-- `adjustment` transaction kind plus `record_membership_transaction()`'s
-- admin-only guard has been in production use for a while (206 adjustment rows,
-- with notes like "Balance adjusted to match actual wallet balance"). This
-- migration brings bookings up to that same standard rather than inventing a
-- new mechanism.
--
--
-- Why a transaction-local flag instead of a role check inside the trigger
--
-- The trigger cannot simply allow every admin UPDATE. Admins use the ordinary
-- dashboard all day; if `get_user_role() = 'admin'` alone were enough to skip
-- immutability, then every routine admin action would silently bypass the
-- closed-day protection and nothing would record why. The protection would
-- effectively not exist for the role most able to damage the books.
--
-- So the bypass requires BOTH:
--   1. `app.admin_correction` set to 'on' for the current transaction, which
--      only the SECURITY DEFINER functions below ever set; and
--   2. `get_user_role() = 'admin'` re-checked inside the trigger itself.
--
-- Condition 2 is deliberate belt-and-braces. If some future RPC ever exposes
-- `set_config` to callers, the flag alone still will not let a manager or staff
-- member through. Neither condition is sufficient alone.
--
-- `set_config(..., true)` makes the setting transaction-local, so it cannot
-- leak to the next request that reuses the same pooled connection — which
-- matters here, because PostgREST hands out pooled connections and a session-
-- level flag would be a genuine security hole.
--
--
-- Why `is_locked` is NOT correctable
--
-- It was in the whitelist and has been removed. Setting is_locked = false
-- reopens a closed day permanently, after which ordinary staff can edit it
-- through the normal paths with no reason and no audit row — one audited action
-- silently converting into an unaudited open door. Nothing needs it: these
-- functions already bypass the lock for the specific booking being corrected,
-- which is the whole point, so reopening the day buys nothing a correction
-- cannot already do.
--
--
-- Why 'admin' and not 'admin_viewer'
--
-- `admin_viewer` is a read-only role (2 such accounts exist in production
-- against 6 real admins). It is excluded everywhere below, matching the guard
-- already used by `record_membership_transaction()`.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Audit reason
-- ---------------------------------------------------------------------------
-- audit_logs already carries old_data/new_data/changed_by/changed_at and holds
-- ~60k rows, so it is the right home for this; it just has nowhere to put the
-- human explanation. Nullable, so every existing row stays valid.
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS reason text;

COMMENT ON COLUMN public.audit_logs.reason IS
  'Operator-supplied justification. Required for admin corrections (action_type '
  'ADMIN_CORRECTION / ADMIN_DELETE); NULL for ordinary trigger-written rows.';

-- ---------------------------------------------------------------------------
-- 2. Immutability trigger: add the guarded bypass
-- ---------------------------------------------------------------------------
-- Body is otherwise unchanged from the pre-232 version. The only addition is
-- the bypass block at the top.
CREATE OR REPLACE FUNCTION public.enforce_booking_immutability()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Admin correction escape hatch. Requires the transaction-local flag set by
  -- admin_correct_booking()/admin_delete_booking() AND an admin role. See the
  -- header of migration 232 for why both are required.
  IF current_setting('app.admin_correction', true) = 'on'
     AND get_user_role() IS NOT DISTINCT FROM 'admin'::user_role THEN
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

-- ---------------------------------------------------------------------------
-- 3. admin_correct_booking()
-- ---------------------------------------------------------------------------
-- p_changes is a flat jsonb object of column -> new value. Only the columns in
-- the whitelist below can be set: an admin correcting a booking has no business
-- rewriting id, org_id, booking_number or the audit columns, and allowing
-- arbitrary keys would turn this into a generic "UPDATE anything" primitive.
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
  v_role      user_role := get_user_role();
  v_org       uuid      := get_user_org_id();
  v_old       jsonb;
  v_new       jsonb;
  v_branch    uuid;
  v_key       text;
  v_allowed   text[] := ARRAY[
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

  IF (v_old->>'org_id')::uuid IS DISTINCT FROM v_org THEN
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

-- ---------------------------------------------------------------------------
-- 4. admin_delete_booking()
-- ---------------------------------------------------------------------------
-- Hard delete, for a booking that should never have existed. Deliberately
-- separate from correction: this destroys the row, so it also disappears from
-- every historical report that counted it.
--
-- It cannot delete a booking that has money attached. `payments`,
-- `payment_refunds` and `customer_referrals` reference bookings ON DELETE
-- RESTRICT, and `package_redemptions` is NO ACTION — the database will refuse
-- regardless of what this function or the UI wants. Rather than let the caller
-- hit a raw foreign-key violation, the checks below name exactly what is
-- blocking and tell the admin to cancel-with-reason instead. Cancelling is
-- always available through admin_correct_booking() and keeps the trail.
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

  IF (v_old->>'org_id')::uuid IS DISTINCT FROM v_org THEN
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

REVOKE ALL ON FUNCTION public.admin_correct_booking(uuid, jsonb, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_delete_booking(uuid, text)        FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_correct_booking(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_booking(uuid, text)        TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('232', 'admin-booking-corrections')
ON CONFLICT (version) DO NOTHING;

COMMIT;
