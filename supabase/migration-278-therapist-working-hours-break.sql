-- Migration 278: named, repeatable mid-shift breaks per working day
-- Additive only. Idempotent: safe to re-run in either database.
-- Applied: stage <YYYY-MM-DD> / prod HELD.
--
-- Matches the Timely reference UI: "+ break" can be clicked repeatedly to
-- add multiple named breaks per day (e.g. "Lunch Break"), not a single
-- unnamed slot. Supersedes this migration's earlier break_start/break_end
-- columns design (never applied anywhere, so dropped outright, no data to
-- migrate). Same scope boundary as migration-275: storage/display only, not
-- read by any booking availability/conflict check.

BEGIN;

ALTER TABLE public.therapist_working_hours
  DROP CONSTRAINT IF EXISTS chk_working_hours_break;

ALTER TABLE public.therapist_working_hours
  DROP COLUMN IF EXISTS break_start,
  DROP COLUMN IF EXISTS break_end;

CREATE TABLE IF NOT EXISTS public.therapist_working_hours_breaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  working_hours_id uuid NOT NULL REFERENCES public.therapist_working_hours(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  start_time time NOT NULL,
  end_time time NOT NULL,
  sort_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_working_hours_break_times CHECK (start_time < end_time)
);

CREATE INDEX IF NOT EXISTS idx_working_hours_breaks_wh ON public.therapist_working_hours_breaks(working_hours_id);

ALTER TABLE public.therapist_working_hours_breaks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read branch therapist working hours breaks" ON public.therapist_working_hours_breaks;
CREATE POLICY "Staff can read branch therapist working hours breaks"
  ON public.therapist_working_hours_breaks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.therapist_working_hours wh
      WHERE wh.id = working_hours_id
        AND (wh.branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')
    )
  );

DROP POLICY IF EXISTS "Manager can insert therapist working hours breaks" ON public.therapist_working_hours_breaks;
CREATE POLICY "Manager can insert therapist working hours breaks"
  ON public.therapist_working_hours_breaks FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT get_user_role()) IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM public.therapist_working_hours wh
      WHERE wh.id = working_hours_id
        AND (wh.branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')
    )
  );

DROP POLICY IF EXISTS "Manager can update therapist working hours breaks" ON public.therapist_working_hours_breaks;
CREATE POLICY "Manager can update therapist working hours breaks"
  ON public.therapist_working_hours_breaks FOR UPDATE
  TO authenticated
  USING (
    (SELECT get_user_role()) IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM public.therapist_working_hours wh
      WHERE wh.id = working_hours_id
        AND (wh.branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')
    )
  )
  WITH CHECK (
    (SELECT get_user_role()) IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM public.therapist_working_hours wh
      WHERE wh.id = working_hours_id
        AND (wh.branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')
    )
  );

DROP POLICY IF EXISTS "Manager can delete therapist working hours breaks" ON public.therapist_working_hours_breaks;
CREATE POLICY "Manager can delete therapist working hours breaks"
  ON public.therapist_working_hours_breaks FOR DELETE
  TO authenticated
  USING (
    (SELECT get_user_role()) IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM public.therapist_working_hours wh
      WHERE wh.id = working_hours_id
        AND (wh.branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')
    )
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('278', 'therapist-working-hours-break')
ON CONFLICT (version) DO NOTHING;

COMMIT;
