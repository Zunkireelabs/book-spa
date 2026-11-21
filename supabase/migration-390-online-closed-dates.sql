-- Migration 390 (ZNLY-224): closed dates must block ONLINE booking for every tenant, room-less ones included.
-- Problem: the customer flow read closed days with a direct manual_blocks select; anon has no SELECT policy (mig 212), so it got []
-- and a closed day looked open. The room-based availability RPC hides closed days only by faking full rooms, so room-less tenants
-- (beauty) had nothing, and nothing on the server refused an online booking on a closed day.
-- (1) _closed_online_dates / public_get_closed_dates: SECURITY DEFINER, dates only (descriptions stay private). A closed date = a
--     whole-location, full-day (00:00, 1440 min) block with prevent_online_booking, not cancelled, expanded with the SAME recurrence
--     rules as the availability RPC (manual_block_occurrence_date, recurrence_count/end_date, manual_block_exceptions).
-- (2) trg_online_closed_date_check: an ONLINE insert (created_by IS NULL, request role anon/authenticated: same convention as
--     check_branch_online_capacity) on a closed date is refused: ERRCODE P0005, message 'BRANCH_CLOSED_ONLINE: ...'.
--     Staff/desk inserts (created_by set) and service/postgres roles are unaffected.
-- Idempotent. Rollback: DROP TRIGGER trg_online_closed_date_check ON bookings; DROP FUNCTION the four functions below.
BEGIN;

CREATE OR REPLACE FUNCTION public._closed_online_dates(p_branch_id uuid, p_start date, p_end date)
RETURNS TABLE(closed_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT occ.occ_date
  FROM public.manual_blocks mb
  CROSS JOIN LATERAL (
    SELECT public.manual_block_occurrence_date(mb.block_date, mb.recurrence_freq, mb.recurrence_interval, n) AS occ_date
    FROM generate_series(0, CASE WHEN mb.recurrence_freq IS NULL THEN 0 ELSE LEAST(COALESCE(mb.recurrence_count, 500) - 1, 500) END) AS n
  ) occ
  WHERE mb.branch_id = p_branch_id
    AND mb.room_id IS NULL
    AND mb.therapist_id IS NULL
    AND mb.start_time = '00:00:00'
    AND mb.duration_minutes = 1440
    AND mb.prevent_online_booking = true
    AND mb.is_cancelled = false
    AND occ.occ_date BETWEEN p_start AND p_end
    AND (mb.recurrence_end_date IS NULL OR occ.occ_date <= mb.recurrence_end_date)
    AND NOT EXISTS (
      SELECT 1 FROM public.manual_block_exceptions mbe
      WHERE mbe.series_id = mb.series_id AND mbe.exception_date = occ.occ_date
    );
$$;
REVOKE ALL ON FUNCTION public._closed_online_dates(uuid, date, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_get_closed_dates(p_branch_id uuid, p_start date, p_end date)
RETURNS TABLE(closed_date date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = p_branch_id AND br.is_active = true) THEN RETURN; END IF;
  IF p_end - p_start > 400 THEN p_end := p_start + 400; END IF;   -- bounded window for an anonymous caller
  RETURN QUERY SELECT * FROM public._closed_online_dates(p_branch_id, p_start, p_end) ORDER BY 1;
END $$;
REVOKE ALL ON FUNCTION public.public_get_closed_dates(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_get_closed_dates(uuid, date, date) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.check_online_closed_date()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.created_by IS NOT NULL OR COALESCE(current_setting('role', true), '') NOT IN ('anon', 'authenticated') OR NEW.status IN ('Cancelled', 'No Show') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public._closed_online_dates(NEW.branch_id, NEW.date, NEW.date)) THEN
    RAISE EXCEPTION 'BRANCH_CLOSED_ONLINE: We are closed on this date.' USING ERRCODE = 'P0005';
  END IF;
  RETURN NEW;
END $$;
-- _closed_online_dates is revoked from anon, so the trigger function reads it as its owner (hence current_setting('role'), the
-- request role PostgREST sets, rather than current_user, which a SECURITY DEFINER function reports as the owner):
ALTER FUNCTION public.check_online_closed_date() SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.check_online_closed_date() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_online_closed_date_check ON public.bookings;
CREATE TRIGGER trg_online_closed_date_check
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.check_online_closed_date();

INSERT INTO public.schema_migrations (version, name)
VALUES ('390', 'online-closed-dates')
ON CONFLICT (version) DO NOTHING;
COMMIT;
