-- Migration 316: staff-availability foundations (ZNLY-100, V29a step 1)
--  * organizations.enforce_staff_availability: per-tenant switch, default OFF (live tenants unchanged)
--  * bookings.availability_override_reason: manager/admin "book anyway" reason (read by the guard, migration 319)
--  * therapist_attendance.off_start/off_end: optional exact times of a half day
--  * staff_roster_override_breaks: breaks on a roster date change (mirrors therapist_working_hours_breaks)
-- Reversible (manual): DROP TABLE public.staff_roster_override_breaks; ALTER TABLE public.bookings DROP COLUMN availability_override_reason;
--   ALTER TABLE public.organizations DROP COLUMN enforce_staff_availability;
BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enforce_staff_availability boolean NOT NULL DEFAULT false;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS availability_override_reason text;

-- Editable half days: when set, these win over the split rule (must fall inside the shift; enforced in migration 319).
ALTER TABLE public.therapist_attendance
  ADD COLUMN IF NOT EXISTS off_start time,
  ADD COLUMN IF NOT EXISTS off_end   time;
ALTER TABLE public.therapist_attendance DROP CONSTRAINT IF EXISTS chk_attendance_off_range;
ALTER TABLE public.therapist_attendance ADD CONSTRAINT chk_attendance_off_range
  CHECK ((off_start IS NULL AND off_end IS NULL) OR (off_start IS NOT NULL AND off_end IS NOT NULL AND off_start < off_end));

CREATE TABLE IF NOT EXISTS public.staff_roster_override_breaks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_override_id uuid NOT NULL REFERENCES public.staff_roster_overrides(id) ON DELETE CASCADE,
  name               text,
  start_time         time NOT NULL,
  end_time           time NOT NULL,
  sort_order         smallint NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_roster_break_times CHECK (start_time < end_time)
);
CREATE INDEX IF NOT EXISTS idx_roster_override_breaks_override ON public.staff_roster_override_breaks(roster_override_id);

ALTER TABLE public.staff_roster_override_breaks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read branch roster override breaks" ON public.staff_roster_override_breaks;
CREATE POLICY "Staff can read branch roster override breaks" ON public.staff_roster_override_breaks
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.staff_roster_overrides o
    WHERE o.id = staff_roster_override_breaks.roster_override_id
      AND (o.branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')));

DROP POLICY IF EXISTS "Admin viewer can read org roster override breaks" ON public.staff_roster_override_breaks;
CREATE POLICY "Admin viewer can read org roster override breaks" ON public.staff_roster_override_breaks
  FOR SELECT USING ((SELECT get_user_role()) = 'admin_viewer' AND EXISTS (
    SELECT 1 FROM public.staff_roster_overrides o JOIN public.branches br ON br.id = o.branch_id
    WHERE o.id = staff_roster_override_breaks.roster_override_id AND br.org_id = (SELECT get_user_org_id())));

DROP POLICY IF EXISTS "Manager can insert roster override breaks" ON public.staff_roster_override_breaks;
CREATE POLICY "Manager can insert roster override breaks" ON public.staff_roster_override_breaks
  FOR INSERT WITH CHECK ((SELECT get_user_role()) IN ('manager','admin') AND EXISTS (
    SELECT 1 FROM public.staff_roster_overrides o
    WHERE o.id = staff_roster_override_breaks.roster_override_id
      AND (o.branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')));

DROP POLICY IF EXISTS "Manager can update roster override breaks" ON public.staff_roster_override_breaks;
CREATE POLICY "Manager can update roster override breaks" ON public.staff_roster_override_breaks
  FOR UPDATE USING ((SELECT get_user_role()) IN ('manager','admin') AND EXISTS (
    SELECT 1 FROM public.staff_roster_overrides o
    WHERE o.id = staff_roster_override_breaks.roster_override_id
      AND (o.branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')))
  WITH CHECK ((SELECT get_user_role()) IN ('manager','admin') AND EXISTS (
    SELECT 1 FROM public.staff_roster_overrides o
    WHERE o.id = staff_roster_override_breaks.roster_override_id
      AND (o.branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')));

DROP POLICY IF EXISTS "Manager can delete roster override breaks" ON public.staff_roster_override_breaks;
CREATE POLICY "Manager can delete roster override breaks" ON public.staff_roster_override_breaks
  FOR DELETE USING ((SELECT get_user_role()) IN ('manager','admin') AND EXISTS (
    SELECT 1 FROM public.staff_roster_overrides o
    WHERE o.id = staff_roster_override_breaks.roster_override_id
      AND (o.branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')));

INSERT INTO public.schema_migrations (version, name)
VALUES ('316', 'availability-switch-and-roster-breaks')
ON CONFLICT (version) DO NOTHING;

COMMIT;
