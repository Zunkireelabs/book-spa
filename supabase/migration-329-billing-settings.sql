-- migration-329-billing-settings.sql
--
-- Admin-configurable billing/tax settings for invoices (migration-328). The
-- user: "let admin set the VAT number, VAT included or excluded or extra,
-- company's information and other things that are needed."
--
-- No new table, no new RPC — reuses update_org_profile_settings() exactly as
-- migration-251 defined it and migration-285 already widened once, just
-- adding the billing keys to its allow-list. Same reasoning as 285: admin-only
-- enforcement already lives in that function, so widening the allow-list is
-- the whole change.
--
-- The three tax modes, named by behaviour rather than by the user's ambiguous
-- "included or excluded or extra" (which reads two ways for "excluded" — not
-- charged, or added on top):
--   inclusive — existing price already includes VAT; it's extracted for
--               display, the total the customer pays doesn't change.
--   addon     — VAT added on top of the existing price; the customer pays
--               more than today. issue_invoice() in migration-328 refuses to
--               issue in this mode unless the booking's payment actually
--               collected the VAT-inclusive total — which nothing in the
--               booking/quoting flow does today, so this mode is built and
--               gated but not independently usable until a separate,
--               larger change teaches quoting to add VAT up front. Not built
--               here; flagged to the user as its own piece of work.
--   none      — no VAT line on the invoice at all.
--
-- Settings keys, all under organizations.settings:
--   billing_legal_name     text   — may differ from organizations.name ("Pvt. Ltd." etc).
--   billing_pan            text   — PAN/VAT registration number.
--   billing_address        text   — company-level registered address (the issuing
--                                   BRANCH's own address/phone already exist on
--                                   `branches` and are frozen onto the invoice
--                                   alongside this, not replaced by it).
--   billing_phone          text
--   billing_email          text
--   billing_tax_mode       text   — 'inclusive' | 'addon' | 'none'. NEVER defaulted:
--                                   issue_invoice() fails closed if unset, because a
--                                   defaulted mode silently decides what the customer
--                                   is charged. A new tenant with nothing configured
--                                   must fail closed too, not inherit one tenant's
--                                   answer — see the seed script for why this is set
--                                   as data for one org, not a code default.
--   billing_vat_rate       numeric — defaults to 13 if unset (a rate, not a mode
--                                    choice — safe to default, unlike tax_mode).
--   billing_invoice_prefix text   — optional override for the printed invoice number
--                                   prefix; the underlying per-fiscal-year sequence
--                                   is unaffected by this (see migration-328).
--   billing_footer_text    text   — thank-you/terms line on the printed invoice.
--                                   NOT frozen onto the invoice snapshot — read live
--                                   at print time like a letterhead, since it isn't a
--                                   fact about the sale the way amounts/identity are.
--
-- Logo: not added. A URL-only field is trivial to add later if asked for;
-- file upload to storage is its own piece of work and wasn't built to avoid
-- half-finishing it.
--
-- Reversible: re-run migration-285's CREATE OR REPLACE FUNCTION body verbatim
-- to shrink the allow-list back (no column/table to drop — this migration
-- only replaces a function).

BEGIN;

CREATE OR REPLACE FUNCTION public.update_org_profile_settings(p_key text, p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id   uuid := get_user_org_id();
  v_role     text := get_user_role();
  v_settings jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'update_org_profile_settings: admin only';
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'update_org_profile_settings: no organization context';
  END IF;

  IF p_key NOT IN (
    'about', 'amenities', 'included_with_visit', 'optional_extras',
    'cancellation_policy', 'use_provider_profile_layout',
    'calendar_start_time', 'calendar_interval_minutes', 'cancellation_reasons',
    'billing_legal_name', 'billing_pan', 'billing_address', 'billing_phone',
    'billing_email', 'billing_tax_mode', 'billing_vat_rate',
    'billing_invoice_prefix', 'billing_footer_text'
  ) THEN
    RAISE EXCEPTION 'update_org_profile_settings: unknown setting key %', p_key;
  END IF;

  IF p_key = 'billing_tax_mode' AND p_value::text NOT IN ('"inclusive"', '"addon"', '"none"') THEN
    RAISE EXCEPTION 'update_org_profile_settings: billing_tax_mode must be inclusive, addon, or none';
  END IF;

  UPDATE public.organizations
  SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), ARRAY[p_key], p_value, true)
  WHERE id = v_org_id
  RETURNING settings INTO v_settings;

  IF v_settings IS NULL THEN
    RAISE EXCEPTION 'update_org_profile_settings: organization % not found', v_org_id;
  END IF;

  RETURN v_settings;
END;
$$;

REVOKE ALL ON FUNCTION public.update_org_profile_settings(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_org_profile_settings(text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_org_profile_settings(text, jsonb) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('329', 'billing-settings')
ON CONFLICT (version) DO NOTHING;

COMMIT;
