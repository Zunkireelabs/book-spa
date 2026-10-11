-- Migration 261: fix therapist_attendance.check_in_time/check_out_time type drift on
-- production (additive, REVERSIBLE)
--
-- Production divergence discovered 2026-10-07 from a client report: creating a booking
-- for a therapist with a recorded checkout failed with
--   "operator does not exist: timestamp with time zone >= time without time zone"
-- raised by check_therapist_booking_guards (migration-252/257/258), which compares
-- p_start_datetime (timestamptz) >= v_attendance.check_out_time. migration-002 and every
-- environment since (staging, local) declare both columns `timestamptz`; production's
-- are `time without time zone` -- the same class of untracked ad hoc drift CLAUDE.md
-- documents for migrations 038-041 and migration-150a's status-enum gap. This one was
-- never caught by scripts/migrate-status.sh because it isn't a missing migration -- the
-- ledger shows 002 as applied -- it's the column's live type silently not matching what
-- 002 actually says.
--
-- Verified safe: production currently has 0 non-null rows in either column (checked via
-- psql), so there is no data to reinterpret -- the USING cast below never runs against a
-- real value.
--
-- Idempotent: guarded on each column's current type. A no-op on any environment
-- (staging, local) where the columns are already timestamptz.
--
-- Reversible:
--   ALTER TABLE public.therapist_attendance ALTER COLUMN check_in_time TYPE time USING check_in_time::time;
--   ALTER TABLE public.therapist_attendance ALTER COLUMN check_out_time TYPE time USING check_out_time::time;

DO $$
BEGIN
  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'therapist_attendance' AND column_name = 'check_in_time'
  ) = 'time without time zone' THEN
    ALTER TABLE public.therapist_attendance
      ALTER COLUMN check_in_time TYPE timestamptz
      USING (date + check_in_time) AT TIME ZONE 'Asia/Kathmandu';
  END IF;

  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'therapist_attendance' AND column_name = 'check_out_time'
  ) = 'time without time zone' THEN
    ALTER TABLE public.therapist_attendance
      ALTER COLUMN check_out_time TYPE timestamptz
      USING (date + check_out_time) AT TIME ZONE 'Asia/Kathmandu';
  END IF;
END $$;

-- Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('261', 'fix-attendance-time-columns')
ON CONFLICT (version) DO NOTHING;
