-- supabase/migration-121-commission-rate-change-anytime.sql
-- platform_set_commission_rate (migration-115) forced a new rate's
-- effective_from to be >=2 days after the currently-open rate's
-- effective_from. That gap only existed to satisfy org_commission_rates'
-- CHECK (effective_to > effective_from) when closing the open row with
-- effective_to = new_effective_from - 1 — it was never an intentional
-- business rule, just a side effect of the constraint. It blocked the
-- legitimate case of correcting today's rate the same day it was entered,
-- and even a same-day-next-day change needed a full 2-day wait.
--
-- Fix:
--  1. Relax the CHECK to allow a single-day-long rate period (effective_to
--     == effective_from), so the minimum gap for a genuinely new period is
--     1 day instead of 2.
--  2. When the new effective_from equals the open row's effective_from,
--     update that row in place instead of inserting a same-date duplicate —
--     two rows can never both start on the same date (which one would
--     apply to a booking on that date is undefined), so this is always a
--     correction of that date's entry, not a loss of history. Every other
--     distinct effective_from still gets its own immutable history row.

ALTER TABLE public.org_commission_rates DROP CONSTRAINT IF EXISTS org_commission_rates_check;
ALTER TABLE public.org_commission_rates
  ADD CONSTRAINT org_commission_rates_check CHECK (effective_to IS NULL OR effective_to >= effective_from);

CREATE OR REPLACE FUNCTION public.platform_set_commission_rate(
  p_org_id uuid, p_rate numeric, p_basis text, p_vat_rate numeric, p_effective_from date
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_open   public.org_commission_rates%ROWTYPE;
  v_new_id uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_open FROM public.org_commission_rates
   WHERE org_id = p_org_id AND effective_to IS NULL
   ORDER BY effective_from DESC LIMIT 1;

  IF FOUND THEN
    IF p_effective_from < v_open.effective_from THEN
      RAISE EXCEPTION 'new effective_from (%) cannot be before the current rate''s effective_from (%)',
        p_effective_from, v_open.effective_from USING ERRCODE = '22007';
    ELSIF p_effective_from = v_open.effective_from THEN
      UPDATE public.org_commission_rates
         SET rate_percent = p_rate,
             commission_basis = p_basis::public.commission_basis,
             vat_rate_percent = COALESCE(p_vat_rate, 13.00)
       WHERE id = v_open.id
      RETURNING id INTO v_new_id;
      RETURN v_new_id;
    ELSE
      UPDATE public.org_commission_rates
         SET effective_to = p_effective_from - 1
       WHERE id = v_open.id;
    END IF;
  END IF;

  INSERT INTO public.org_commission_rates
    (org_id, rate_percent, commission_basis, vat_rate_percent, effective_from, created_by)
  VALUES
    (p_org_id, p_rate, p_basis::public.commission_basis, COALESCE(p_vat_rate, 13.00), p_effective_from, auth.uid())
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END $$;

GRANT EXECUTE ON FUNCTION public.platform_set_commission_rate(uuid,numeric,text,numeric,date) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('121', 'commission-rate-change-anytime') ON CONFLICT (version) DO NOTHING;
