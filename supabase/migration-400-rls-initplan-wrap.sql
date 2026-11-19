-- Migration 400: wrap the RLS helper calls in 4 policies (ZNLY-261; stage deploy 44461587895 failed scripts/check-rls-initplan.sh)
--
-- Policies from migration 364 (attendance) and 370 (insights) called get_user_branch_ids() / auth.uid() / get_user_org_id() unwrapped, so Postgres
-- re-evaluated them per row (see migration-225 / the 2026-09-25 incident). Same logic, helpers wrapped as an InitPlan:
--   (SELECT auth.uid()), (SELECT get_user_org_id()), and  branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])  instead of
--   branch_id IN (SELECT unnest(get_user_branch_ids())).  The ::uuid[] cast is needed: a bare (SELECT ...) as ANY's argument is parsed as a subquery.
-- Touches: attendance_changes, attendance_punches, insight_feedback policies only. No data, no grants.
-- Applied: stage - / prod -.

BEGIN;

DROP POLICY IF EXISTS "Managers read attendance changes" ON public.attendance_changes;
CREATE POLICY "Managers read attendance changes" ON public.attendance_changes FOR SELECT TO authenticated
  USING ((SELECT get_user_role()) IN ('manager', 'admin')
         AND (branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
              OR worked_at_branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
              OR ((SELECT get_user_role()) = 'admin' AND org_id = (SELECT get_user_org_id()))));

DROP POLICY IF EXISTS "Managers read attendance punches" ON public.attendance_punches;
CREATE POLICY "Managers read attendance punches" ON public.attendance_punches FOR SELECT TO authenticated
  USING ((SELECT get_user_role()) IN ('manager', 'admin')
         AND (branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
              OR EXISTS (SELECT 1 FROM public.therapist_attendance a
                          WHERE a.therapist_id = attendance_punches.therapist_id AND a.date = attendance_punches.date
                            AND a.branch_id = ANY ((SELECT get_user_branch_ids())::uuid[]))
              OR ((SELECT get_user_role()) = 'admin' AND org_id = (SELECT get_user_org_id()))));

DROP POLICY IF EXISTS "Own insight feedback read" ON public.insight_feedback;
CREATE POLICY "Own insight feedback read" ON public.insight_feedback FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Own insight feedback write" ON public.insight_feedback;
CREATE POLICY "Own insight feedback write" ON public.insight_feedback FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND org_id = (SELECT public.get_user_org_id()));

INSERT INTO public.schema_migrations (version, name)
VALUES ('400', 'rls-initplan-wrap')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
