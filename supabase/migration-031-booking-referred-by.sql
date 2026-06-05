-- Migration 031: record who referred a booking
--
-- Product change: the booking details modal now has a "Referred by" field.
-- The user types a name freely or picks an existing therapist (autocomplete);
-- either way the chosen/typed name is stored as plain text. Existing rows stay
-- NULL — fully backward compatible, no behavior change.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS referred_by text;

-- Record this migration (no-op if already present).
INSERT INTO public.schema_migrations (version, name) VALUES
  ('031','booking-referred-by')
ON CONFLICT (version) DO NOTHING;
