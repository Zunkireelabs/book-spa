-- Migration 193: services offer fields (additive, REVERSIBLE)
--
-- Adds a manual, staff-toggled promotional offer to an individual service —
-- e.g. "Body Scrub, flat Rs. 4500 instead of Rs. 5000" or "30% off." No
-- start/end dates, no cron, no scheduling: the offer is active exactly as
-- long as offer_enabled is left true by a staff member (same interaction
-- model as the existing per-row Active toggle).
--
-- offer_type/offer_value are deliberately NOT constrained with a hard CHECK
-- tying them to offer_enabled — this repo prefers defensive SQL over rigid
-- constraints on drifted tables (see migration-184's LEFT JOIN + COALESCE
-- pattern). The app layer (createService/updateServicePricing) always nulls
-- out offer_type/offer_value when offer_enabled is false, and
-- compute_service_offer_pricing() (migration-195) treats any row with
-- offer_enabled = true but a null type/value as "no offer" rather than
-- erroring. This keeps the migration trivially safe on existing data and
-- easy to roll back.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   ALTER TABLE services DROP COLUMN IF EXISTS offer_enabled;
--   ALTER TABLE services DROP COLUMN IF EXISTS offer_type;
--   ALTER TABLE services DROP COLUMN IF EXISTS offer_value;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS offer_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS offer_type    text CHECK (offer_type IN ('percent', 'fixed')),
  ADD COLUMN IF NOT EXISTS offer_value   numeric(10, 2);

INSERT INTO public.schema_migrations (version, name)
VALUES ('193', 'services-offer-fields')
ON CONFLICT (version) DO NOTHING;
