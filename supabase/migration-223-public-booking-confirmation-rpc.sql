-- Migration 223: RPC to read back an anon-created booking by its client_request_id
--
-- Prod incident (2026-09-24): every online/anonymous customer booking has silently
-- failed since 2026-08-19 (migration-097, "close anon cross-org bookings leak"). That
-- migration correctly dropped anon's unconditional SELECT on `bookings`, but
-- createBooking() (services/api.js) still does `.insert({...}).select().single()` for
-- every caller, including the public flow. Without any SELECT policy letting anon see
-- the row it just inserted, Postgres can't satisfy RETURNING under RLS and the whole
-- INSERT is rejected -- the customer sees a generic "something went wrong" error, and
-- zero anonymous bookings (`created_by IS NULL`) have landed since. Confirmed on prod:
-- last anon booking 2026-08-16, three days before the fix shipped.
--
-- Fix: give the public booking flow a narrow, unguessable way to read back its own row
-- instead of reopening broad anon SELECT on bookings. `client_request_id` already exists
-- on the table (added ad hoc, never wired up) -- the client generates a fresh random UUID
-- per booking attempt, the INSERT carries it (uses default return=minimal, so no RETURNING
-- involved), then this RPC fetches the confirmation fields for that exact request id.
-- Knowing another customer's client_request_id isn't feasible (it's a random UUID never
-- displayed anywhere), so this doesn't reopen the cross-org scraping hole migration-097
-- closed.
--
-- Idempotent: CREATE OR REPLACE / IF NOT EXISTS.
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.public_get_booking_by_request_id(uuid);
--   DROP INDEX IF EXISTS public.idx_bookings_client_request_id;
--
-- 2026-09-24 deploy failure: this migration was first written and verified
-- against staging, where `client_request_id` (added ad hoc, never tracked by
-- a migration file) is already `uuid`. Production's copy of the same ad hoc
-- column drifted to `text`, so the CREATE FUNCTION below (typed `uuid` param)
-- failed with "operator does not exist: text = uuid" and the whole deploy's
-- migration step aborted before recording this version. Normalizing the
-- column to `uuid` here (all 5,881 existing rows were NULL on prod, so the
-- cast is lossless) instead of loosening the function's param type, since
-- `uuid` is the correct type for a randomly-generated request id and staging
-- already has it right.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings'
      AND column_name = 'client_request_id' AND data_type = 'text'
  ) THEN
    ALTER TABLE public.bookings
      ALTER COLUMN client_request_id TYPE uuid USING client_request_id::uuid;
  END IF;
END $$;

-- Partial index: client_request_id is only ever set on the anon/online-booking path,
-- so most rows have it NULL — without this the RPC's WHERE clause is a full seq scan
-- over the whole (multi-tenant, ever-growing) bookings table on every confirmation.
CREATE INDEX IF NOT EXISTS idx_bookings_client_request_id
  ON public.bookings (client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.public_get_booking_by_request_id(
  p_client_request_id uuid
)
RETURNS TABLE (
  id uuid,
  booking_number text,
  date date,
  start_time time,
  base_amount numeric,
  service_name_snapshot text,
  room_name_snapshot text,
  therapist_name_snapshot text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT b.id, b.booking_number, b.date, b.start_time, b.base_amount,
         b.service_name_snapshot, b.room_name_snapshot, b.therapist_name_snapshot
  FROM public.bookings b
  WHERE b.client_request_id = p_client_request_id
    AND b.created_by IS NULL;
$$;

REVOKE ALL ON FUNCTION public.public_get_booking_by_request_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_get_booking_by_request_id(uuid) TO anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('223', 'public-booking-confirmation-rpc')
ON CONFLICT (version) DO NOTHING;
