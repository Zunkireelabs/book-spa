-- Migration 284: admin_correct_booking's therapist_id correction didn't
-- actually reassign the therapist.
--
-- Idempotent: CREATE OR REPLACE FUNCTION on existing function names.
-- Reversible (manual): restore the pre-284 bodies of admin_correct_booking()
--   and enforce_booking_therapist_junction_guards() from migration-232 and
--   migration-258 respectively.
--
--
-- Why this exists
--
-- admin_correct_booking's whitelist (migration-232) includes therapist_id,
-- and writes it straight to bookings.therapist_id. But every real booking's
-- actual assignment — what the UI displays, and what every other write path
-- (assignTherapist(), the calendar, etc.) reads — lives in the
-- booking_therapists junction table instead; bookings.therapist_id is a
-- stale/secondary column nothing else consults once a junction row exists.
-- Confirmed directly against a corrected staging booking: therapist_id
-- updated to the new therapist, booking_therapists still held the old one,
-- UI kept showing the old therapist with zero error — a correction that
-- silently did nothing.
--
-- Fix: when therapist_id is in p_changes, admin_correct_booking additionally
-- replaces the booking's booking_therapists row(s) with a single row for the
-- new therapist (this RPC only ever whitelists one therapist_id — couple-
-- service multi-therapist correction isn't supported here, same limitation
-- the single-column whitelist already implied).
--
--
-- Why enforce_booking_therapist_junction_guards() also needs the bypass
--
-- That trigger calls check_therapist_booking_guards(), which rejects
-- eligibility/conflict/attendance issues that are completely normal reasons
-- an admin is correcting a booking in the first place (e.g. fixing months-
-- old data where the "new" therapist's current eligibility doesn't apply
-- retroactively). Without the same app.admin_correction + role=admin bypass
-- migration-232 already uses for enforce_booking_immutability(), the INSERT
-- below would frequently fail with an unrelated guard error instead of
-- completing the correction.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Junction guard trigger: add the same guarded bypass as migration-232's
--    enforce_booking_immutability(). Otherwise unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_booking_therapist_junction_guards()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_booking record;
BEGIN
  IF current_setting('app.admin_correction', true) = 'on'
     AND get_user_role() IS NOT DISTINCT FROM 'admin'::user_role THEN
    RETURN NEW;
  END IF;

  SELECT service_id, date, start_datetime, branch_id INTO v_booking
  FROM public.bookings WHERE id = NEW.booking_id;

  IF v_booking IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.check_therapist_booking_guards(NEW.therapist_id, v_booking.service_id, v_booking.date, v_booking.start_datetime, v_booking.branch_id);
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. admin_correct_booking(): sync booking_therapists when therapist_id
--    changes. Based on migration-239's body (NOT migration-232's — 239 fixed
--    a real bug here: bookings has no org_id column at all, so 232's
--    `(v_old->>'org_id')::uuid` always read NULL and the booking-org check
--    raised "booking is not in your organization" on every single call,
--    for every org. An earlier draft of this migration accidentally based
--    itself on 232's body and silently reintroduced that exact regression —
--    caught by re-testing the therapist correction end-to-end after first
--    applying it. Only the booking_therapists sync block below is new.
-- ---------------------------------------------------------------------------
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
  -- (migration-239's fix).
  SELECT org_id INTO v_booking_org FROM public.branches WHERE id = v_branch;

  IF v_booking_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'admin_correct_booking: booking is not in your organization'
      USING ERRCODE = 'P0003';
  END IF;

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

  -- Keep booking_therapists in sync — it's the table every read path (and
  -- every other write path) actually consults, not bookings.therapist_id.
  -- Single-row replace: this RPC only ever whitelists one therapist_id, so a
  -- couple-service booking with multiple junction rows collapses to one here
  -- (same limitation the single-column whitelist already implied).
  IF p_changes ? 'therapist_id' THEN
    DELETE FROM public.booking_therapists WHERE booking_id = p_booking_id;
    IF p_changes->>'therapist_id' IS NOT NULL THEN
      INSERT INTO public.booking_therapists (booking_id, therapist_id, room_id)
      VALUES (
        p_booking_id,
        (p_changes->>'therapist_id')::uuid,
        COALESCE(
          (p_changes->>'room_id')::uuid,
          (SELECT room_id FROM public.bookings WHERE id = p_booking_id)
        )
      );
    END IF;
  END IF;

  SELECT to_jsonb(b) INTO v_new FROM public.bookings b WHERE b.id = p_booking_id;

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

INSERT INTO public.schema_migrations (version, name)
VALUES ('284', 'admin-correct-therapist-junction-sync')
ON CONFLICT (version) DO NOTHING;

COMMIT;
