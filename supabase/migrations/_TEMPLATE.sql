-- Migration NNN: <one line — what this does>
--
-- Additive only. Wrap in BEGIN/COMMIT. Include:
--   Expected before/after row counts: <table X: A -> B (or "0 rows touched")>.
--   Rollback: <the inverse — e.g. DROP TABLE IF EXISTS foo; / "policy-only, re-apply 0NN">.
--   Applied: staging <YYYY-MM-DD> / prod <YYYY-MM-DD or HELD>.
--
-- Copy this file to the NEXT FREE number: `ls supabase/migrations | sort` -> +1.
-- One number = one file, globally unique. Never reuse a number (except the
-- historical 008a/008b split — that pattern is retired, don't repeat it).
-- (This _TEMPLATE.sql is not a real migration — the leading underscore keeps it
--  out of the numbered sequence; do not apply it.)

BEGIN;

-- ... your additive DDL / DML here ...
-- New org-owned table? org_id UUID REFERENCES organizations(id) ON DELETE CASCADE
-- + RLS: scope via get_user_org_id() (see supabase/migrations/011_org-rls-helper.sql).
--
-- MAKE EVERY STATEMENT IDEMPOTENT (safe to run twice). scripts/migrate-apply.sh
-- may re-encounter a migration on retry; a non-idempotent statement then errors
-- and, being fail-closed, blocks the deploy. Use:
--   CREATE TABLE IF NOT EXISTS ... ; CREATE INDEX IF NOT EXISTS ... ;
--   ALTER TABLE ... ADD COLUMN IF NOT EXISTS ... ;
--   DROP POLICY IF EXISTS "p" ON t;  CREATE POLICY "p" ON t ... ;   -- policies have no IF NOT EXISTS
--   INSERT ... ON CONFLICT DO NOTHING;   UPDATE ... WHERE <guard so a re-run is a no-op>;

-- REQUIRED: self-record in the ledger. `version` is the file's leading number
-- ONLY (no filename, no extension) — e.g. this file's own number, as a string.
-- `name` is the short dash-case description from the filename. Applied by hand
-- (dashboard/psql) AND by scripts/migrate-apply.sh, so the ledger row MUST live
-- here — a migration that omits this drifts the ledger and gets re-run forever.
-- CI enforces this for new migrations (scripts/check-migrations.sh, floor 052);
-- do not remove it.
INSERT INTO public.schema_migrations (version, name)
VALUES ('NNN', 'short-dash-case-name')
ON CONFLICT (version) DO NOTHING;

COMMIT;
