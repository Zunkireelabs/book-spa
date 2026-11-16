-- Migration 316: backfill missing FKs on audit_logs (production only)
--
-- Customer-detail "Log" tab (fetchCustomerLog, api.js) errored on production:
-- "Could not find a relationship between 'audit_logs' and 'users' in the schema
-- cache" — PostgREST embedding (`actor:users!changed_by(full_name)`) requires a
-- real foreign key to resolve the relationship.
--
-- Root cause, confirmed by direct inspection: production's audit_logs table has
-- ZERO foreign key constraints at all, despite migration-002 (the table's
-- original definition) specifying `changed_by uuid REFERENCES users(id)` and
-- `branch_id uuid REFERENCES branches(id)` inline. Staging has both constraints.
-- audit_logs predates this repo's CI migration automation — production's copy
-- was evidently created via an earlier manual/ad-hoc process that dropped the
-- inline REFERENCES clauses, a schema drift between the two databases that
-- predates this migration entirely (not caused by anything in today's work).
--
-- Verified safe before writing this: zero orphaned rows on production for either
-- column (every non-null changed_by matches a real users.id, every non-null
-- branch_id matches a real branches.id), so both ADD CONSTRAINT statements apply
-- cleanly. No-op on staging, where both constraints already exist (IF NOT EXISTS
-- guard via the DO block below, since ALTER TABLE ... ADD CONSTRAINT has no
-- native IF NOT EXISTS clause in Postgres).

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_changed_by_fkey'
  ) THEN
    ALTER TABLE public.audit_logs
      ADD CONSTRAINT audit_logs_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_branch_id_fkey'
  ) THEN
    ALTER TABLE public.audit_logs
      ADD CONSTRAINT audit_logs_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);
  END IF;
END $$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('316', 'audit-logs-production-fk-backfill')
ON CONFLICT (version) DO NOTHING;

COMMIT;
