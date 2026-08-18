-- Migration 053: add-admin-viewer-role (RECONSTRUCTED — not the original applied SQL)
--
-- ⚠️ PROVENANCE: Applied directly to production via the Supabase dashboard SQL editor,
-- never committed. No literal record survives (not in this repo, not in
-- supabase_migrations.schema_migrations, which only covers June 2026 onward).
-- Reconstructed on 2026-08-13 by Deployment Operator from the live schema dump
-- (supabase/baseline/schema.sql) to document net effect and bring a from-scratch
-- database to parity. Best-effort, NOT a byte-identical replay.
--
-- Net effect modeled here: adds 'admin_viewer' as a 4th value of the public.user_role
-- enum (current live values, in order: staff, manager, admin, admin_viewer). A
-- read-only, org-wide role for someone who needs visibility across everything (an
-- accountant/investor-style viewer) without write access. The actual grant of what
-- admin_viewer can SEE is migration-054 (separate RLS policies); this migration is
-- just the enum value.
--
-- Idempotent: ALTER TYPE ... ADD VALUE has no IF NOT EXISTS in older Postgres, so
-- guard on pg_enum. ALTER TYPE ADD VALUE cannot run inside the same transaction
-- block as a statement that uses the new value, but it can safely run standalone
-- inside its own implicit transaction, which is what a bare top-level statement in
-- an unwrapped DO block gives us here.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role'
      AND e.enumlabel = 'admin_viewer'
  ) THEN
    ALTER TYPE public.user_role ADD VALUE 'admin_viewer';
  END IF;
END $$;

-- Record migration ------------------------------------------------------------
-- NOTE: a freshly-added enum value from ALTER TYPE ... ADD VALUE is only visible to
-- transactions that begin after it commits. Because the DO block above and this
-- INSERT are separate statements (not wrapped in an outer BEGIN/COMMIT), they run as
-- separate implicit transactions, so this is safe to execute right after it.
INSERT INTO public.schema_migrations (version, name)
VALUES ('053', 'add-admin-viewer-role')
ON CONFLICT (version) DO NOTHING;
