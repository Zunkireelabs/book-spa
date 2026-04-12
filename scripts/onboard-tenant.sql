-- ============================================================
-- Tenant Onboarding Script
-- BookSpa Multi-Tenancy
-- ============================================================
--
-- USAGE:
-- 1. Replace all placeholder values marked with {{PLACEHOLDER}}
-- 2. Run in Supabase SQL Editor or via psql
-- 3. Follow post-onboarding checklist in docs/tenant-onboarding/README.md
--
-- ============================================================

-- ============================================================
-- CONFIGURATION - Replace these values
-- ============================================================

\set org_name 'Your Spa Name'
\set org_code 'YSN'
\set org_slug 'your-spa-name'
\set owner_email 'admin@yourspa.com'
\set timezone 'Asia/Kathmandu'
\set currency 'NPR'
\set branch_name 'Main Branch'
\set branch_address '123 Main Street, City'
\set branch_phone '+977-1-XXXXXXX'

-- ============================================================
-- STEP 1: Create Organization
-- ============================================================

DO $$
DECLARE
  new_org_id uuid;
  new_branch_id uuid;
  template_org_id uuid := '00000000-0000-0000-0000-000000000001'; -- Nuad Thai Spa
BEGIN
  -- Create the new organization
  INSERT INTO organizations (name, code, slug, owner_email, timezone, currency)
  VALUES (
    :'org_name',
    :'org_code',
    :'org_slug',
    :'owner_email',
    :'timezone',
    :'currency'
  )
  RETURNING id INTO new_org_id;

  RAISE NOTICE 'Created organization: % (ID: %)', :'org_name', new_org_id;

-- ============================================================
-- STEP 2: Create Initial Branch
-- ============================================================

  INSERT INTO branches (name, address, phone, org_id, is_active)
  VALUES (
    :'branch_name',
    :'branch_address',
    :'branch_phone',
    new_org_id,
    true
  )
  RETURNING id INTO new_branch_id;

  RAISE NOTICE 'Created branch: % (ID: %)', :'branch_name', new_branch_id;

-- ============================================================
-- STEP 3: Copy Service Categories from Template Org (Optional)
-- ============================================================

  INSERT INTO service_categories (name, description, is_active, display_order, org_id)
  SELECT
    name,
    description,
    is_active,
    display_order,
    new_org_id
  FROM service_categories
  WHERE org_id = template_org_id;

  RAISE NOTICE 'Copied % service categories from template', (
    SELECT COUNT(*) FROM service_categories WHERE org_id = new_org_id
  );

-- ============================================================
-- STEP 4: Copy Services from Template Org (Optional)
-- Uncomment if you want to clone Nuad Thai's service catalog
-- ============================================================

  -- INSERT INTO services (name, duration_minutes, price_npr, description, is_active, org_id, category)
  -- SELECT
  --   name,
  --   duration_minutes,
  --   price_npr,
  --   description,
  --   is_active,
  --   new_org_id,
  --   category
  -- FROM services
  -- WHERE org_id = template_org_id;
  --
  -- RAISE NOTICE 'Copied % services from template', (
  --   SELECT COUNT(*) FROM services WHERE org_id = new_org_id
  -- );

-- ============================================================
-- OUTPUT: Save these IDs for user setup
-- ============================================================

  RAISE NOTICE '============================================================';
  RAISE NOTICE 'ONBOARDING COMPLETE';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Organization ID: %', new_org_id;
  RAISE NOTICE 'Branch ID: %', new_branch_id;
  RAISE NOTICE '';
  RAISE NOTICE 'NEXT STEPS:';
  RAISE NOTICE '1. Create admin user in Supabase Auth';
  RAISE NOTICE '2. Insert user record with org_id = %', new_org_id;
  RAISE NOTICE '3. Add rooms and therapists for branch %', new_branch_id;
  RAISE NOTICE '============================================================';

END $$;

-- ============================================================
-- STEP 5: Create Admin User (Run after Supabase Auth signup)
-- ============================================================
--
-- After the admin signs up via Supabase Auth, run:
--
-- INSERT INTO users (id, email, full_name, role, org_id, branch_id, is_active)
-- VALUES (
--   '{{AUTH_USER_UUID}}',        -- From Supabase Auth
--   '{{admin@yourspa.com}}',
--   '{{Admin Full Name}}',
--   'admin',
--   '{{ORG_ID}}',                -- From Step 1 output
--   '{{BRANCH_ID}}',             -- From Step 2 output
--   true
-- );

-- ============================================================
-- STEP 6: Add Rooms (Example)
-- ============================================================
--
-- INSERT INTO rooms (branch_id, name, is_active)
-- VALUES
--   ('{{BRANCH_ID}}', 'Room 1', true),
--   ('{{BRANCH_ID}}', 'Room 2', true),
--   ('{{BRANCH_ID}}', 'Room 3', true);

-- ============================================================
-- STEP 7: Add Therapists (Example)
-- ============================================================
--
-- INSERT INTO therapists (branch_id, name, gender, specialties, is_active)
-- VALUES
--   ('{{BRANCH_ID}}', 'Therapist Name', 'Female', ARRAY['Massage', 'Facial'], true);

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Run these to verify onboarding:

-- SELECT * FROM organizations WHERE code = '{{ORG_CODE}}';
-- SELECT * FROM branches WHERE org_id = '{{ORG_ID}}';
-- SELECT COUNT(*) FROM service_categories WHERE org_id = '{{ORG_ID}}';
-- SELECT COUNT(*) FROM services WHERE org_id = '{{ORG_ID}}';
