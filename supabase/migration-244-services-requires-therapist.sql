-- Migration 244: services.requires_therapist — backs the unassigned-column self-service badge
-- CalendarGrid.jsx's unassigned column needs to tell apart services that can run unattended
-- (sauna/jacuzzi/steam) from ones that need a therapist, so it can show the right
-- "just allocate a room" badge vs. requiring an assignment. This is net-new functionality,
-- not a replacement for an existing name-regex check — none exists on stage today. Backfills
-- the new boolean column using a one-time regex over current service names so existing rows
-- classify correctly; going forward, the column is the source of truth, not the name.
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
