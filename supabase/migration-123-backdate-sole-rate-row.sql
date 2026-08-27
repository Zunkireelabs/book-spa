-- supabase/migration-123-backdate-sole-rate-row.sql
-- platform_set_commission_rate rejected any p_effective_from before the
-- currently open row's effective_from — correct for orgs with prior closed
-- rate segments (backdating past them would create ambiguous overlapping
-- coverage), but wrong for the common first-collection case: an org whose
-- open row is also its ONLY row ever, being asked (via the commission-collect
-- wizard) to cover a period that starts before that row's effective_from.
-- There is no earlier segment to conflict with, so widening the sole row
-- backward is unambiguous — same category of "correction in place" as
-- migration-121's same-day fix, just backward instead of same-date.

CREATE OR REPLACE FUNCTION public.platform_set_commission_rate(
  p_org_id uuid, p_rate numeric, p_basis text, p_vat_rate numeric, p_effective_from date
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_open      public.org_commission_rates%ROWTYPE;
  v_new_id    uuid;
  v_row_count int;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_open FROM public.org_commission_rates
   WHERE org_id = p_org_id AND effective_to IS NULL
   ORDER BY effective_from DESC LIMIT 1;

  IF FOUND THEN
    IF p_effective_from < v_open.effective_from THEN
      SELECT count(*) INTO v_row_count FROM public.org_commission_rates WHERE org_id = p_org_id;
      IF v_row_count > 1 THEN
        RAISE EXCEPTION 'new effective_from (%) cannot be before the current rate''s effective_from (%) — earlier history already exists for this org',
          p_effective_from, v_open.effective_from USING ERRCODE = '22007';
      END IF;
      -- Sole row for this org: widen it backward in place, no history to conflict with.
      UPDATE public.org_commission_rates
         SET rate_percent = p_rate,
             commission_basis = p_basis::public.commission_basis,
             vat_rate_percent = COALESCE(p_vat_rate, 13.00),
             effective_from = p_effective_from
       WHERE id = v_open.id
      RETURNING id INTO v_new_id;
      RETURN v_new_id;
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
VALUES ('123', 'backdate-sole-rate-row') ON CONFLICT (version) DO NOTHING;
