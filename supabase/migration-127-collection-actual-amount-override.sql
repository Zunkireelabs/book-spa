-- Manual collection override: the formula-computed amount doesn't always match
-- what was actually collected (rounding, negotiated adjustments, partial
-- collection). Let an admin record the real amount while keeping the formula
-- result visible for audit — expected_amount is what platform_commission_for_range
-- computed; amount_collected is what actually happened.

ALTER TABLE public.org_commission_collections
  ADD COLUMN IF NOT EXISTS expected_amount numeric(10,2);

-- New param list is a distinct overload in Postgres — drop the old 8-arg
-- signature so RPC callers can't accidentally resolve to it.
DROP FUNCTION IF EXISTS public.platform_collect_commission(uuid,date,date,numeric,text,numeric,date,text);

CREATE OR REPLACE FUNCTION public.platform_collect_commission(
  p_org_id uuid, p_period_start date, p_period_end date,
  p_rate numeric, p_basis text, p_vat_rate numeric,
  p_collected_at date, p_notes text, p_actual_amount numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_amount   numeric;
  v_gross    numeric;
  v_actual   numeric;
  v_id       uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'period_end (%) cannot be before period_start (%)', p_period_end, p_period_start
      USING ERRCODE = '22007';
  END IF;

  PERFORM public.platform_set_commission_rate(p_org_id, p_rate, p_basis, p_vat_rate, p_period_start);

  v_gross  := public.platform_org_sales_base(p_org_id, p_period_start, p_period_end);
  v_amount := public.platform_commission_for_range(p_org_id, p_period_start, p_period_end);
  v_actual := COALESCE(p_actual_amount, v_amount);

  INSERT INTO public.org_commission_collections
    (org_id, period_start, period_end, amount_collected, expected_amount, collected_at, notes,
     rate_percent, commission_basis, vat_rate_percent, gross_sales, created_by)
  VALUES
    (p_org_id, p_period_start, p_period_end, v_actual, v_amount, p_collected_at, p_notes,
     p_rate, p_basis::public.commission_basis, COALESCE(p_vat_rate, 13.00), v_gross, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'amount_collected', v_actual, 'expected_amount', v_amount, 'gross_sales', v_gross);
END $$;

GRANT EXECUTE ON FUNCTION public.platform_collect_commission(uuid,date,date,numeric,text,numeric,date,text,numeric) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('127', 'collection-actual-amount-override') ON CONFLICT (version) DO NOTHING;
