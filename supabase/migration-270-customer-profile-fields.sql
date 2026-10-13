-- Migration 270: additional customer profile fields (Fresha-style)
-- Additive only. Idempotent: safe to re-run in either database.
-- Applied: stage <YYYY-MM-DD> / prod HELD.
--
-- No RLS policy change needed: "Staff can update branch customers" (see
-- rls.sql) is a row-level predicate only (branch_id = get_user_branch_id()),
-- not column-restricted, so these new columns are automatically writable
-- under the existing policy. Do not "fix" this later -- it's not a gap.

BEGIN;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS client_source text,
  ADD COLUMN IF NOT EXISTS referred_by text,
  ADD COLUMN IF NOT EXISTS preferred_language text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS occupation text,
  ADD COLUMN IF NOT EXISTS additional_email text,
  ADD COLUMN IF NOT EXISTS additional_phone text,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS pronouns text,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

INSERT INTO public.schema_migrations (version, name)
VALUES ('270', 'customer-profile-fields')
ON CONFLICT (version) DO NOTHING;

COMMIT;
