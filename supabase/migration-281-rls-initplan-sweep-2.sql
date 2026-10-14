-- Migration 281: re-sweep unwrapped RLS helper calls (follow-up to migration-225)
--
-- CI's scripts/check-rls-initplan.sh (added after migration-225, guards against
-- a repeat of the 2026-09-25 incident) failed on staging with 9 unwrapped calls
-- across booking_combo_items, combo_package_components, and combo_packages.
-- Those three tables and their policies were never added as a tracked
-- supabase/migration-NNN-*.sql file (schema drift via ad hoc dashboard/SQL
-- apply) and so were never covered by migration-225's sweep.
--
-- This migration is the exact same generic DO block as migration-225 --
-- idempotent and table-agnostic, so re-running it is the correct fix rather
-- than hand-writing per-table ALTER POLICY statements. It wraps any bare
-- get_user_role() / get_user_org_id() / get_user_branch_id() /
-- get_user_branch_ids() / auth.uid() / auth.jwt() call it finds, on any public
-- policy, regardless of which migration (if any) created that policy.
--
-- Semantics are UNCHANGED -- see migration-225 for the full rationale.

DO $do$
DECLARE
  r          record;
  new_qual   text;
  new_check  text;
  stmt       text;
  n_changed  int := 0;
  bare_re    text := '(get_user_role|get_user_org_id|get_user_branch_id|get_user_branch_ids)\(\)|auth\.(uid|jwt)\(\)';
BEGIN
  FOR r IN
    SELECT p.oid,
           c.relname                                AS tbl,
           p.polname,
           pg_get_expr(p.polqual, p.polrelid)       AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid)  AS wcheck
    FROM pg_policy p
    JOIN pg_class c     ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
    ORDER BY c.relname, p.polname
  LOOP
    IF NOT (
         regexp_replace(coalesce(r.qual, ''),   '\( SELECT [a-z_]+\.?[a-z_]*\(\) AS [a-z_]+\)', '', 'g') ~ bare_re
      OR regexp_replace(coalesce(r.wcheck, ''), '\( SELECT [a-z_]+\.?[a-z_]*\(\) AS [a-z_]+\)', '', 'g') ~ bare_re
    ) THEN
      CONTINUE;
    END IF;

    new_qual := replace(coalesce(r.qual, ''),
                        'ANY (get_user_branch_ids())',
                        'ANY ((SELECT get_user_branch_ids())::uuid[])');
    new_check := replace(coalesce(r.wcheck, ''),
                        'ANY (get_user_branch_ids())',
                        'ANY ((SELECT get_user_branch_ids())::uuid[])');

    new_qual := regexp_replace(new_qual, '(?<!SELECT )(get_user_role|get_user_org_id|get_user_branch_id|get_user_branch_ids)\(\)', '(SELECT \1())', 'g');
    new_qual := regexp_replace(new_qual, '(?<!SELECT )auth\.(uid|jwt)\(\)', '(SELECT auth.\1())', 'g');

    new_check := regexp_replace(new_check, '(?<!SELECT )(get_user_role|get_user_org_id|get_user_branch_id|get_user_branch_ids)\(\)', '(SELECT \1())', 'g');
    new_check := regexp_replace(new_check, '(?<!SELECT )auth\.(uid|jwt)\(\)', '(SELECT auth.\1())', 'g');

    stmt := format('ALTER POLICY %I ON public.%I', r.polname, r.tbl);
    IF r.qual IS NOT NULL THEN
      stmt := stmt || format(' USING (%s)', new_qual);
    END IF;
    IF r.wcheck IS NOT NULL THEN
      stmt := stmt || format(' WITH CHECK (%s)', new_check);
    END IF;

    EXECUTE stmt;
    n_changed := n_changed + 1;
  END LOOP;

  RAISE NOTICE 'migration-281: rewrote % policies', n_changed;
END
$do$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('281', 'rls-initplan-sweep-2')
ON CONFLICT (version) DO NOTHING;
