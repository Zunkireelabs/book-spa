-- supabase/migration-124-collection-sales-snapshot.sql
-- Collection history showed the resulting commission amount and the rate/basis
-- used, but not the sales figure it was computed from — so there was no way to
-- see "NPR X sales, VAT backed out to Y, Z% of Y = commission" per past
-- collection. Snapshot gross_sales (drawer-basis sales for that exact period,
-- same helper platform_collect_commission already uses to derive the amount)
-- so history stays accurate even if later data corrections shift what
-- platform_org_sales_base would return today for that period.

ALTER TABLE public.org_commission_collections
  ADD COLUMN IF NOT EXISTS gross_sales numeric(12,2);
-- Nullable: rows collected before this migration predate the snapshot.

CREATE OR REPLACE FUNCTION public.platform_collect_commission(
  p_org_id uuid, p_period_start date, p_period_end date,
  p_rate numeric, p_basis text, p_vat_rate numeric,
  p_collected_at date, p_notes text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_amount numeric;
  v_gross  numeric;
  v_id     uuid;
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

  INSERT INTO public.org_commission_collections
    (org_id, period_start, period_end, amount_collected, collected_at, notes,
     rate_percent, commission_basis, vat_rate_percent, gross_sales, created_by)
  VALUES
    (p_org_id, p_period_start, p_period_end, v_amount, p_collected_at, p_notes,
     p_rate, p_basis::public.commission_basis, COALESCE(p_vat_rate, 13.00), v_gross, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'amount_collected', v_amount, 'gross_sales', v_gross);
END $$;

GRANT EXECUTE ON FUNCTION public.platform_collect_commission(uuid,date,date,numeric,text,numeric,date,text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('124', 'collection-sales-snapshot') ON CONFLICT (version) DO NOTHING;
