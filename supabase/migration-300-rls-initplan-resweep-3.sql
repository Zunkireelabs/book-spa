-- Migration 300: re-sweep unwrapped RLS helper calls (follow-up to migration-281)
--
-- CI's scripts/check-rls-initplan.sh failed on staging again with 8 unwrapped calls across
-- booking_combo_items, combo_package_components, and service_addons -- blocking Deploy to
-- Staging entirely (Apply Migrations failed, so Deploy to Staging was skipped), discovered
-- while shipping an unrelated availability fix.
--
-- migration-281 already fixed booking_combo_items and combo_package_components once. The
-- regression: migration-288 (services-combo) and migration-291 (service-online-booking-addons)
-- both DROP POLICY + CREATE POLICY the same tables' policies from their original, pre-281
-- unwrapped SQL text -- numbered after 281, so applying migrations in order silently undid its
-- fix. service_addons (added by migration-291) never went through the wrap at all.
--
-- This migration is the exact same generic DO block as migration-225/281 -- idempotent and
-- table-agnostic, so re-running it is the correct fix rather than hand-writing per-table ALTER
-- POLICY statements (which is exactly what let this regress twice: a later migration restating
-- a policy's full original CREATE POLICY text bypasses whatever the sweep already fixed). It
-- wraps any bare get_user_role() / get_user_org_id() / get_user_branch_id() /
-- get_user_branch_ids() / auth.uid() / auth.jwt() call it finds, on any public policy,
-- regardless of which migration (if any) created or re-created that policy.
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

  RAISE NOTICE 'migration-300: rewrote % policies', n_changed;
END
$do$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('300', 'rls-initplan-resweep-3')
ON CONFLICT (version) DO NOTHING;
