-- Migration 147: split "Leave" into Annual Leave / Sick Leave, add Day Off (additive, REVERSIBLE)
--
-- The attendance status dropdown moves from Present/Absent/Leave/1st-Half Day/2nd-Half Day to
-- Present/Absent/Annual Leave/Sick Leave/Day Off. Existing 'Leave', '1st-Half Day' and
-- '2nd-Half Day' rows are left untouched (no backfill/reinterpretation of historical data — we
-- can't know which past 'Leave' entries were sick vs. annual) and those three values stay valid
-- in the enum so old rows keep displaying correctly; the app-layer entry forms (migration-146's
-- sibling changes) simply stop offering them for new records.
--
-- Payroll/booking-assignment treatment: Annual Leave, Sick Leave and Day Off are all "not
-- deducted" — same as the existing Leave status — and all block booking assignment for that
-- date, same as Absent/Leave (application-layer change, no DB enforcement needed here).
--
-- Reversible: newly-added enum values cannot be dropped without the same rename-type dance as
-- migration-028 (Postgres has no ALTER TYPE ... DROP VALUE). If a rollback is ever needed:
--   ALTER TYPE public.attendance_status RENAME TO attendance_status_old;
--   CREATE TYPE public.attendance_status AS ENUM ('Present','Absent','Leave','1st-Half Day','2nd-Half Day');
--   ALTER TABLE public.therapist_attendance ALTER COLUMN status TYPE public.attendance_status
--     USING (CASE WHEN status::text IN ('Annual Leave','Sick Leave') THEN 'Leave'
--                 WHEN status::text = 'Day Off' THEN 'Leave'
--                 ELSE status::text END)::public.attendance_status;
--   ALTER TABLE public.therapist_attendance ALTER COLUMN status SET DEFAULT 'Present';
--   DROP TYPE public.attendance_status_old;

-- Plain top-level statements (NOT wrapped in DO blocks — ALTER TYPE ... ADD VALUE cannot run
-- inside a transaction block/subtransaction, which a DO block implicitly opens). The
-- IF NOT EXISTS clause (PG 9.6+) already makes each statement idempotent on its own.
ALTER TYPE public.attendance_status ADD VALUE IF NOT EXISTS 'Annual Leave';
ALTER TYPE public.attendance_status ADD VALUE IF NOT EXISTS 'Sick Leave';
ALTER TYPE public.attendance_status ADD VALUE IF NOT EXISTS 'Day Off';

-- Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('147', 'attendance-leave-types')
ON CONFLICT (version) DO NOTHING;
