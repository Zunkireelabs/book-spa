-- Migration 225: wrap unwrapped RLS helper calls across all public policies
--
-- Follow-up to migration-224, which fixed public.bookings only. An audit of the
-- production database afterwards found the same pattern in 163 policies across
-- 53 tables.
--
-- The pattern: policy expressions call get_user_role() / get_user_org_id() /
-- get_user_branch_id() / get_user_branch_ids() / auth.uid() / auth.jwt()
-- directly. A bare STABLE function call inside a policy expression is
-- re-evaluated once per row; wrapped in a scalar subquery it is hoisted into a
-- once-per-query InitPlan instead.
--
-- Why this matters far beyond one table: get_user_role() is defined as
-- `SELECT role FROM users WHERE id = auth.uid()`. Called per row, from policies
-- on every table, it turned public.users -- a 27-row table -- into the hottest
-- relation in the database:
--
--     users     27 rows    94,925,233 seq scans    857,969,052 tuples read
--     branches   8 rows     2,448,653 seq scans     11,300,086 tuples read
--
-- That amplification is what pushed ordinary dashboard queries past the
-- `authenticated` role's 8s statement_timeout on 2026-09-25, aborting a
-- transaction whose connection then returned to the Supavisor pool without a
-- ROLLBACK and served 25P02 to every subsequent request.
--
-- Semantics are UNCHANGED. Every helper is STABLE (get_user_* are additionally
-- SECURITY DEFINER), so `(SELECT f())` yields exactly the same value as `f()`.
-- No policy's role list, command, or logic is altered -- only the number of
-- times the planner evaluates each call.
--
-- This is written as a DO block rather than a list of literal ALTER POLICY
-- statements on purpose. Staging and production have diverged on 20 policies,
-- so a static script generated from one database would silently overwrite the
-- other's definitions. Rewriting each policy in terms of its own current
-- expression keeps the two environments' differences intact and makes the
-- migration idempotent: once wrapped, a call no longer matches the bare-call
-- pattern, so re-running is a no-op.

DO $do$
DECLARE
  r          record;
  new_qual   text;
  new_check  text;
  stmt       text;
  n_changed  int := 0;
  -- A bare call is one not already preceded by "SELECT ". pg_get_expr renders a
  -- wrapped call as "( SELECT fn() AS fn)", so the negative lookbehind below
  -- leaves those alone.
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
    -- Detect bare calls by first blanking out any already-wrapped ones.
    IF NOT (
         regexp_replace(coalesce(r.qual, ''),   '\( SELECT [a-z_]+\.?[a-z_]*\(\) AS [a-z_]+\)', '', 'g') ~ bare_re
      OR regexp_replace(coalesce(r.wcheck, ''), '\( SELECT [a-z_]+\.?[a-z_]*\(\) AS [a-z_]+\)', '', 'g') ~ bare_re
    ) THEN
      CONTINUE;
    END IF;

    -- `= ANY (get_user_branch_ids())` must be handled before the generic
    -- wrapping. A bare `(SELECT ...)` as ANY's argument is parsed as ANY's
    -- subquery form and fails with "operator does not exist: uuid = uuid[]";
    -- the explicit cast forces the array form. (Found on staging while
    -- preparing migration-224.)
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

    -- ALTER POLICY leaves an omitted clause untouched, so only the clauses the
    -- policy actually has are restated.
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

  RAISE NOTICE 'migration-225: rewrote % policies', n_changed;
END
$do$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('225', 'rls-initplan-sweep')
ON CONFLICT (version) DO NOTHING;
