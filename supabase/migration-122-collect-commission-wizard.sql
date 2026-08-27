-- supabase/migration-122-collect-commission-wizard.sql
-- "Collect Commission" wizard: snapshot the rate/basis/VAT% actually used for a
-- collection cycle directly onto org_commission_collections (previously only
-- amount_collected was stored, so there was no way to show "on what % cut" a
-- past collection was made), and give the frontend one atomic RPC that both
-- corrects the rate for this cycle (via the existing platform_set_commission_rate
-- logic) and records the collection, instead of two separate free-form calls.

ALTER TABLE public.org_commission_collections
  ADD COLUMN IF NOT EXISTS rate_percent     numeric(5,2),
  ADD COLUMN IF NOT EXISTS commission_basis public.commission_basis,
  ADD COLUMN IF NOT EXISTS vat_rate_percent numeric(5,2);
-- Nullable: rows collected before this migration predate the snapshot and have
-- no recorded basis; the frontend renders those as "—".

CREATE OR REPLACE FUNCTION public.platform_collect_commission(
  p_org_id uuid, p_period_start date, p_period_end date,
  p_rate numeric, p_basis text, p_vat_rate numeric,
  p_collected_at date, p_notes text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_amount numeric;
  v_id     uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'period_end (%) cannot be before period_start (%)', p_period_end, p_period_start
      USING ERRCODE = '22007';
  END IF;

  -- Correct/insert the commission rate so it covers this cycle from p_period_start
  -- onward (same rule as the standalone rate editor: same effective_from corrects
  -- in place, a later one closes the prior open row).
  PERFORM public.platform_set_commission_rate(p_org_id, p_rate, p_basis, p_vat_rate, p_period_start);

  v_amount := public.platform_commission_for_range(p_org_id, p_period_start, p_period_end);

  INSERT INTO public.org_commission_collections
    (org_id, period_start, period_end, amount_collected, collected_at, notes,
     rate_percent, commission_basis, vat_rate_percent, created_by)
  VALUES
    (p_org_id, p_period_start, p_period_end, v_amount, p_collected_at, p_notes,
     p_rate, p_basis::public.commission_basis, COALESCE(p_vat_rate, 13.00), auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'amount_collected', v_amount);
END $$;

GRANT EXECUTE ON FUNCTION public.platform_collect_commission(uuid,date,date,numeric,text,numeric,date,text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('122', 'collect-commission-wizard') ON CONFLICT (version) DO NOTHING;
