-- Seed: sbal branch location details (address, phone, maps link, storefront photo)
--
-- Data, not schema — stays a manual step per supabase/PROMOTION.md, run separately
-- against staging and production since they share no rows. Idempotent and resolves by
-- org slug + branch name (not UUID) so the same script runs on both databases.
--
-- Requires migration-259 (maps_url, photo_url columns) to already be applied.
--
-- photo_url points at the service-images bucket's public URL (branding/ prefix) for
-- whichever Supabase project this runs against:
--   staging:    https://snzcckzfmpboeqkktmwy.supabase.co/storage/v1/object/public/service-images/branding/sbal-storefront.webp
--   production: https://pmbvogiphelmpjdalmtv.supabase.co/storage/v1/object/public/service-images/branding/sbal-storefront.webp
-- Each project's object has to be uploaded separately (storage buckets are per-project,
-- same as rows) via Supabase dashboard -> Storage -> service-images -> upload to that
-- path -> copy its public URL. This script assumes the staging object is already there;
-- swap the photo_url value below for production's upload before running there.

UPDATE public.branches b
SET address   = 'Lazimpat Rd, Kathmandu, Bagmati Province 44600',
    phone     = '+977-9705385984',
    maps_url  = 'https://www.google.com/maps/dir//Sami''s+Brow+and+Lashes+Kathmandu,+Lazimpat+Rd,+Kathmandu,+Bagmati+Province+44600/@27.6758528,85.3147648,14z/data=!4m8!4m7!1m0!1m5!1m1!1s0x39eb19644e2f748d:0xd170cc635521737e!2m2!1d85.3250278!2d27.7283789!5m1!1e1?entry=ttu&g_ep=EgoyMDI2MTAwNC4wIKXMDSoASAFQAw%3D%3D',
    photo_url = 'https://snzcckzfmpboeqkktmwy.supabase.co/storage/v1/object/public/service-images/branding/sbal-storefront.webp'
FROM public.organizations o
WHERE o.id = b.org_id
  AND o.slug = 'sbal'
  AND b.name = 'Main Branch';
