-- Migration 383 (ZNLY-218): "Add VAT on top" is not offered until checkout can collect the VAT.
-- Found end to end (supabase/tests/znly-218.sql): with billing_tax_mode = 'addon' the checkout collects the price only
-- (record_booking_payment refuses anything above final_amount, migration 380), while issue_invoice() needs collected = price + VAT,
-- so every invoice in that mode is refused. Until quoting adds VAT up front, the database refuses to SET addon:
--   * a tenant cannot switch to addon, or switch billing ON while addon is set (any write path: the settings RPC, SQL, onboarding);
--   * a tenant that already has addon keeps its data untouched, and can still edit every other setting;
--   * saving a different tax mode (inclusive / none) clears the way.
-- Rollback (manual): DROP TRIGGER trg_org_billing_no_addon ON public.organizations; DROP FUNCTION public.trg_org_billing_no_addon().
-- Applied: stage - / prod HELD.

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_org_billing_no_addon() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_new text := NEW.settings->>'billing_tax_mode';
  v_old text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.settings->>'billing_tax_mode' END;
  v_on_new boolean := COALESCE((NEW.settings->>'billing_enabled')::boolean, false);
  v_on_old boolean := CASE WHEN TG_OP = 'UPDATE' THEN COALESCE((OLD.settings->>'billing_enabled')::boolean, false) ELSE false END;
BEGIN
  IF v_new = 'addon' AND (v_old IS DISTINCT FROM 'addon' OR (v_on_new AND NOT v_on_old)) THEN
    RAISE EXCEPTION 'BILLING_ADDON_UNAVAILABLE: "Add VAT on top" will come later; prices include VAT or no VAT. Choose one of those first.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_org_billing_no_addon ON public.organizations;
CREATE TRIGGER trg_org_billing_no_addon BEFORE INSERT OR UPDATE OF settings ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.trg_org_billing_no_addon();

INSERT INTO public.schema_migrations (version, name)
VALUES ('383', 'billing-no-addon-vat')
ON CONFLICT (version) DO NOTHING;

COMMIT;
