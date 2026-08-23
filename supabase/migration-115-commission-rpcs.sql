-- supabase/migration-115-commission-rpcs.sql
-- Platform-admin-only read/write RPCs for commission config. Each self-gates on
-- is_platform_admin(). Granted to authenticated because RLS on the tables is
-- deny-all; the gate + SECURITY DEFINER are the access control.

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
    IF p_effective_from <= v_open.effective_from THEN
      RAISE EXCEPTION 'new effective_from (%) must be after the current rate''s effective_from (%)',
        p_effective_from, v_open.effective_from USING ERRCODE = '22007';
    END IF;
    UPDATE public.org_commission_rates
       SET effective_to = p_effective_from - 1
     WHERE id = v_open.id;
  END IF;

  INSERT INTO public.org_commission_rates
    (org_id, rate_percent, commission_basis, vat_rate_percent, effective_from, created_by)
  VALUES
    (p_org_id, p_rate, p_basis::public.commission_basis, COALESCE(p_vat_rate, 13.00), p_effective_from, auth.uid())
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END $$;

CREATE OR REPLACE FUNCTION public.platform_record_collection(
  p_org_id uuid, p_period_start date, p_period_end date,
  p_amount numeric, p_collected_at date, p_notes text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.org_commission_collections
    (org_id, period_start, period_end, amount_collected, collected_at, notes, created_by)
  VALUES (p_org_id, p_period_start, p_period_end, p_amount, p_collected_at, p_notes, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.platform_list_rates(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.effective_from DESC), '[]'::jsonb)
    INTO v FROM public.org_commission_rates r WHERE r.org_id = p_org_id;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.platform_list_collections(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.collected_at DESC), '[]'::jsonb)
    INTO v FROM public.org_commission_collections c WHERE c.org_id = p_org_id;
  RETURN v;
END $$;

GRANT EXECUTE ON FUNCTION public.platform_set_commission_rate(uuid,numeric,text,numeric,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_record_collection(uuid,date,date,numeric,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_list_rates(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_list_collections(uuid) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('115', 'commission-rpcs') ON CONFLICT (version) DO NOTHING;
