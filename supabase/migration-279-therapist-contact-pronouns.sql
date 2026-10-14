-- Migration 279: email + pronouns for staff (therapists)
-- Additive only. Idempotent: safe to re-run in either database.
-- Applied: stage 2026-10-13 / prod HELD.
--
-- Staff-internal profile fields, same precedent as phone/address/city
-- (migration-277): editable on the staff Edit page, not surfaced on the
-- public provider-profile/booking flow in this pass.

BEGIN;

ALTER TABLE public.therapists
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS pronouns text;

INSERT INTO public.schema_migrations (version, name)
VALUES ('279', 'therapist-contact-pronouns')
ON CONFLICT (version) DO NOTHING;

COMMIT;
