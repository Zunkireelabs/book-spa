-- Migration 247: therapist profile fields — photo/bio/experience (additive, REVERSIBLE)
--
-- "Complete staff profile like Fresha/GetTimely" — admin-settable per staff member. photo_url
-- is a plain URL text field (no new upload flow/storage bucket). experience_years gets a
-- non-negative CHECK, following migration-042/046's plain ADD CONSTRAINT style (no IF NOT
-- EXISTS guard on constraints — matches existing repo convention).
--
-- Reversible:
--   ALTER TABLE public.therapists DROP CONSTRAINT IF EXISTS therapists_experience_years_check;
--   ALTER TABLE public.therapists DROP COLUMN IF EXISTS photo_url, DROP COLUMN IF EXISTS bio,
--     DROP COLUMN IF EXISTS experience_years;

BEGIN;

ALTER TABLE public.therapists
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS experience_years integer;

ALTER TABLE public.therapists
  ADD CONSTRAINT therapists_experience_years_check
  CHECK (experience_years IS NULL OR experience_years >= 0);

INSERT INTO public.schema_migrations (version, name)
VALUES ('247', 'therapist-profile-fields')
ON CONFLICT (version) DO NOTHING;

COMMIT;
