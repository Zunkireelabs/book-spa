-- Migration 044: Payroll
--
-- Introduces monthly payroll for staff. Three tables:
--
--   staff_compensation  — per-staff pay config (monthly salary + commission %)
--   payroll_runs        — one run per branch + month (draft → finalized)
--   payroll_items       — per-staff snapshot row inside a run
--
-- Net pay formula:
--   per_day  = monthly_salary / days_in_month
--   deduction = per_day * (absent_days + 0.5 * half_days)   [Leave is info-only]
--   net_pay  = monthly_salary − deduction + service_commission + referral_commission
--
-- All three tables are ADMIN-ONLY via RLS (salary data must never be readable
-- by staff or managers).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE POLICY IF NOT EXISTS guards.
-- Portable: no hardcoded UUIDs. MUST also be run on production (see PROMOTION.md).
--
-- Reversible (manual):
--   DROP TABLE IF EXISTS payroll_items, payroll_runs, staff_compensation CASCADE;

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.staff_compensation (
  therapist_id  uuid        PRIMARY KEY REFERENCES public.therapists(id) ON DELETE CASCADE,
  monthly_salary numeric     NOT NULL DEFAULT 0 CHECK (monthly_salary >= 0),
  commission_rate numeric    NOT NULL DEFAULT 0 CHECK (commission_rate >= 0 AND commission_rate <= 100),
  updated_by    uuid        REFERENCES public.users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid        NOT NULL REFERENCES public.branches(id),
  period_month  date        NOT NULL,
  status        text        NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'finalized')),
  total_net     numeric     NOT NULL DEFAULT 0,
  generated_by  uuid        REFERENCES public.users(id),
  generated_at  timestamptz NOT NULL DEFAULT now(),
  finalized_by  uuid        REFERENCES public.users(id),
  finalized_at  timestamptz,

  CONSTRAINT uq_payroll_run_branch_month UNIQUE (branch_id, period_month)
);

CREATE TABLE IF NOT EXISTS public.payroll_items (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id      uuid        NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  therapist_id        uuid        NOT NULL REFERENCES public.therapists(id),
  therapist_name      text        NOT NULL,
  monthly_salary      numeric     NOT NULL DEFAULT 0,
  commission_rate     numeric     NOT NULL DEFAULT 0,
  days_in_month       integer     NOT NULL,
  present_days        integer     NOT NULL DEFAULT 0,
  absent_days         numeric     NOT NULL DEFAULT 0,
  half_days           integer     NOT NULL DEFAULT 0,
  leave_days          integer     NOT NULL DEFAULT 0,
  attendance_deduction numeric    NOT NULL DEFAULT 0,
  service_revenue     numeric     NOT NULL DEFAULT 0,
  service_commission  numeric     NOT NULL DEFAULT 0,
  referral_commission numeric     NOT NULL DEFAULT 0,
  net_pay             numeric     NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_payroll_item_run_therapist UNIQUE (payroll_run_id, therapist_id)
);

-- ============================================================
-- IMMUTABILITY TRIGGER — block edits to finalized runs
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_payroll_immutability()
RETURNS TRIGGER AS $$
BEGIN
  -- payroll_items: look up parent run status
  IF TG_TABLE_NAME = 'payroll_items' THEN
    IF EXISTS (
      SELECT 1 FROM public.payroll_runs
      WHERE id = COALESCE(OLD.payroll_run_id, NEW.payroll_run_id)
        AND status = 'finalized'
    ) THEN
      RAISE EXCEPTION 'PAYROLL_FINALIZED: This payroll run has been finalized and cannot be changed.'
        USING ERRCODE = 'P0003';
    END IF;
  END IF;

  -- payroll_runs: block changes once finalized (except the finalize operation itself)
  IF TG_TABLE_NAME = 'payroll_runs' THEN
    IF OLD.status = 'finalized' THEN
      RAISE EXCEPTION 'PAYROLL_FINALIZED: This payroll run has been finalized and cannot be changed.'
        USING ERRCODE = 'P0003';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_payroll_runs_immutability ON public.payroll_runs;
CREATE TRIGGER trg_enforce_payroll_runs_immutability
  BEFORE UPDATE OR DELETE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payroll_immutability();

DROP TRIGGER IF EXISTS trg_enforce_payroll_items_immutability ON public.payroll_items;
CREATE TRIGGER trg_enforce_payroll_items_immutability
  BEFORE UPDATE OR DELETE ON public.payroll_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payroll_immutability();

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_payroll_runs_branch_month
  ON public.payroll_runs (branch_id, period_month);

CREATE INDEX IF NOT EXISTS idx_payroll_items_run
  ON public.payroll_items (payroll_run_id);

-- ============================================================
-- RLS — admin only
-- ============================================================

ALTER TABLE public.staff_compensation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_items      ENABLE ROW LEVEL SECURITY;

-- staff_compensation
DROP POLICY IF EXISTS "Admin manage staff compensation" ON public.staff_compensation;
CREATE POLICY "Admin manage staff compensation"
  ON public.staff_compensation FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- payroll_runs
DROP POLICY IF EXISTS "Admin manage payroll runs" ON public.payroll_runs;
CREATE POLICY "Admin manage payroll runs"
  ON public.payroll_runs FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- payroll_items
DROP POLICY IF EXISTS "Admin manage payroll items" ON public.payroll_items;
CREATE POLICY "Admin manage payroll items"
  ON public.payroll_items FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- ============================================================
-- RECORD MIGRATION
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('044', 'payroll')
ON CONFLICT (version) DO NOTHING;
