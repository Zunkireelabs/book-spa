-- Migration 150a: backfill public.attendance_status enum on production (additive, REVERSIBLE)
--
-- Numbered 150a (not the next plain integer) so it sorts and applies strictly between
-- migration-150 and migration-151 — it MUST run before 151 (which assumes the enum
-- already exists) and after 150 (already applied to production; unaffected either way).
--
-- Production divergence discovered 2026-09-03 during the PR #184/#190 incident:
-- therapist_attendance.status on PRODUCTION is plain `text`, not the `attendance_status`
-- enum that migration-002 (creation) and migration-028 (Present/Absent/Leave/1st-Half
-- Day/2nd-Half Day split) already established on staging. This predates the incident —
-- production apparently never got the enum in its proper form, likely from the same class
-- of gap CLAUDE.md documents for migrations 038-041 (pre-CI-automation manual promotion
-- steps that were sometimes missed). It's what caused migration-151
-- (attendance-leave-types)'s `ALTER TYPE public.attendance_status ADD VALUE` to fail with
-- "type public.attendance_status does not exist" when the incident's mistaken merge
-- triggered a production migration run.
--
-- Verified safe: production's therapist_attendance.status currently holds only 3 distinct
-- values (Present, Absent, Leave) — a clean subset of migration-028's 5-value enum, so the
-- USING cast below cannot fail on unmapped data.
--
-- Production also carries a legacy CHECK constraint (therapist_attendance_status_check,
-- `status = ANY(ARRAY['Present','Absent','Leave','Half-Day']::text[])`) from whatever ad
-- hoc script originally bootstrapped this table there instead of migration-002 — Postgres
-- can't re-validate a text-typed ANY(array) CHECK against the new enum type mid-ALTER
-- (confirmed empirically: "operator does not exist: attendance_status = text"). Dropped
-- below; it's redundant once the column is the enum, which already enforces valid values.
--
-- Idempotent: guarded on the column's current type. A no-op on any environment (staging,
-- local) where the column is already the enum.
--
-- Reversible: ALTER TABLE public.therapist_attendance ALTER COLUMN status TYPE text;
--   (drops the enum constraint; the text values themselves are unaffected either way)

DO $$
BEGIN
  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'therapist_attendance' AND column_name = 'status'
  ) = 'text' THEN

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_status') THEN
      CREATE TYPE public.attendance_status AS ENUM (
        'Present', 'Absent', 'Leave', '1st-Half Day', '2nd-Half Day'
      );
    END IF;

    ALTER TABLE public.therapist_attendance
      DROP CONSTRAINT IF EXISTS therapist_attendance_status_check;

    ALTER TABLE public.therapist_attendance
      ALTER COLUMN status TYPE public.attendance_status
      USING status::public.attendance_status;

    ALTER TABLE public.therapist_attendance ALTER COLUMN status SET NOT NULL;
  END IF;
END $$;

-- Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('150a', 'backfill-attendance-status-enum')
ON CONFLICT (version) DO NOTHING;
