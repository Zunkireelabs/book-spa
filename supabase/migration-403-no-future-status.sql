-- Migration 403 (ZNLY-275): a booking for a LATER day cannot be Started, Completed or marked No Show.
--
-- Rule (all tenants, every path): bookings.status may move INTO 'In-Progress', 'Completed' or 'No Show' only if the booking's
-- date <= today in Nepal time. Cancel, edit, reschedule, pre-payments and deposits on future bookings stay allowed. An early guest:
-- staff move the booking to today first.
--   * fires only when the status actually changes into one of the three (INSERT: when inserted as one of them), so an existing
--     future-dated Completed row can still be edited or cancelled
--   * RAISEs ERRCODE 'P0275' with HINT 'FUTURE_BOOKING_STATUS' and a staff-readable, CODE-prefixed message the app shows as is
--   * only bookings carries booking_status (bookings_safe is a view), so there are no child status tables to guard
--
-- Reversible: DROP TRIGGER IF EXISTS trg_bookings_no_future_status ON public.bookings;
--             DROP FUNCTION IF EXISTS public.enforce_no_future_status();

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_no_future_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_verb  text;
BEGIN
  IF NEW.status NOT IN ('In-Progress', 'Completed', 'No Show') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.date <= v_today THEN
    RETURN NEW;
  END IF;
  v_verb := CASE NEW.status WHEN 'In-Progress' THEN 'start it now' WHEN 'Completed' THEN 'complete it now' ELSE 'mark it as no-show' END;
  RAISE EXCEPTION 'FUTURE_BOOKING: This booking is for %. Move it to today to %.', to_char(NEW.date, 'FMDy FMDD FMMon'), v_verb
    USING ERRCODE = 'P0275', HINT = 'FUTURE_BOOKING_STATUS';
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_no_future_status ON public.bookings;
CREATE TRIGGER trg_bookings_no_future_status
  BEFORE INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_no_future_status();

INSERT INTO public.schema_migrations (version, name)
VALUES ('403', 'no-future-status')
ON CONFLICT (version) DO NOTHING;

COMMIT;
