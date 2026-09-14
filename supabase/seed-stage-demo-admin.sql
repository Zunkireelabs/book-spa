-- ============================================================
-- Local testing admin login for nuad-thai-spa (STAGING ONLY)
-- ============================================================
-- Created ad hoc for local testing of the couple-separate-rooms feature
-- (feature/couple-separate-rooms branch) — no admin credentials were on
-- hand locally. Not a tracked migration (seed data, per CLAUDE.md).
--
-- STAGING ONLY. Do not run this against production.
--
-- Idempotent: no-op if the email already exists.
--   Delete first to reseed:  DELETE FROM auth.users WHERE email = 'admin.local@zunkireelabs.com';
--
-- Login:
--   URL:      http://localhost:4028/nuad-thai-spa/login
--   Email:    admin.local@zunkireelabs.com
--   Password: LocalAdmin2026#Test
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_email        text := 'admin.local@zunkireelabs.com';
  v_password     text := 'LocalAdmin2026#Test';
  v_full_name    text := 'Local Test Admin';
  v_org_id       uuid;
  v_branch_id    uuid;
  v_auth_user_id uuid := gen_random_uuid();
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
    RAISE NOTICE 'Admin % already exists — skipping.', v_email;
    RETURN;
  END IF;

  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Org "nuad-thai-spa" not found on this database — aborting.';
  END IF;

  -- Sanepa branch — known from testing to have multiple active capacity-1
  -- rooms, useful for exercising couple-in-two-rooms bookings.
  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id ORDER BY name LIMIT 1;
  END IF;

  -- GoTrue scans several of these text columns as non-nullable Go strings —
  -- they must be '' rather than left NULL, or /token (password grant) 500s.
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    aud, role, created_at, updated_at,
    confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) VALUES (
    v_auth_user_id,
    '00000000-0000-0000-0000-000000000000',
    v_email,
    crypt(v_password, gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}',
    jsonb_build_object('full_name', v_full_name),
    'authenticated', 'authenticated', now(), now(),
    '', '',
    '', '', '',
    '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
  ) VALUES (
    v_auth_user_id, v_auth_user_id, v_email, 'email',
    jsonb_build_object('sub', v_auth_user_id::text, 'email', v_email),
    now(), now(), now()
  );

  INSERT INTO public.users (id, org_id, email, full_name, role, branch_id, is_active)
  VALUES (v_auth_user_id, v_org_id, v_email, v_full_name, 'admin', v_branch_id, true);

  RAISE NOTICE 'Admin seeded: % / % (branch_id=%)', v_email, v_password, v_branch_id;
END $$;

COMMIT;
