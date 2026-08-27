-- Add cancellation_reason to bookings (populated only for Cancelled / No Show status changes)
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS cancellation_reason text;

INSERT INTO public.schema_migrations (version, name)
VALUES ('116', 'add-cancellation-reason') ON CONFLICT (version) DO NOTHING;
