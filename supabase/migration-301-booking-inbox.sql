-- Migration 301: booking inbox — a persisted "new online booking" notification, plus team-level acknowledgement
--
-- PROBLEM
--   * A customer booking online (public flow, created_by IS NULL) created NO persisted notification: the "new booking"
--     toast was client-side realtime only, so anyone not looking at that moment missed it and the bell never showed it.
--   * Nothing recorded whether ANYONE on the team had looked at a booking, so the Bookings list could only approximate
--     "unopened" (online + Pending).
--
-- WHAT THIS ADDS
--   1. bookings.acknowledged_at / acknowledged_by — set ONCE, by the first staff member who opens or handles the booking.
--   2. acknowledge_booking(p_booking_id) — SECURITY DEFINER RPC that sets them (only if still NULL), also marks every
--      team member's `new_online_booking` notification for that booking as read ("the team handled it"), and returns who/when.
--   3. enforce_booking_immutability() gets a narrow, guarded bypass so a booking on a CLOSED day (is_locked) or a Completed
--      one can still be acknowledged. Same pattern as migration-232's admin-correction escape hatch: a transaction-local flag
--      that only acknowledge_booking() sets, AND the update must change nothing but acknowledged_at / acknowledged_by /
--      updated_at. Any other column in the same UPDATE falls through to the normal checks. The same trigger refuses ANY other
--      change to acknowledged_at/acknowledged_by (so a direct PATCH can't forge "seen by"), and a BEFORE INSERT trigger nulls them
--      on new rows.
--   4. notify_new_online_booking() AFTER INSERT trigger (WHEN created_by IS NULL): one `new_online_booking` notification per
--      recipient, title "New online booking", body "<Customer> · <Service> · Thu 15 Oct, 2:00pm". Multi-service visits
--      (one row per service, shared booking_group_id) notify once. It never blocks a customer's booking: any failure inside
--      is downgraded to a WARNING.
--   5. Backfill: every booking that is not Pending is treated as already acknowledged (acknowledged_at = created_at, by NULL)
--      so old data does not light up. Pending online bookings stay unacknowledged.
--
-- RECIPIENT RULE (who gets the notification)
--   Active users of the booking's organization with role
--     * admin                       — org-wide, every branch, or
--     * manager / staff             — whose branch is the booking's branch (users.branch_id, or a row in user_branches).
--   admin_viewer is read-only and is not notified.
--
-- CUSTOMER RESCHEDULE / CANCEL
--   The public flow has no customer-initiated reschedule or cancel (public_cancel_booking_group is only the internal
--   rollback of a half-created multi-service visit), so there is no `online_booking_changed` notification.
--
-- RLS: no new policies. notifications rows are still written only by SECURITY DEFINER code (enqueue_notification and the
-- trigger below); users keep read/update on their OWN rows only.
--
-- ROLLBACK (manual):
--   DROP TRIGGER IF EXISTS trg_bookings_clear_acknowledgement ON public.bookings;
--   DROP FUNCTION IF EXISTS public.bookings_clear_acknowledgement_on_insert();
--   DROP TRIGGER IF EXISTS trg_notify_new_online_booking ON public.bookings;
--   DROP FUNCTION IF EXISTS public.notify_new_online_booking();
--   DROP FUNCTION IF EXISTS public.acknowledge_booking(uuid);
--   ALTER TABLE public.bookings DROP COLUMN IF EXISTS acknowledged_by, DROP COLUMN IF EXISTS acknowledged_at;
--   (and restore enforce_booking_immutability() from migration-232 minus the acknowledgement block)

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.bookings.acknowledged_at IS
  'When the first staff member opened/handled this booking (team-level "seen"). NULL on an online booking = nobody has looked yet.';
COMMENT ON COLUMN public.bookings.acknowledged_by IS
  'Who acknowledged it first. NULL with acknowledged_at set = backfilled (pre-dates the inbox).';

-- ---------------------------------------------------------------------------
-- 2. Immutability trigger: guarded acknowledgement bypass
-- ---------------------------------------------------------------------------
-- Body is unchanged from migration-232 except for the new block at the top.
CREATE OR REPLACE FUNCTION public.enforce_booking_immutability()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Acknowledgement escape hatch (migration 301): only acknowledge_booking() sets this transaction-local flag, and the
  -- UPDATE must touch nothing but the acknowledgement columns (+ updated_at). Everything else is still fully enforced.
  IF current_setting('app.acknowledging', true) = 'on'
     AND (to_jsonb(NEW) - 'acknowledged_at' - 'acknowledged_by' - 'updated_at')
         = (to_jsonb(OLD) - 'acknowledged_at' - 'acknowledged_by' - 'updated_at') THEN
    RETURN NEW;
  END IF;

  -- Nobody can set or change "who saw it" by a direct UPDATE (bookings UPDATE RLS lets staff PATCH rows): only acknowledge_booking()
  -- may touch these columns. (admin_correct_booking never does.)
  IF NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
     OR NEW.acknowledged_by IS DISTINCT FROM OLD.acknowledged_by THEN
    RAISE EXCEPTION 'ACKNOWLEDGEMENT_PROTECTED: acknowledged_at / acknowledged_by can only be set by acknowledge_booking().'
      USING ERRCODE = 'P0001';
  END IF;

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
-- 3. Backfill: everything that is not Pending counts as acknowledged
-- ---------------------------------------------------------------------------
-- A blanket UPDATE would fire every column-agnostic BEFORE/AFTER UPDATE trigger on bookings, and some of those validate the row
-- (trg_enforce_therapist_required RAISEs for a legacy In-Progress/Completed row with no therapist; the immutability trigger refuses
-- locked rows). This is bookkeeping, not an edit, so exactly these named triggers are switched off around the UPDATE and only the
-- ones that were enabled are switched back on (never DISABLE TRIGGER USER, never session_replication_role). The column-specific
-- "UPDATE OF …" triggers don't fire for this UPDATE, so they are left alone.
DO $backfill$
DECLARE
  t       text;
  was_on  text[] := ARRAY[]::text[];
BEGIN
  FOREACH t IN ARRAY ARRAY['trg_updated_at', 'trg_enforce_booking_immutability', 'trg_enforce_therapist_required',
                           'trg_handle_booking_cancellation_refund', 'trg_audit_booking_changes']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.bookings'::regclass AND tgname = t AND tgenabled <> 'D') THEN
      EXECUTE format('ALTER TABLE public.bookings DISABLE TRIGGER %I', t);
      was_on := was_on || t;
    END IF;
  END LOOP;

  UPDATE public.bookings
     SET acknowledged_at = created_at
   WHERE acknowledged_at IS NULL
     AND status <> 'Pending';

  FOREACH t IN ARRAY was_on LOOP
    EXECUTE format('ALTER TABLE public.bookings ENABLE TRIGGER %I', t);
  END LOOP;
END
$backfill$;

-- ---------------------------------------------------------------------------
-- 4. acknowledge_booking(p_booking_id) — first open/handle wins
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acknowledge_booking(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role        user_role := get_user_role();
  v_org         uuid      := get_user_org_id();
  v_uid         uuid      := auth.uid();
  v_booking     record;
  v_branch_org  uuid;
  v_changed     integer   := 0;
  v_at          timestamptz;
  v_by          uuid;
BEGIN
  -- admin_viewer is read-only: opening a booking must not "handle" it.
  IF v_uid IS NULL OR v_role IS NULL OR v_role NOT IN ('staff', 'manager', 'admin') THEN
    RAISE EXCEPTION 'acknowledge_booking: staff, manager, or admin role required'
      USING ERRCODE = '42501';
  END IF;

  SELECT id, branch_id, acknowledged_at, acknowledged_by INTO v_booking
    FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'acknowledge_booking: booking % not found', p_booking_id;
  END IF;

  SELECT br.org_id INTO v_branch_org FROM public.branches br WHERE br.id = v_booking.branch_id;
  IF v_branch_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'acknowledge_booking: booking does not belong to your organization'
      USING ERRCODE = '42501';
  END IF;
  -- staff / manager only for their own branch(es); admin is org-wide
  IF v_role <> 'admin' AND NOT (v_booking.branch_id = ANY (get_user_branch_ids())) THEN
    RAISE EXCEPTION 'acknowledge_booking: booking is not in your branch'
      USING ERRCODE = '42501';
  END IF;

  IF v_booking.acknowledged_at IS NULL THEN
    PERFORM set_config('app.acknowledging', 'on', true);
    UPDATE public.bookings
       SET acknowledged_at = now(), acknowledged_by = v_uid
     WHERE id = p_booking_id AND acknowledged_at IS NULL;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    PERFORM set_config('app.acknowledging', 'off', true);
  END IF;

  -- The team handled it: clear everyone's bell item for this booking (they stay listed, shown as "Seen by …").
  IF v_changed > 0 THEN
    UPDATE public.notifications
       SET read = true
     WHERE booking_id = p_booking_id
       AND type = 'new_online_booking'
       AND read = false;
  END IF;

  SELECT b.acknowledged_at, b.acknowledged_by INTO v_at, v_by FROM public.bookings b WHERE b.id = p_booking_id;

  RETURN jsonb_build_object(
    'acknowledged_now', v_changed > 0,
    'acknowledged_at', v_at,
    'acknowledged_by', v_by
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.acknowledge_booking(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acknowledge_booking(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_booking(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Fan-out trigger: a persisted notification per recipient for every online booking
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_new_online_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org   uuid;
  v_body  text;
BEGIN
  -- A multi-service visit is one row per service sharing a booking_group_id: notify once, on the first row.
  IF NEW.booking_group_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.notifications n
      JOIN public.bookings b2 ON b2.id = n.booking_id
     WHERE n.type = 'new_online_booking'
       AND b2.booking_group_id = NEW.booking_group_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT br.org_id INTO v_org FROM public.branches br WHERE br.id = NEW.branch_id;
  IF v_org IS NULL THEN
    RETURN NEW;
  END IF;

  v_body := concat_ws(' · ',
    NULLIF(NEW.customer_name, ''),
    NULLIF(NEW.service_name_snapshot, ''),
    to_char(NEW.date, 'Dy FMDD Mon') || ', ' || lower(to_char(NEW.start_time, 'FMHH12:MIAM'))
  );

  INSERT INTO public.notifications (user_id, type, title, body, booking_id)
  SELECT u.id, 'new_online_booking', 'New online booking', v_body, NEW.id
    FROM public.users u
   WHERE u.org_id = v_org
     AND u.is_active
     AND (
       u.role = 'admin'
       OR (
         u.role IN ('manager', 'staff')
         AND (
           u.branch_id = NEW.branch_id
           OR EXISTS (SELECT 1 FROM public.user_branches ub WHERE ub.user_id = u.id AND ub.branch_id = NEW.branch_id)
         )
       )
     );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification problem fail a customer's booking.
  RAISE WARNING 'notify_new_online_booking failed for booking %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_new_online_booking() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_new_online_booking() FROM anon;
REVOKE ALL ON FUNCTION public.notify_new_online_booking() FROM authenticated;

-- A new row can't be born "already seen" either (anon/staff INSERT policies allow any column).
CREATE OR REPLACE FUNCTION public.bookings_clear_acknowledgement_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.acknowledged_at := NULL;
  NEW.acknowledged_by := NULL;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_bookings_clear_acknowledgement ON public.bookings;
CREATE TRIGGER trg_bookings_clear_acknowledgement
  BEFORE INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.bookings_clear_acknowledgement_on_insert();

DROP TRIGGER IF EXISTS trg_notify_new_online_booking ON public.bookings;
CREATE TRIGGER trg_notify_new_online_booking
  AFTER INSERT ON public.bookings
  FOR EACH ROW
  WHEN (NEW.created_by IS NULL)
  EXECUTE FUNCTION public.notify_new_online_booking();

INSERT INTO public.schema_migrations (version, name)
VALUES ('301', 'booking-inbox')
ON CONFLICT (version) DO NOTHING;

COMMIT;
