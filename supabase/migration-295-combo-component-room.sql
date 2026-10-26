-- Migration 295: combo_package_components.default_same_room
--
-- Mirrors default_same_staff (migration-288): true (default) means the component
-- reuses the combo booking's single room (today's only behavior); false means
-- staff pick a separate room for that component in Quick Create, same pattern as
-- "different staff". A combo like a wrap (treatment room) + a blow-dry (styling
-- chair) genuinely happens in two different physical spaces.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- Reversible: ALTER TABLE public.combo_package_components DROP COLUMN IF EXISTS default_same_room;

BEGIN;

ALTER TABLE public.combo_package_components
  ADD COLUMN IF NOT EXISTS default_same_room boolean NOT NULL DEFAULT true;

INSERT INTO public.schema_migrations (version, name)
VALUES ('295', 'combo-component-room')
ON CONFLICT (version) DO NOTHING;

COMMIT;
