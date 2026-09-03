-- Migration 148: track unpaid (over-cap) leave days on payroll items (additive, REVERSIBLE)
--
-- Sick Leave and Annual Leave (migration-151) are paid only up to a per-calendar-year cap —
-- 14 paid Sick Leave days/year, 18 paid Annual Leave days/year (application logic, see
-- SICK_LEAVE_PAID_CAP_DAYS/ANNUAL_LEAVE_PAID_CAP_DAYS in services/api.js's generatePayroll()).
-- Days beyond the cap are deducted from salary exactly like Absent days. This column surfaces
-- how many such over-cap days were deducted for a given payroll item, for transparency in the
-- payroll report (separate from the existing leave_days column, which counts ALL leave-like
-- days — paid and unpaid — and is unchanged).
--
-- Reversible:
--   ALTER TABLE public.payroll_items DROP COLUMN IF EXISTS unpaid_leave_days;

ALTER TABLE public.payroll_items
  ADD COLUMN IF NOT EXISTS unpaid_leave_days numeric NOT NULL DEFAULT 0;

-- Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('152', 'leave-paid-caps')
ON CONFLICT (version) DO NOTHING;
