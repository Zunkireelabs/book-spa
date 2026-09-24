-- Migration 212: manual_blocks — staff/room "block time off" with optional recurrence
--
-- Adds the ability to block a time slot (staff break, room downtime, etc.) on the
-- Calendar, distinct from the existing staff_transfers "not bookable" mechanism.
-- Recurrence is computed on-the-fly at read time (src/utils/blockRecurrence.js), matching
-- this codebase's existing staff-transfer-window pattern (no materialized occurrence
-- table, no cron/job runner exists in this repo) — manual_block_exceptions records
-- per-occurrence cancellations ("this occurrence only"), and a split series row (new
-- manual_blocks row sharing series_id, with the prior row's recurrence_end_date capped)
-- implements "this and following" edits.
--
-- Reversible (manual):
--   DROP TABLE IF EXISTS public.manual_block_exceptions;
--   DROP TABLE IF EXISTS public.manual_blocks;

CREATE TABLE IF NOT EXISTS public.manual_blocks (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES public.organizations(id),
  branch_id              uuid NOT NULL REFERENCES public.branches(id),
  therapist_id           uuid REFERENCES public.therapists(id) ON DELETE CASCADE, -- NULL = whole-location
  room_id                uuid REFERENCES public.rooms(id) ON DELETE CASCADE,      -- optional
  block_date             date NOT NULL,        -- anchor/original date
  start_time             time NOT NULL,
  duration_minutes       integer NOT NULL CHECK (duration_minutes > 0),
  description            text,
  prevent_online_booking boolean NOT NULL DEFAULT true,
  created_by             uuid REFERENCES public.users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),

  recurrence_freq        text CHECK (recurrence_freq IN ('daily','weekly','monthly')), -- NULL = one-off
  recurrence_interval    integer NOT NULL DEFAULT 1 CHECK (recurrence_interval > 0),
  recurrence_end_date    date,
  recurrence_count       integer CHECK (recurrence_count IS NULL OR recurrence_count > 0),

  series_id              uuid,     -- shared across a recurring series' split rows; NULL for one-off
  is_cancelled            boolean NOT NULL DEFAULT false,
  cancelled_at            timestamptz
);

CREATE INDEX IF NOT EXISTS idx_manual_blocks_branch_date ON public.manual_blocks(branch_id, block_date);
CREATE INDEX IF NOT EXISTS idx_manual_blocks_therapist ON public.manual_blocks(therapist_id) WHERE therapist_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_manual_blocks_series ON public.manual_blocks(series_id) WHERE series_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.manual_block_exceptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id      uuid NOT NULL,
  exception_date date NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(series_id, exception_date)
);

-- RLS: org members may read; writes restricted to admin, or a manager of the block's
-- branch (including multi-branch grants via user_branches — same widened check used for
-- staff transfers since migration-157).
ALTER TABLE public.manual_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own org blocks" ON public.manual_blocks;
CREATE POLICY "Users can read own org blocks"
  ON public.manual_blocks FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

DROP POLICY IF EXISTS "Managers can write own branch blocks" ON public.manual_blocks;
CREATE POLICY "Managers can write own branch blocks"
  ON public.manual_blocks FOR ALL
  TO authenticated
  USING (
    org_id = get_user_org_id()
    AND (
      get_user_role() = 'admin'
      OR (get_user_role() = 'manager' AND (
        branch_id = get_user_branch_id()
        OR EXISTS (SELECT 1 FROM public.user_branches WHERE user_id = auth.uid() AND branch_id = manual_blocks.branch_id)
      ))
    )
  )
  WITH CHECK (
    org_id = get_user_org_id()
    AND (
      get_user_role() = 'admin'
      OR (get_user_role() = 'manager' AND (
        branch_id = get_user_branch_id()
        OR EXISTS (SELECT 1 FROM public.user_branches WHERE user_id = auth.uid() AND branch_id = manual_blocks.branch_id)
      ))
    )
  );

ALTER TABLE public.manual_block_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own org block exceptions" ON public.manual_block_exceptions;
CREATE POLICY "Users can read own org block exceptions"
  ON public.manual_block_exceptions FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.manual_blocks mb
    WHERE mb.series_id = manual_block_exceptions.series_id
      AND mb.org_id = get_user_org_id()
  ));

DROP POLICY IF EXISTS "Managers can write own branch block exceptions" ON public.manual_block_exceptions;
CREATE POLICY "Managers can write own branch block exceptions"
  ON public.manual_block_exceptions FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.manual_blocks mb
    WHERE mb.series_id = manual_block_exceptions.series_id
      AND mb.org_id = get_user_org_id()
      AND (
        get_user_role() = 'admin'
        OR (get_user_role() = 'manager' AND (
          mb.branch_id = get_user_branch_id()
          OR EXISTS (SELECT 1 FROM public.user_branches WHERE user_id = auth.uid() AND branch_id = mb.branch_id)
        ))
      )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.manual_blocks mb
    WHERE mb.series_id = manual_block_exceptions.series_id
      AND mb.org_id = get_user_org_id()
      AND (
        get_user_role() = 'admin'
        OR (get_user_role() = 'manager' AND (
          mb.branch_id = get_user_branch_id()
          OR EXISTS (SELECT 1 FROM public.user_branches WHERE user_id = auth.uid() AND branch_id = mb.branch_id)
        ))
      )
  ));

INSERT INTO public.schema_migrations (version, name)
VALUES ('212', 'manual-blocks')
ON CONFLICT (version) DO NOTHING;
