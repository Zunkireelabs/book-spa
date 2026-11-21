-- Migration 417 (PROD security + behaviour drift, found by scripts/schema-drift.sh, ZNLY-353): production still carries
-- legacy objects that no migration creates and that contradict the migrations. Every step is IF EXISTS / guarded, so it is a
-- no-op on a database built from migrations only and fixes production. Nothing here touches rows.
--
-- C1 + C2  Nine legacy PERMISSIVE policies check `role = admin` (or "my own branch") with NO organisation check, so an admin
--          of business A could read/write business B (audit_logs read, customers update, therapists + rooms create/update,
--          therapist_attendance create/update/read). Checked before dropping: for every one of them an org-scoped policy for
--          the same command and for authenticated users already exists, so nobody loses access to their OWN org's rows:
--            audit_logs SELECT            -> "Manager can read own org audit logs" (manager + admin, org-scoped)
--            customers UPDATE             -> "Staff can update own org customers" (org_id = my org)
--            therapists INSERT / UPDATE   -> "Manager can create / update org therapists"
--            rooms INSERT / UPDATE        -> "Manager can create / update org rooms"
--            therapist_attendance INSERT / UPDATE -> "Manager can create / update own org therapist attendance"
--            therapist_attendance SELECT  -> "Staff can read own org therapist attendance"
-- C3       bookings "Anonymous users can create bookings" (anon INSERT, branch active) exists on migrations-built databases
--          (stage, local) but not on production. Anonymous customer bookings are covered by the anon_insert_bookings policy
--          on both shapes (api.js createBooking inserts directly for the public flow), so dropping it removes nothing.
-- C4       Production still runs the OLD attendance day lock (check_attendance_day_lock: any daily_reports row locks the day,
--          no is_locked, no self-punch exemption). Migrations 364/394 only replaced enforce_attendance_day_lock(), whose
--          trigger exists only in scripts/local-only-supplemental-triggers.sql. The old triggers and function go; the 394
--          function is bound as trg_enforce_attendance_day_lock (one lock, never two).
-- C5       Production refuses Close Day while Completed bookings are unpaid (trg_check_unpaid_before_close, SQLSTATE P0005).
--          Migration 392 (owner decision 2026-11-17): a Completed booking with a balance may be closed and collected after close.
-- C6       create_public_booking(...) is a legacy public RPC that exists only on production, executable by anon and
--          authenticated, and no code calls it (bookX src and zennly-marketplace were grepped). EXECUTE is revoked; the function
--          is kept (a later migration can drop it).
--
-- Idempotent. Reversible (manual): re-create the dropped policies/triggers from a prod dump; GRANT EXECUTE ON FUNCTION
-- public.create_public_booking(uuid, uuid, date, time, text, text, text, text) TO anon, authenticated.

BEGIN;

-- C1 + C2 + C3 -----------------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin can read all audit logs"            ON public.audit_logs;
DROP POLICY IF EXISTS "Managers can update branch customers"     ON public.customers;
DROP POLICY IF EXISTS "Manager can create branch therapists"     ON public.therapists;
DROP POLICY IF EXISTS "Manager can update branch therapists"     ON public.therapists;
DROP POLICY IF EXISTS "Manager can create branch rooms"          ON public.rooms;
DROP POLICY IF EXISTS "Manager can update branch rooms"          ON public.rooms;
DROP POLICY IF EXISTS "Manager can mark attendance"              ON public.therapist_attendance;
DROP POLICY IF EXISTS "Manager can update attendance"            ON public.therapist_attendance;
DROP POLICY IF EXISTS "Staff can read branch attendance"         ON public.therapist_attendance;
DROP POLICY IF EXISTS "Anonymous users can create bookings"      ON public.bookings;

-- C4 ---------------------------------------------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_attendance_day_lock_insert ON public.therapist_attendance;
DROP TRIGGER IF EXISTS trg_attendance_day_lock        ON public.therapist_attendance;
DROP FUNCTION IF EXISTS public.check_attendance_day_lock();
DROP TRIGGER IF EXISTS trg_enforce_attendance_day_lock ON public.therapist_attendance;
CREATE TRIGGER trg_enforce_attendance_day_lock
  BEFORE INSERT OR UPDATE ON public.therapist_attendance
  FOR EACH ROW EXECUTE FUNCTION public.enforce_attendance_day_lock();

-- C5 ---------------------------------------------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_check_unpaid_before_close ON public.daily_reports;
DROP FUNCTION IF EXISTS public.check_unpaid_before_daily_close();

-- C6 ---------------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.create_public_booking(uuid, uuid, date, time without time zone, text, text, text, text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.create_public_booking(uuid, uuid, date, time without time zone, text, text, text, text)
      FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('417', 'prod-drift-fixes')
ON CONFLICT (version) DO NOTHING;

COMMIT;
