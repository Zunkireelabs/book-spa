-- Couple services are priced once for the pair, not per person. Nothing in the schema could
-- express that -- it was pure naming convention (e.g. "Couple Massage Wellness Date"). That
-- caused two real bugs once actual couple services existed:
--
--   1. The group-booking flow creates one independent bookings row per person, each charging
--      the full service price -- a couple service picked there gets billed twice.
--   2. feature/couple-separate-rooms' companion (room-split) UI had no way to scope itself to
--      couple services, so it showed for ANY 2-therapist assignment regardless of service.
--
-- This flag lets both surfaces gate on the actual service, not a name guess.

ALTER TABLE services ADD COLUMN IF NOT EXISTS is_couple boolean NOT NULL DEFAULT false;

INSERT INTO public.schema_migrations (version, name)
VALUES ('172', 'services-is-couple') ON CONFLICT (version) DO NOTHING;
