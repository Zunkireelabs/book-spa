-- Migration 028: split the 'Half-Day' attendance status into two
--
-- Product change: a half day can now be the FIRST half or the SECOND half of
-- the day, so the single 'Half-Day' enum value is replaced by '1st-Half Day'
-- and '2nd-Half Day'. Both still count as 0.5 of a working day in reporting.
--
-- Postgres enum values can't be dropped in place, so the type is recreated.
-- Existing 'Half-Day' rows are migrated to '1st-Half Day' (the safe default;
-- the data didn't record which half was worked).
--
-- Idempotent: the whole change is guarded on 'Half-Day' still existing in the
-- enum, so re-running after it's applied is a no-op.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'attendance_status'
      AND e.enumlabel = 'Half-Day'
  ) THEN
    ALTER TABLE public.therapist_attendance ALTER COLUMN status DROP DEFAULT;

    ALTER TYPE public.attendance_status RENAME TO attendance_status_old;

    CREATE TYPE public.attendance_status AS ENUM (
      'Present', 'Absent', 'Leave', '1st-Half Day', '2nd-Half Day'
    );

    ALTER TABLE public.therapist_attendance
      ALTER COLUMN status TYPE public.attendance_status
      USING (
        CASE WHEN status::text = 'Half-Day' THEN '1st-Half Day'
             ELSE status::text
        END
      )::public.attendance_status;

    ALTER TABLE public.therapist_attendance ALTER COLUMN status SET DEFAULT 'Present';

    DROP TYPE public.attendance_status_old;
  END IF;
END $$;

-- Record this migration (no-op if already present).
INSERT INTO public.schema_migrations (version, name) VALUES
  ('028','split-half-day-attendance')
ON CONFLICT (version) DO NOTHING;

-- Verify
SELECT enumlabel FROM pg_enum e
JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'attendance_status'
ORDER BY e.enumsortorder;
