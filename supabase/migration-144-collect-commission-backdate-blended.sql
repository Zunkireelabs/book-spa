-- platform_collect_commission unconditionally called platform_set_commission_rate
-- before computing the collection amount, trying to force the org's rate table
-- to the wizard's single typed-in rate/basis/VAT "as of period_start". That's
-- correct for the "I'm declaring a new/changed rate as of today" case, but
-- wrong for collecting a genuinely backdated period that already spans
-- multiple historical rate segments (e.g. 2% -> 2% -> 4% -> 10% over several
-- months) — platform_set_commission_rate correctly refuses to backdate
-- through established history (migration-123's guard, ERRCODE 22007), which
-- blocked the collection entirely even though platform_commission_for_range
-- ALREADY computes the correct blended amount by looping every overlapping
-- rate segment and summing sales-in-overlap * that segment's own rate.
--
-- Fix: attempt the rate-set in a sub-transaction (PL/pgSQL's BEGIN/EXCEPTION
-- block gives this for free) and only propagate its effect when it succeeds.
-- On the specific backdate-guard error, swallow it, skip touching the rate
-- table, and record the collection using the blended amount that was already
-- being computed correctly. When the rate-set is skipped, rate_percent/
-- commission_basis/vat_rate_percent are stored NULL on the collection row —
-- a single flat number would misrepresent a period that actually spans
-- several different historical rates. The existing UI already renders "—"
-- for a null rate_percent (Collection history table, migration-127-era).
-- Any other error from platform_set_commission_rate (e.g. not authorized)
-- still propagates and aborts the whole collection, unchanged.
--
-- Second, narrower fix in the same migration: platform_set_commission_rate's
-- backdate guard only looked at the currently OPEN rate row (effective_to IS
-- NULL). An org with NO open rate at all (every segment closed) but with
-- real closed history had no guard whatsoever — p_effective_from could land
-- before that history with no error, silently inserting an out-of-order/
-- overlapping segment. Closes that gap by falling back to the most recent
-- rate row (open or closed) when there's no open one, applying the same
-- ordering guard. The open row (if any) always has the latest effective_from
-- among an org's rows by construction (set_commission_rate only ever closes
-- the current open row and opens a new, later one, or widens a sole row
-- backward) — so "most recent by effective_from" is a strict superset of
-- "the open row" and changes nothing for orgs that do have one.

DROP FUNCTION IF EXISTS public.platform_collect_commission(uuid,date,date,numeric,text,numeric,date,text,numeric);
DROP FUNCTION IF EXISTS public.platform_set_commission_rate(uuid,numeric,text,numeric,date);

CREATE OR REPLACE FUNCTION public.platform_set_commission_rate(
  p_org_id uuid, p_rate numeric, p_basis text, p_vat_rate numeric, p_effective_from date
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_open      public.org_commission_rates%ROWTYPE;
  v_latest    public.org_commission_rates%ROWTYPE;
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
  ELSE
    -- No open rate for this org. Still guard against an out-of-order/
    -- overlapping insert if closed history exists.
    SELECT * INTO v_latest FROM public.org_commission_rates
     WHERE org_id = p_org_id
     ORDER BY effective_from DESC LIMIT 1;
    IF FOUND AND p_effective_from < v_latest.effective_from THEN
      RAISE EXCEPTION 'new effective_from (%) cannot be before the most recent rate''s effective_from (%) — earlier history already exists for this org',
        p_effective_from, v_latest.effective_from USING ERRCODE = '22007';
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

CREATE OR REPLACE FUNCTION public.platform_collect_commission(
  p_org_id uuid, p_period_start date, p_period_end date,
  p_rate numeric, p_basis text, p_vat_rate numeric,
  p_collected_at date, p_notes text, p_actual_amount numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_amount      numeric;
  v_gross       numeric;
  v_actual      numeric;
  v_id          uuid;
  v_rate_stored numeric;
  v_basis_stored text;
  v_vat_stored  numeric;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'period_end (%) cannot be before period_start (%)', p_period_end, p_period_start
      USING ERRCODE = '22007';
  END IF;

  BEGIN
    PERFORM public.platform_set_commission_rate(p_org_id, p_rate, p_basis, p_vat_rate, p_period_start);
    v_rate_stored := p_rate;
    v_basis_stored := p_basis;
    v_vat_stored := p_vat_rate;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '22007' THEN
      -- Backdating into established rate history — leave the rate table
      -- untouched; the collection amount still comes out correct via
      -- platform_commission_for_range's per-segment blend below.
      v_rate_stored := NULL;
      v_basis_stored := NULL;
      v_vat_stored := NULL;
    ELSE
      RAISE;
    END IF;
  END;

  v_gross  := public.platform_org_sales_base(p_org_id, p_period_start, p_period_end);
  v_amount := public.platform_commission_for_range(p_org_id, p_period_start, p_period_end);
  v_actual := COALESCE(p_actual_amount, v_amount);

  INSERT INTO public.org_commission_collections
    (org_id, period_start, period_end, amount_collected, expected_amount, collected_at, notes,
     rate_percent, commission_basis, vat_rate_percent, gross_sales, created_by)
  VALUES
    (p_org_id, p_period_start, p_period_end, v_actual, v_amount, p_collected_at, p_notes,
     v_rate_stored, v_basis_stored::public.commission_basis, v_vat_stored, v_gross, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'amount_collected', v_actual, 'expected_amount', v_amount, 'gross_sales', v_gross,
    'rate_blended', v_rate_stored IS NULL);
END $$;

GRANT EXECUTE ON FUNCTION public.platform_collect_commission(uuid,date,date,numeric,text,numeric,date,text,numeric) TO authenticated;

-- ============================================================
-- Preview RPC: lets the wizard show the real blended amount for a
-- backdated multi-segment period BEFORE the admin clicks Confirm &
-- Collect, instead of a flat client-side calc that wouldn't match what
-- actually gets recorded. Thin, read-only wrapper over the already-correct
-- platform_commission_for_range (internal-only, not itself exposed to
-- authenticated — see migration-118).
-- ============================================================

CREATE OR REPLACE FUNCTION public.platform_preview_blended_commission(
  p_org_id uuid, p_period_start date, p_period_end date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gross  numeric;
  v_amount numeric;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'period_end (%) cannot be before period_start (%)', p_period_end, p_period_start
      USING ERRCODE = '22007';
  END IF;

  v_gross  := public.platform_org_sales_base(p_org_id, p_period_start, p_period_end);
  v_amount := public.platform_commission_for_range(p_org_id, p_period_start, p_period_end);

  RETURN jsonb_build_object('gross_sales', v_gross, 'amount', v_amount);
END $$;

GRANT EXECUTE ON FUNCTION public.platform_preview_blended_commission(uuid,date,date) TO authenticated;

-- ============================================================
-- RECORD MIGRATION
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('144', 'collect-commission-backdate-blended')
ON CONFLICT (version) DO NOTHING;
