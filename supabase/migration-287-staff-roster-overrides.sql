-- Migration 287: per-date staff roster overrides
-- Additive only. Idempotent: safe to re-run in either database.
--
-- Backs the new "Roster" grid (Calendar ⋮ menu → "Edit staff roster"): a Timely-style
-- month view where each staff/date cell can override that one date's working hours
-- independently of their recurring weekly default (migration-275's
-- therapist_working_hours). A date with no row here just falls back to that
-- therapist's normal weekly hours for its day_of_week.
--
-- Same deliberate scope boundary as migration-275: storage/display only, not wired
-- into booking-slot availability/conflict checks.
--
-- branch_id is denormalized onto this table (copied from therapists.branch_id at
-- write time) to mirror therapist_working_hours' exact RLS shape rather than
-- inventing a join-based policy.

BEGIN;

CREATE TABLE IF NOT EXISTS public.staff_roster_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id uuid NOT NULL REFERENCES public.therapists(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  override_date date NOT NULL,
  start_time time,
  end_time time,
  is_day_off boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_staff_roster_overrides UNIQUE (therapist_id, override_date),
  CONSTRAINT chk_roster_override_times CHECK (
    is_day_off = true
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
  )
);

CREATE INDEX IF NOT EXISTS idx_staff_roster_overrides_therapist ON public.staff_roster_overrides(therapist_id);
CREATE INDEX IF NOT EXISTS idx_staff_roster_overrides_branch_date ON public.staff_roster_overrides(branch_id, override_date);

ALTER TABLE public.staff_roster_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read branch roster overrides" ON public.staff_roster_overrides;
CREATE POLICY "Staff can read branch roster overrides"
  ON public.staff_roster_overrides FOR SELECT
  TO authenticated
  USING (
    branch_id = (SELECT get_user_branch_id())
    OR (SELECT get_user_role()) = 'admin'
  );

DROP POLICY IF EXISTS "Manager can insert roster overrides" ON public.staff_roster_overrides;
CREATE POLICY "Manager can insert roster overrides"
  ON public.staff_roster_overrides FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT get_user_role()) IN ('manager', 'admin')
    AND (branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')
  );

DROP POLICY IF EXISTS "Manager can update roster overrides" ON public.staff_roster_overrides;
CREATE POLICY "Manager can update roster overrides"
  ON public.staff_roster_overrides FOR UPDATE
  TO authenticated
  USING (
    (SELECT get_user_role()) IN ('manager', 'admin')
    AND (branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')
  )
  WITH CHECK (
    (SELECT get_user_role()) IN ('manager', 'admin')
    AND (branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')
  );

DROP POLICY IF EXISTS "Manager can delete roster overrides" ON public.staff_roster_overrides;
CREATE POLICY "Manager can delete roster overrides"
  ON public.staff_roster_overrides FOR DELETE
  TO authenticated
  USING (
    (SELECT get_user_role()) IN ('manager', 'admin')
    AND (branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('287', 'staff-roster-overrides')
ON CONFLICT (version) DO NOTHING;

COMMIT;
