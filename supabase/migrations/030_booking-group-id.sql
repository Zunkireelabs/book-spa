-- Migration 030: link bookings created together as a "group"
--
-- Product change: managers can now create a Group booking (Couple or Separate)
-- that produces one booking row per person. To recognize those rows as a single
-- group later (display, bulk actions), every row in the group shares one
-- booking_group_id UUID. Individual bookings leave it NULL — fully backward
-- compatible, no behavior change for existing rows.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS booking_group_id uuid;

CREATE INDEX IF NOT EXISTS idx_bookings_booking_group_id
  ON public.bookings (booking_group_id)
  WHERE booking_group_id IS NOT NULL;

-- Record this migration (no-op if already present).
INSERT INTO public.schema_migrations (version, name) VALUES
  ('030','booking-group-id')
ON CONFLICT (version) DO NOTHING;
