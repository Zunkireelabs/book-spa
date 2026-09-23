-- Migration 194: service_categories offer fields (additive, REVERSIBLE)
--
-- Category-wide counterpart to migration-193: lets a whole category (e.g.
-- "Facial Treatments") carry a percentage-off offer that every service in
-- it inherits, unless that service has its own offer enabled (which always
-- wins — see compute_service_offer_pricing(), migration-195). Percent-only
-- at the category level, deliberately: a flat NPR override can't sensibly
-- apply across services of different base prices in the same category, so
-- unlike services (migration-193), no offer_type column here.
--
-- service_categories has no tracked CREATE TABLE migration (pre-existing
-- drift, called out in migration-184's own comments) — this migration only
-- ever ALTERs it, never assumes it can create it. (Local dev's fresh
-- bootstrap gets the table from scripts/local-only-supplemental-service-categories.sql,
-- run before migrations replay — see that file for the full story. Staging/
-- production already have the table live via a dashboard-created object
-- that predates any tracked migration.)
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   ALTER TABLE service_categories DROP COLUMN IF EXISTS offer_enabled;
--   ALTER TABLE service_categories DROP COLUMN IF EXISTS offer_percent;

ALTER TABLE service_categories
  ADD COLUMN IF NOT EXISTS offer_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS offer_percent numeric(5, 2);

INSERT INTO public.schema_migrations (version, name)
VALUES ('194', 'service-categories-offer-fields')
ON CONFLICT (version) DO NOTHING;
