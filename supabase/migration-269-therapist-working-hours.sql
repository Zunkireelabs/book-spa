-- Migration 269: per-therapist recurring weekly working hours
-- Additive only. Idempotent: safe to re-run in either database.
-- Applied: stage <YYYY-MM-DD> / prod HELD.
--
-- No recurring weekly schedule concept existed anywhere in this codebase
-- before this migration -- therapist_attendance is per-date actual
-- attendance, manual_blocks is a negative time-off construct, and
-- branches.open_time/close_time is branch-level only. This table is a new,
-- independent "normal working hours" definition per therapist, for display
-- and staff-editing on the new /:orgSlug/staff/:staffId page only.
--
-- Deliberate scope boundary: this table is storage/display only. It is NOT
-- wired into booking-slot availability or double-booking conflict checks --
-- that remains a separate, much larger feature. Don't treat its absence
-- from scheduling logic as a bug.
--
-- day_of_week: 0=Monday .. 6=Sunday (ISO weekday order, Monday-first -- no
-- prior convention existed in this codebase to match).
--
-- branch_id is denormalized onto this table (copied from therapists.branch_id
-- at write time) to mirror therapist_attendance's exact RLS shape rather than
-- inventing a join-based policy.

BEGIN;

CREATE TABLE IF NOT EXISTS public.therapist_working_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id uuid NOT NULL REFERENCES public.therapists(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time,
  end_time time,
  is_day_off boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_therapist_working_hours UNIQUE (therapist_id, day_of_week),
  CONSTRAINT chk_working_hours_times CHECK (
    is_day_off = true
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
  )
);

CREATE INDEX IF NOT EXISTS idx_therapist_working_hours_therapist ON public.therapist_working_hours(therapist_id);
CREATE INDEX IF NOT EXISTS idx_therapist_working_hours_branch ON public.therapist_working_hours(branch_id);

ALTER TABLE public.therapist_working_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read branch therapist working hours" ON public.therapist_working_hours;
CREATE POLICY "Staff can read branch therapist working hours"
  ON public.therapist_working_hours FOR SELECT
  TO authenticated
  USING (
    branch_id = (SELECT get_user_branch_id())
    OR (SELECT get_user_role()) = 'admin'
  );

DROP POLICY IF EXISTS "Manager can insert therapist working hours" ON public.therapist_working_hours;
CREATE POLICY "Manager can insert therapist working hours"
  ON public.therapist_working_hours FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT get_user_role()) IN ('manager', 'admin')
    AND (branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')
  );

DROP POLICY IF EXISTS "Manager can update therapist working hours" ON public.therapist_working_hours;
CREATE POLICY "Manager can update therapist working hours"
  ON public.therapist_working_hours FOR UPDATE
  TO authenticated
  USING (
    (SELECT get_user_role()) IN ('manager', 'admin')
    AND (branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')
  )
  WITH CHECK (
    (SELECT get_user_role()) IN ('manager', 'admin')
    AND (branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')
  );

DROP POLICY IF EXISTS "Manager can delete therapist working hours" ON public.therapist_working_hours;
CREATE POLICY "Manager can delete therapist working hours"
  ON public.therapist_working_hours FOR DELETE
  TO authenticated
  USING (
    (SELECT get_user_role()) IN ('manager', 'admin')
    AND (branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('269', 'therapist-working-hours')
ON CONFLICT (version) DO NOTHING;

COMMIT;
