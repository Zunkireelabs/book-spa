-- Migration 246: beauty industry — staff-only booking, no rooms/stations (additive, REVERSIBLE)
--
-- Tenant sbal (lens/nails/eyebrows, modeled off Fresha) was onboarded onto 'salon', but salon
-- has enable_rooms=true (it assumes stylist stations). sbal never books against a room — only
-- staff. Rather than add a per-org room override (would complicate every future salon tenant
-- that *does* use stations), this adds a sibling industry with enable_rooms=false, following
-- 'cleaning's existing precedent (migration-015) of a staff-only, roomless industry.
--
-- createBooking in services/api.js already reads industries.enable_rooms dynamically per org's
-- industry_type (see api.js's room-handling block) — this migration requires zero booking-logic
-- code changes.
--
-- Reversible:
--   UPDATE organizations SET industry_type = 'salon' WHERE slug = 'sbal';
--   DELETE FROM industries WHERE id = 'beauty';

BEGIN;

INSERT INTO industries (
  id, name, description,
  staff_label, staff_label_plural,
  location_label, location_label_plural,
  session_label, session_label_plural,
  enable_rooms, enable_staff_gender, enable_specialties, enable_customer_gender,
  default_categories,
  icon, color
)
VALUES (
  'beauty',
  'Beauty & Aesthetics',
  'Lens, nails, eyebrows, and other beauty services — staff-only booking, no rooms/stations',
  'Staff', 'Staff',
  'Station', 'Stations',
  'Appointment', 'Appointments',
  false, true, true, true,
  '["Lens", "Nails", "Eyebrows", "Other"]'::jsonb,
  'sparkles', 'pink'
)
ON CONFLICT (id) DO NOTHING;

UPDATE organizations
SET industry_type = 'beauty'
WHERE slug = 'sbal' AND industry_type = 'salon';

INSERT INTO public.schema_migrations (version, name)
VALUES ('246', 'beauty-industry')
ON CONFLICT (version) DO NOTHING;

COMMIT;
