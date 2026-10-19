-- Migration 288: re-assert migration-287's working-hours policy fixes after 275/278 land (promotion safety net)
-- Idempotent: safe to re-run in either database. Goes to stage with the UI PR; never part of the main hotfix.
-- Applied: local only (feat/ui-port-from-clinicmd)
--
-- WHY
--   migration-287 ships as a hotfix straight to prod (at migration-268), where therapist_working_hours(+_breaks) don't
--   exist yet, so 287 skips those policies there. When stage is later promoted, migrations 275/278 create them in the
--   legacy form `(branch_id = get_user_branch_id()) OR get_user_role() = 'admin'`, which lets an admin of ANY org pass,
--   AFTER 287 is already recorded, so 287 never runs again. This migration re-applies exactly 287's rewrites (same
--   guards) and re-runs its drift detector.
--   Checked every other unpromoted migration (275–286): 280's customer_photos/_documents policies have the same admin
--   gap but are superseded by 286 (which runs before this); 281 only re-wraps helper calls (semantics unchanged);
--   282/283 change functions with their own org checks; 284–286 are org-scoped. Nothing else reopens a 287 fix.
--   On stage/local (where 287 already rewrote these policies) this re-states the same definitions: a no-op in effect.
--
-- ROLLBACK
--   Nothing to undo beyond migration-287's own rollback notes; DELETE FROM public.schema_migrations WHERE version = '288'.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.v288_apply(p_table text, p_policy text, p_sql text, p_need_column text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = p_table AND policyname = p_policy) THEN
    RAISE NOTICE 'migration-288: skipped "%" on public.% (policy not present)', p_policy, p_table;
  ELSIF p_need_column IS NOT NULL AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                                                  WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_need_column) THEN
    RAISE NOTICE 'migration-288: skipped "%" on public.% (column % not present)', p_policy, p_table, p_need_column;
  ELSE
    EXECUTE p_sql;
  END IF;
END $$;

-- therapist_working_hours + _breaks: identical to migration-287
SELECT pg_temp.v288_apply('therapist_working_hours', 'Staff can read branch therapist working hours', $p$
  ALTER POLICY "Staff can read branch therapist working hours" ON public.therapist_working_hours
    USING (branch_id = (SELECT get_user_branch_id())
           OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = therapist_working_hours.branch_id AND br.org_id = (SELECT get_user_org_id()))))
$p$);
SELECT pg_temp.v288_apply('therapist_working_hours', 'Manager can insert therapist working hours', $p$
  ALTER POLICY "Manager can insert therapist working hours" ON public.therapist_working_hours
    WITH CHECK ((SELECT get_user_role()) IN ('manager', 'admin')
                AND (branch_id = (SELECT get_user_branch_id())
                     OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = therapist_working_hours.branch_id AND br.org_id = (SELECT get_user_org_id())))))
$p$);
SELECT pg_temp.v288_apply('therapist_working_hours', 'Manager can update therapist working hours', $p$
  ALTER POLICY "Manager can update therapist working hours" ON public.therapist_working_hours
    USING ((SELECT get_user_role()) IN ('manager', 'admin')
           AND (branch_id = (SELECT get_user_branch_id())
                OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = therapist_working_hours.branch_id AND br.org_id = (SELECT get_user_org_id())))))
    WITH CHECK ((SELECT get_user_role()) IN ('manager', 'admin')
                AND (branch_id = (SELECT get_user_branch_id())
                     OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = therapist_working_hours.branch_id AND br.org_id = (SELECT get_user_org_id())))))
$p$);
SELECT pg_temp.v288_apply('therapist_working_hours', 'Manager can delete therapist working hours', $p$
  ALTER POLICY "Manager can delete therapist working hours" ON public.therapist_working_hours
    USING ((SELECT get_user_role()) IN ('manager', 'admin')
           AND (branch_id = (SELECT get_user_branch_id())
                OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = therapist_working_hours.branch_id AND br.org_id = (SELECT get_user_org_id())))))
$p$);
SELECT pg_temp.v288_apply('therapist_working_hours_breaks', 'Staff can read branch therapist working hours breaks', $p$
  ALTER POLICY "Staff can read branch therapist working hours breaks" ON public.therapist_working_hours_breaks
    USING (EXISTS (SELECT 1 FROM public.therapist_working_hours wh WHERE wh.id = therapist_working_hours_breaks.working_hours_id
                   AND (wh.branch_id = (SELECT get_user_branch_id())
                        OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = wh.branch_id AND br.org_id = (SELECT get_user_org_id()))))))
$p$);
SELECT pg_temp.v288_apply('therapist_working_hours_breaks', 'Manager can insert therapist working hours breaks', $p$
  ALTER POLICY "Manager can insert therapist working hours breaks" ON public.therapist_working_hours_breaks
    WITH CHECK ((SELECT get_user_role()) IN ('manager', 'admin')
                AND EXISTS (SELECT 1 FROM public.therapist_working_hours wh WHERE wh.id = therapist_working_hours_breaks.working_hours_id
                            AND (wh.branch_id = (SELECT get_user_branch_id())
                                 OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = wh.branch_id AND br.org_id = (SELECT get_user_org_id()))))))
$p$);
SELECT pg_temp.v288_apply('therapist_working_hours_breaks', 'Manager can update therapist working hours breaks', $p$
  ALTER POLICY "Manager can update therapist working hours breaks" ON public.therapist_working_hours_breaks
    USING ((SELECT get_user_role()) IN ('manager', 'admin')
           AND EXISTS (SELECT 1 FROM public.therapist_working_hours wh WHERE wh.id = therapist_working_hours_breaks.working_hours_id
                       AND (wh.branch_id = (SELECT get_user_branch_id())
                            OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = wh.branch_id AND br.org_id = (SELECT get_user_org_id()))))))
    WITH CHECK ((SELECT get_user_role()) IN ('manager', 'admin')
                AND EXISTS (SELECT 1 FROM public.therapist_working_hours wh WHERE wh.id = therapist_working_hours_breaks.working_hours_id
                            AND (wh.branch_id = (SELECT get_user_branch_id())
                                 OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = wh.branch_id AND br.org_id = (SELECT get_user_org_id()))))))
$p$);
SELECT pg_temp.v288_apply('therapist_working_hours_breaks', 'Manager can delete therapist working hours breaks', $p$
  ALTER POLICY "Manager can delete therapist working hours breaks" ON public.therapist_working_hours_breaks
    USING ((SELECT get_user_role()) IN ('manager', 'admin')
           AND EXISTS (SELECT 1 FROM public.therapist_working_hours wh WHERE wh.id = therapist_working_hours_breaks.working_hours_id
                       AND (wh.branch_id = (SELECT get_user_branch_id())
                            OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = wh.branch_id AND br.org_id = (SELECT get_user_org_id()))))))
$p$);

-- Drift detector (same as migration-287)
DO $$
DECLARE r record; e text;
BEGIN
  FOR r IN SELECT tablename, policyname, cmd, roles::text AS roles, coalesce(qual, '') AS q, coalesce(with_check, '') AS w
           FROM pg_policies WHERE schemaname = 'public'
  LOOP
    e := r.q || ' ' || r.w;
    IF e ~ '''admin(_viewer)?''' AND e !~ '(org_id|get_user_org_id)' THEN
      RAISE WARNING 'migration-288: %.% (%) grants on an admin role without an org check', r.tablename, r.policyname, r.cmd;
    ELSIF r.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL') AND r.roles LIKE '%authenticated%' AND btrim(e) IN ('true', 'true true') THEN
      RAISE WARNING 'migration-288: %.% (%) lets any signed-in user of any org write', r.tablename, r.policyname, r.cmd;
    ELSIF r.cmd = 'SELECT' AND r.roles LIKE '%authenticated%' AND btrim(e) = 'true'
          AND r.tablename NOT IN ('industries', 'service_categories') THEN  -- intentionally public catalogs
      RAISE WARNING 'migration-288: %.% (%) lets any signed-in user of any org read every row', r.tablename, r.policyname, r.cmd;
    END IF;
  END LOOP;
END $$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('288', 'rls-tenant-sweep-reassert')
ON CONFLICT (version) DO NOTHING;

COMMIT;
