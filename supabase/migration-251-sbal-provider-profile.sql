-- Migration 251: sbal provider-profile customer booking page
-- (additive, REVERSIBLE)
--
-- Backs the alternate profile-page-style customer booking layout (vs. the default
-- linear wizard) for one tenant at a time, gated behind
-- organizations.settings.use_provider_profile_layout. Adds:
--   - organizations.logo_url / organizations.hero_image_url — plain URL columns,
--     same precedent as therapists.photo_url. No storage bucket.
--   - update_org_profile_settings(p_key, p_value jsonb) — sibling to
--     update_org_booking_settings (migration-248), kept separate because the value
--     type differs (jsonb vs boolean). Allow-listed keys: about, amenities,
--     included_with_visit, optional_extras, cancellation_policy,
--     use_provider_profile_layout.
--   - update_org_branding(p_logo_url, p_hero_image_url) — writes the two new plain
--     columns directly; organizations has no blanket UPDATE RLS, so a narrow
--     SECURITY DEFINER RPC is required (same shape as migration-052's
--     update_org_payment_methods).
--
-- Reversible:
--   DROP FUNCTION IF EXISTS public.update_org_profile_settings(text, jsonb);
--   DROP FUNCTION IF EXISTS public.update_org_branding(text, text);
--   ALTER TABLE public.organizations DROP COLUMN IF EXISTS logo_url;
--   ALTER TABLE public.organizations DROP COLUMN IF EXISTS hero_image_url;

BEGIN;

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS hero_image_url text;

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
    'cancellation_policy', 'use_provider_profile_layout'
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

CREATE OR REPLACE FUNCTION public.update_org_branding(p_logo_url text, p_hero_image_url text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid := get_user_org_id();
  v_role   text := get_user_role();
  v_row    jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'update_org_branding: admin only';
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'update_org_branding: no organization context';
  END IF;

  UPDATE public.organizations
  SET logo_url = p_logo_url,
      hero_image_url = p_hero_image_url
  WHERE id = v_org_id
  RETURNING jsonb_build_object('logo_url', logo_url, 'hero_image_url', hero_image_url) INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'update_org_branding: organization % not found', v_org_id;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_org_branding(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_org_branding(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_org_branding(text, text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('251', 'sbal-provider-profile')
ON CONFLICT (version) DO NOTHING;

COMMIT;
