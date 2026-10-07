-- Migration 259: branch location fields (directions link + storefront photo)
--
-- LocationSection on the provider-profile page needs a "Get directions" link and an
-- optional storefront photo. Neither existed as a branches column — added here so the
-- customer-facing data-entry in supabase/seed-sbal-branch-address.sql has somewhere to land.

BEGIN;

ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS maps_url  text;
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS photo_url text;

INSERT INTO public.schema_migrations (version, name)
VALUES ('259', 'branch-location-fields')
ON CONFLICT (version) DO NOTHING;

COMMIT;
