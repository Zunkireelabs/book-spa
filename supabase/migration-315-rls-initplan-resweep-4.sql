-- Migration 315: re-sweep unwrapped RLS helper calls (follow-up to migration-300)
--
-- CI's scripts/check-rls-initplan.sh failed Deploy to Production outright (Apply
-- Migrations failed, Deploy skipped) with 8 unwrapped calls across
-- booking_combo_items, combo_package_components, and service_addons -- the same
-- 3 tables migration-300 already fixed once, on staging.
--
-- Root cause (confirmed by direct inspection, not assumed): production had never
-- run migrations 288 (services-combo) / 291 (service-online-booking-addons) / 292
-- (set-service-addons) before today's 2026-11-03 stage->main promotion -- those
-- tables, and their original unwrapped CREATE POLICY text, only existed on
-- production for the first time in this very deploy. migration-300's sweep had
-- already run on production previously (it's in the ledger), but at a time before
-- these tables existed there, so it correctly found nothing to fix and recorded
-- "rewrote 0 policies". Staging never hit this because migration-300 happened to
-- run there only after 288/291/292 already existed.
--
-- This migration is the exact same generic DO block as migration-225/281/300 --
-- idempotent and table-agnostic, so re-running it is the correct fix rather than
-- hand-writing per-table ALTER POLICY statements (which is exactly what let this
-- regress before). It wraps any bare get_user_role() / get_user_org_id() /
-- get_user_branch_id() / get_user_branch_ids() / auth.uid() / auth.jwt() call it
-- finds, on any public policy, regardless of which migration (if any) created or
-- re-created that policy. No-op on staging, where these are already wrapped.
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

  RAISE NOTICE 'migration-315: rewrote % policies', n_changed;
END
$do$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('315', 'rls-initplan-resweep-4')
ON CONFLICT (version) DO NOTHING;
