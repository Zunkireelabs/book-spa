-- Migration 040: daily reminder for "left-behind" bookings after a staff transfer
--                (Phase 2, step 3 — additive, REVERSIBLE)
--
-- When a staffer is transferred to another branch (transfer_therapist, migration-039) their
-- FUTURE bookings at the OLD branch are intentionally left in place. This job nudges the OLD
-- branch's team one day before each such booking so they can reassign or follow up — the
-- transferred staffer is NOT notified (they're a therapist record, not a login user).
--
-- A booking is "left behind" when, for a booking scheduled TOMORROW (Asia/Kathmandu) and not in
-- a terminal state, one of its assigned therapists (bookings.therapist_id OR the booking_therapists
-- junction) has a CURRENT branch different from the booking's branch AND has a staff_transfers row
-- showing they were transferred OUT of that booking's branch.
--
-- Recipients: every user whose branch_id = the booking's branch (managers, admins and staff
-- logins of the booking branch). Re-running the job never double-notifies the same user for the
-- same booking (NOT EXISTS guard on type + user + booking).
--
-- Notifications are inserted DIRECTLY (not via enqueue_notification) because the cron job has no
-- auth.uid() and enqueue_notification requires a manager/admin caller. This function is
-- SECURITY DEFINER (owner = postgres) so the INSERT bypasses RLS; it is NOT exposed to the API.
--
-- Idempotent (CREATE OR REPLACE / IF NOT EXISTS / named cron job) and portable (no hardcoded UUIDs).
--
-- Reversible:
--   SELECT cron.unschedule('notify-left-behind-bookings');
--   DROP FUNCTION IF EXISTS public.notify_left_behind_bookings();
--   -- (pg_cron extension left installed; harmless)

-- 1. Scheduler extension ------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. The reminder function ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_left_behind_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_target_date date := ((now() AT TIME ZONE 'Asia/Kathmandu')::date + 1);
  v_count int := 0;
BEGIN
  WITH left_behind AS (
    SELECT DISTINCT
      b.id            AS booking_id,
      b.branch_id     AS branch_id,
      b.booking_number,
      t.name          AS staff_name
    FROM public.bookings b
    JOIN LATERAL (
      SELECT b.therapist_id AS therapist_id WHERE b.therapist_id IS NOT NULL
      UNION
      SELECT bt.therapist_id FROM public.booking_therapists bt WHERE bt.booking_id = b.id
    ) a ON true
    JOIN public.therapists t ON t.id = a.therapist_id
    WHERE b.date = v_target_date
      AND b.status NOT IN ('Cancelled', 'Completed', 'No Show')
      AND t.branch_id <> b.branch_id
      AND EXISTS (
        SELECT 1 FROM public.staff_transfers st
        WHERE st.therapist_id = t.id
          AND st.from_branch_id = b.branch_id
      )
  ),
  recipients AS (
    SELECT lb.booking_id, lb.branch_id, lb.booking_number, lb.staff_name, u.id AS user_id
    FROM left_behind lb
    JOIN public.users u ON u.branch_id = lb.branch_id
  )
  INSERT INTO public.notifications (user_id, type, title, body, booking_id)
  SELECT
    r.user_id,
    'transferred_staff_reminder',
    'Transferred staff booking tomorrow',
    r.staff_name || ' has transferred to another branch but is still assigned to booking '
      || r.booking_number || ' here tomorrow. Please reassign or follow up.',
    r.booking_id
  FROM recipients r
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = r.user_id
      AND n.booking_id = r.booking_id
      AND n.type = 'transferred_staff_reminder'
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Cron-only: not part of the REST API surface --------------------------------
REVOKE ALL ON FUNCTION public.notify_left_behind_bookings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_left_behind_bookings() FROM anon;
REVOKE ALL ON FUNCTION public.notify_left_behind_bookings() FROM authenticated;

-- 3. Schedule it daily at 00:15 UTC = 06:00 Asia/Kathmandu -------------------
--    (the morning before the booking, giving ~1 day of notice). Named job ⇒
--    re-running this migration updates the existing schedule instead of duplicating.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-left-behind-bookings') THEN
    PERFORM cron.unschedule('notify-left-behind-bookings');
  END IF;
  PERFORM cron.schedule(
    'notify-left-behind-bookings',
    '15 0 * * *',
    'SELECT public.notify_left_behind_bookings();'
  );
END $$;

-- 4. Record migration --------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('040', 'left-behind-booking-reminders')
ON CONFLICT (version) DO NOTHING;
