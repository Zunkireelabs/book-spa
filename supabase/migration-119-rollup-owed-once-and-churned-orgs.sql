-- supabase/migration-119-rollup-owed-once-and-churned-orgs.sql
-- F2: compute commission_owed_to_date once (was computed twice per org).
-- F4: include inactive orgs that still have a commission rate (unsettled deals).
-- Body otherwise identical to migration 116's rollup. SECURITY DEFINER + gate unchanged.

CREATE OR REPLACE FUNCTION public.platform_get_revenue_rollup(
  p_from date, p_to date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_result jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(org_obj ORDER BY org_name), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      jsonb_build_object(
        'org_id', o.id,
        'org_name', o.name,
        'gross_total', public.platform_org_sales_base(o.id, p_from, p_to),
        'revenue_by_category', public.platform_org_category_breakdown(o.id, p_from, p_to),
        'revenue_by_branch',   public.platform_org_branch_breakdown(o.id, p_from, p_to),
        'active_rate_percent',     ar.rate_percent,
        'active_commission_basis', ar.commission_basis,
        'commission_for_range',    public.platform_commission_for_range(o.id, p_from, p_to),
        'commission_owed_to_date', owed_l.owed,
        'collected_to_date',       COALESCE(coll.total, 0),
        'net_owed',                CASE WHEN owed_l.owed IS NULL THEN NULL
                                        ELSE owed_l.owed - COALESCE(coll.total, 0) END
      ) AS org_obj,
      o.name AS org_name
    FROM public.organizations o
    LEFT JOIN LATERAL (
      SELECT rate_percent, commission_basis
      FROM public.org_commission_rates
      WHERE org_id = o.id AND effective_to IS NULL
      ORDER BY effective_from DESC LIMIT 1
    ) ar ON true
    LEFT JOIN LATERAL (
      SELECT MIN(effective_from) AS first_from
      FROM public.org_commission_rates WHERE org_id = o.id
    ) fr ON true
    LEFT JOIN LATERAL (
      SELECT CASE WHEN fr.first_from IS NULL THEN NULL
                  ELSE public.platform_commission_for_range(o.id, fr.first_from, v_today) END AS owed
    ) owed_l ON true
    LEFT JOIN LATERAL (
      SELECT SUM(amount_collected) AS total
      FROM public.org_commission_collections WHERE org_id = o.id
    ) coll ON true
    WHERE o.is_active
       OR EXISTS (SELECT 1 FROM public.org_commission_rates r WHERE r.org_id = o.id)
  ) sub;

  RETURN v_result;
END $$;

-- CREATE OR REPLACE resets grants; the rollup is a gated public-facing RPC.
GRANT EXECUTE ON FUNCTION public.platform_get_revenue_rollup(date,date) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('119', 'rollup-owed-once-and-churned-orgs') ON CONFLICT (version) DO NOTHING;
