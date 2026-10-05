-- Migration 244: services.requires_therapist — replace name-regex heuristic with a real flag
-- CalendarGrid.jsx classifies a booking as "self-service, no therapist needed" by matching
-- /sauna|jacuzzi|steam/i against the service NAME. Works today because the catalog only has
-- single-topic Wellness services, but a future combo service like "Sauna + Massage" would
-- match the regex and get the wrong "just allocate a room" tooltip despite needing a
-- therapist. This adds a real boolean column and backfills it with the exact same regex, so
-- behavior is unchanged at ship time — only the going-forward classification mechanism
-- changes from inferring off the name to reading a stored flag.
-- Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS requires_therapist boolean NOT NULL DEFAULT true;

UPDATE public.services
SET requires_therapist = false
WHERE name ~* 'sauna|jacuzzi|steam';

INSERT INTO public.schema_migrations (version, name)
VALUES ('244', 'services-requires-therapist')
ON CONFLICT (version) DO NOTHING;

COMMIT;
