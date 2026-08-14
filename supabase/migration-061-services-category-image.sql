-- Migration 061: services.category / services.image_url
--
-- Same class of drift as migration-059 (branches.open_time/close_time/timezone):
-- these columns are already live on staging (added directly via the dashboard
-- SQL editor at some point, never captured in a migration) — fetchServices(),
-- fetchServicesForManagement(), createService(), and updateServicePricing() in
-- src/services/api.js have all selected/written `category` and `image_url`
-- since service-category filtering (branches.excluded_service_categories) and
-- service images were added. schema.sql's services CREATE TABLE never picked
-- them up, so a fresh bootstrap (e.g. local OrbStack) fails with "column
-- services.category does not exist" and the customer/staff booking flows show
-- zero services (fetchServices' query throws, caught, and returns no data).
--
-- This supersedes the abandoned migration-050 ("backfill-service-categories",
-- excluded per supabase/PROMOTION.md — never committed/shipped): rather than
-- resurrect that file, this adds the columns fresh, idempotently, with a
-- default that matches createService()'s own fallback ('Spa').

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS category   text NOT NULL DEFAULT 'Spa',
  ADD COLUMN IF NOT EXISTS image_url  text;

-- Backfill categories for the seeded demo services (src/services/serviceEnrichment.js
-- carries the same mapping as a display-only fallback for services where the DB
-- value is absent — this just makes local data match that mapping instead of
-- everything defaulting to 'Spa').
UPDATE services SET category = 'Therapeutic' WHERE name = 'Deep Tissue Massage' AND category = 'Spa';
UPDATE services SET category = 'Relaxation'  WHERE name = 'Swedish Massage' AND category = 'Spa';
UPDATE services SET category = 'Specialty'   WHERE name = 'Hot Stone Therapy' AND category = 'Spa';
UPDATE services SET category = 'Wellness'    WHERE name = 'Aromatherapy Massage' AND category = 'Spa';
UPDATE services SET category = 'Traditional' WHERE name = 'Traditional Thai Massage' AND category = 'Spa';
UPDATE services SET category = 'Couples'     WHERE name = 'Couples Massage' AND category = 'Spa';
UPDATE services SET category = 'Specialty'   WHERE name = 'Prenatal Massage' AND category = 'Spa';
UPDATE services SET category = 'Therapeutic' WHERE name = 'Foot Reflexology' AND category = 'Spa';

INSERT INTO public.schema_migrations (version, name)
VALUES ('061', 'services-category-image')
ON CONFLICT (version) DO NOTHING;
