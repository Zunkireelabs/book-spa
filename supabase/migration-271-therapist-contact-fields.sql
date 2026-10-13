-- Migration 271: phone/address/city fields on therapists (Fresha-style)
-- Additive only. Idempotent: safe to re-run in either database.
-- Applied: stage <YYYY-MM-DD> / prod HELD.
--
-- No RLS policy change needed: the existing manager/admin UPDATE policy on
-- therapists is row-level only, not column-restricted, so these new columns
-- are automatically writable under the existing policy.

BEGIN;

ALTER TABLE public.therapists
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS city text;

INSERT INTO public.schema_migrations (version, name)
VALUES ('271', 'therapist-contact-fields')
ON CONFLICT (version) DO NOTHING;

COMMIT;
