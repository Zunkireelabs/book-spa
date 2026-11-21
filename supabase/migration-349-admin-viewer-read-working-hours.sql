-- Migration 349: read-only access for admin_viewer to working hours, breaks and date changes (V28 / ZNLY-97).
--
-- The profile's Working hours tab (and the Overview "this week" strip) must show an admin_viewer the same hours the owner sees.
-- Today only staff/manager/admin policies exist on these three tables, so a viewer would see an empty schedule.
-- SELECT only, org-scoped (via the branch's org), helper calls wrapped initplan-style like migrations 300/340. No write policy.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY. Portable: no hardcoded UUIDs.
-- Reversible:
--   DROP POLICY IF EXISTS "Admin viewer can read org therapist working hours" ON public.therapist_working_hours;
--   DROP POLICY IF EXISTS "Admin viewer can read org therapist working hours breaks" ON public.therapist_working_hours_breaks;
--   DROP POLICY IF EXISTS "Admin viewer can read org roster overrides" ON public.staff_roster_overrides;
--   DELETE FROM public.schema_migrations WHERE version = '349';

BEGIN;

DROP POLICY IF EXISTS "Admin viewer can read org therapist working hours" ON public.therapist_working_hours;
CREATE POLICY "Admin viewer can read org therapist working hours" ON public.therapist_working_hours
  FOR SELECT TO authenticated
  USING (
    (SELECT get_user_role()) = 'admin_viewer'::user_role
    AND EXISTS (
      SELECT 1 FROM public.branches br
       WHERE br.id = therapist_working_hours.branch_id AND br.org_id = (SELECT get_user_org_id()))
  );

DROP POLICY IF EXISTS "Admin viewer can read org therapist working hours breaks" ON public.therapist_working_hours_breaks;
CREATE POLICY "Admin viewer can read org therapist working hours breaks" ON public.therapist_working_hours_breaks
  FOR SELECT TO authenticated
  USING (
    (SELECT get_user_role()) = 'admin_viewer'::user_role
    AND EXISTS (
      SELECT 1 FROM public.therapist_working_hours wh
        JOIN public.branches br ON br.id = wh.branch_id
       WHERE wh.id = therapist_working_hours_breaks.working_hours_id AND br.org_id = (SELECT get_user_org_id()))
  );

DROP POLICY IF EXISTS "Admin viewer can read org roster overrides" ON public.staff_roster_overrides;
CREATE POLICY "Admin viewer can read org roster overrides" ON public.staff_roster_overrides
  FOR SELECT TO authenticated
  USING (
    (SELECT get_user_role()) = 'admin_viewer'::user_role
    AND EXISTS (
      SELECT 1 FROM public.branches br
       WHERE br.id = staff_roster_overrides.branch_id AND br.org_id = (SELECT get_user_org_id()))
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('349', 'admin-viewer-read-working-hours')
ON CONFLICT (version) DO NOTHING;

COMMIT;
