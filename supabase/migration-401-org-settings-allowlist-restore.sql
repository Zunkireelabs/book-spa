-- ZNLY-267: Settings > Calendar Settings failed with
--   "update_org_profile_settings: unknown setting key calendar_show_full_day".
-- Cause: each migration that touches update_org_profile_settings redefines the WHOLE
-- function with its own allowlist. 285/286/298 added calendar_start_time /
-- calendar_end_time / calendar_show_full_day, but 328/329/332 (billing) were written from
-- an older body and dropped calendar_end_time and calendar_show_full_day.
-- This restores the FULL allowlist = every key any migration ever allowed (the 332 body
-- plus the two calendar keys), with the same checks, SECURITY DEFINER and grants.
-- Rule for the future: copy the LATEST body, add your key. A vitest
-- (src/services/orgSettingsAllowlist.test.js) fails if a key the UI writes is missing.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_org_profile_settings(p_key text, p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    'calendar_start_time', 'calendar_end_time', 'calendar_interval_minutes',
    'calendar_show_full_day', 'cancellation_reasons',
    'billing_legal_name', 'billing_pan', 'billing_address', 'billing_phone',
    'billing_email', 'billing_tax_mode', 'billing_vat_rate',
    'billing_invoice_prefix', 'billing_footer_text', 'billing_enabled'
  ) THEN
    RAISE EXCEPTION 'update_org_profile_settings: unknown setting key %', p_key;
  END IF;

  IF p_key = 'billing_tax_mode' AND p_value::text NOT IN ('"inclusive"', '"addon"', '"none"') THEN
    RAISE EXCEPTION 'update_org_profile_settings: billing_tax_mode must be inclusive, addon, or none';
  END IF;
  IF p_key = 'billing_enabled' AND jsonb_typeof(p_value) <> 'boolean' THEN
    RAISE EXCEPTION 'update_org_profile_settings: billing_enabled must be a boolean';
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
$function$;

REVOKE ALL ON FUNCTION public.update_org_profile_settings(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_org_profile_settings(text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_org_profile_settings(text, jsonb) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('401', 'org-settings-allowlist-restore')
ON CONFLICT (version) DO NOTHING;

COMMIT;
