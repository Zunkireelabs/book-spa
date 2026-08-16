-- Migration NNN: <one line — what this does>
-- Additive only where possible. Idempotent: safe to re-run in either database
-- (CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS +
-- recreate, ON CONFLICT DO NOTHING, guarded ALTERs/UPDATEs).
-- Applied: stage <YYYY-MM-DD> / prod <YYYY-MM-DD or HELD>.

BEGIN;

-- ... idempotent DDL/DML ...

INSERT INTO public.schema_migrations (version, name)
VALUES ('NNN', 'short-slug-matching-filename')
ON CONFLICT (version) DO NOTHING;

COMMIT;
