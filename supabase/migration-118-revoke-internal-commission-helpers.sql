-- supabase/migration-118-revoke-internal-commission-helpers.sql
-- SECURITY FIX. The revenue helpers below are SECURITY DEFINER and take an
-- arbitrary p_org_id with no is_platform_admin() gate. They must be callable
-- ONLY by the gated platform_get_revenue_rollup (as its definer-owner), never
-- by tenant users directly — otherwise any authenticated staff can read any
-- org's revenue/commission. Supabase auto-grants EXECUTE to
-- PUBLIC/anon/authenticated on new functions (see migration-039), so revoke all
-- three explicitly per function. The rollup keeps working because a
-- SECURITY DEFINER function calls these as its owner, which retains EXECUTE.

DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'public.platform_org_sales_base(uuid,date,date)',
    'public.platform_org_category_breakdown(uuid,date,date)',
    'public.platform_org_branch_breakdown(uuid,date,date)',
    'public.platform_commission_for_range(uuid,date,date)'
  ]) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
  END LOOP;
END $$;

-- Defense in depth: gate the one plpgsql helper directly too (cheap; the two
-- LANGUAGE sql breakdowns rely on the revoke above).
CREATE OR REPLACE FUNCTION public.platform_commission_for_range(
  p_org_id uuid, p_from date, p_to date
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  r RECORD;
  v_overlap_from date;
  v_overlap_to   date;
  v_base numeric;
  v_total numeric := 0;
  v_any boolean := false;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  FOR r IN
    SELECT rate_percent, commission_basis, vat_rate_percent, effective_from, effective_to
    FROM public.org_commission_rates
    WHERE org_id = p_org_id
  LOOP
    v_overlap_from := GREATEST(p_from, r.effective_from);
    v_overlap_to   := LEAST(p_to, COALESCE(r.effective_to, v_today));
    IF v_overlap_from <= v_overlap_to THEN
      v_any := true;
      v_base := public.platform_org_sales_base(p_org_id, v_overlap_from, v_overlap_to);
      IF r.commission_basis = 'vat_exclusive' THEN
        v_base := v_base / (1 + r.vat_rate_percent / 100.0);
      END IF;
      v_total := v_total + v_base * r.rate_percent / 100.0;
    END IF;
  END LOOP;
  IF NOT v_any THEN RETURN NULL; END IF;
  RETURN round(v_total, 2);
END $$;

-- CREATE OR REPLACE re-applies default PUBLIC execute — re-revoke this one.
REVOKE ALL ON FUNCTION public.platform_commission_for_range(uuid,date,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_commission_for_range(uuid,date,date) FROM anon;
REVOKE ALL ON FUNCTION public.platform_commission_for_range(uuid,date,date) FROM authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('118', 'revoke-internal-commission-helpers') ON CONFLICT (version) DO NOTHING;
