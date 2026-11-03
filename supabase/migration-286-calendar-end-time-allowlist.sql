-- Migration 286: calendar end time setting
-- (additive, REVERSIBLE)
--
-- Extends update_org_profile_settings's (migration-251, widened by migration-285)
-- p_key allow-list with one more org.settings key:
--   - calendar_end_time (text, "HH:MM") — default visible LAST hour on the Day/Week
--     grid, paired with migration-285's calendar_start_time. The grid previously had
--     no end-time setting at all (closeHour was hardcoded to 23 in CalendarGrid.jsx).
--
-- No new table, no new RPC — reuses update_org_profile_settings exactly as
-- migration-285 defined it, just widening its allow-list by one more key.
--
-- Reversible: re-run migration-285's CREATE OR REPLACE body verbatim to shrink the
-- allow-list back (no column/table to drop — this migration only replaces a function).

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
    'calendar_start_time', 'calendar_end_time', 'calendar_interval_minutes',
    'cancellation_reasons'
  ) THEN
    RAISE EXCEPTION 'update_org_profile_settings: unknown setting key %', p_key;
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
VALUES ('286', 'calendar-end-time-allowlist')
ON CONFLICT (version) DO NOTHING;

COMMIT;
