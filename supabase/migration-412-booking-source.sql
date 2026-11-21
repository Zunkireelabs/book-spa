-- Migration 412 (ZNLY-332): bookings.booking_source — where a booking came from, when it is not the desk or the public page.
-- NULL = every existing path (desk, public booking page, groups, reschedules): no backfill, nothing changes for them.
-- 'marketplace' = created by public_create_booking (the Zennly marketplace). The list is extended later by replacing the CHECK.
-- No app code reads this column yet (no UI change); transformBooking maps named columns, so an extra column is ignored.
-- Idempotent: ADD COLUMN IF NOT EXISTS; the constraint is added only when missing.
-- Rollback (manual): ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_booking_source_check; ALTER TABLE public.bookings DROP COLUMN IF EXISTS booking_source;
--   (re-create bookings_safe first if it was re-created with SELECT * since)

BEGIN;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS booking_source text NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_booking_source_check' AND conrelid = 'public.bookings'::regclass) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_booking_source_check CHECK (booking_source IS NULL OR booking_source IN ('marketplace'));
  END IF;
END $$;

COMMENT ON COLUMN public.bookings.booking_source IS
  'Origin of a booking that is not the desk or the public page. NULL = existing paths. ''marketplace'' = public_create_booking (ZNLY-332).';

INSERT INTO public.schema_migrations (version, name)
VALUES ('412', 'booking-source')
ON CONFLICT (version) DO NOTHING;

COMMIT;
