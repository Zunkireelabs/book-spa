-- ============================================================
-- Tenant Onboarding Script
-- BooX Multi-Industry Multi-Tenancy
-- ============================================================
--
-- USAGE:
-- 1. Replace all configuration values below
-- 2. Run in Supabase SQL Editor or via psql
-- 3. Follow post-onboarding checklist in docs/feature/multi-tenant-onboard/tenant-onboarding/README.md
--
-- SUPPORTED INDUSTRIES:
-- - 'spa'      : Spa & Wellness (rooms, therapists, gender)
-- - 'cleaning' : Cleaning Services (crew, no rooms)
-- - 'salon'    : Hair Salon (stations, stylists)
--
-- ============================================================

-- ============================================================
-- CONFIGURATION - Replace these values
-- ============================================================

\set org_name 'Your Business Name'
\set org_code 'YBN'
\set org_slug 'your-business-name'
\set owner_email 'admin@yourbusiness.com'
\set industry_type 'spa'
\set timezone 'Asia/Kathmandu'
\set currency 'NPR'
\set branch_name 'Main Branch'
\set branch_address '123 Main Street, City'
\set branch_phone '+977-1-XXXXXXX'

-- ============================================================
-- STEP 1: Create Organization with Industry Type
-- ============================================================

DO $$
DECLARE
  new_org_id uuid;
  new_branch_id uuid;
  industry_record record;
  category_name text;
  category_order int := 0;
BEGIN
  -- Validate industry type exists
  SELECT * INTO industry_record FROM industries WHERE id = :'industry_type';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid industry_type: %. Valid options: spa, cleaning, salon', :'industry_type';
  END IF;

  RAISE NOTICE 'Industry: % (%)', industry_record.name, :'industry_type';
  RAISE NOTICE 'Staff terminology: %', industry_record.staff_label_plural;
  RAISE NOTICE 'Rooms enabled: %', industry_record.enable_rooms;

  -- Create the new organization
  INSERT INTO organizations (name, code, slug, owner_email, timezone, currency, industry_type)
  VALUES (
    :'org_name',
    :'org_code',
    :'org_slug',
    :'owner_email',
    :'timezone',
    :'currency',
    :'industry_type'
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
-- STEP 3: Seed Service Categories from Industry Defaults
-- ============================================================

  FOR category_name IN
    SELECT jsonb_array_elements_text(industry_record.default_categories)
  LOOP
    category_order := category_order + 1;
    INSERT INTO service_categories (name, org_id, display_order, is_active)
    VALUES (category_name, new_org_id, category_order, true);
  END LOOP;

  RAISE NOTICE 'Created % service categories for % industry', category_order, :'industry_type';

-- ============================================================
-- OUTPUT: Save these IDs for user setup
-- ============================================================

  RAISE NOTICE '';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'ONBOARDING COMPLETE';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Organization ID: %', new_org_id;
  RAISE NOTICE 'Branch ID: %', new_branch_id;
  RAISE NOTICE 'Industry: % (%)', industry_record.name, :'industry_type';
  RAISE NOTICE '';
  RAISE NOTICE 'NEXT STEPS:';
  RAISE NOTICE '1. Create admin user in Supabase Auth';
  RAISE NOTICE '2. Insert user record with org_id = %', new_org_id;

  IF industry_record.enable_rooms THEN
    RAISE NOTICE '3. Add % for branch %', industry_record.location_label_plural, new_branch_id;
    RAISE NOTICE '4. Add % for branch %', industry_record.staff_label_plural, new_branch_id;
  ELSE
    RAISE NOTICE '3. Add % for branch % (no % needed)',
      industry_record.staff_label_plural, new_branch_id, industry_record.location_label_plural;
  END IF;

  RAISE NOTICE '============================================================';

END $$;

-- ============================================================
-- STEP 4: Create Admin User (Run after Supabase Auth signup)
-- ============================================================
--
-- After the admin signs up via Supabase Auth, run:
--
-- INSERT INTO users (id, email, full_name, role, org_id, branch_id, is_active)
-- VALUES (
--   '{{AUTH_USER_UUID}}',        -- From Supabase Auth
--   '{{admin@yourbusiness.com}}',
--   '{{Admin Full Name}}',
--   'admin',
--   '{{ORG_ID}}',                -- From output above
--   '{{BRANCH_ID}}',             -- From output above
--   true
-- );

-- ============================================================
-- STEP 5: Add Rooms/Locations (Only for industries with rooms)
-- ============================================================
--
-- For SPA industry:
-- INSERT INTO rooms (branch_id, name, is_active)
-- VALUES
--   ('{{BRANCH_ID}}', 'Room 1', true),
--   ('{{BRANCH_ID}}', 'Room 2', true),
--   ('{{BRANCH_ID}}', 'Room 3', true);
--
-- For SALON industry:
-- INSERT INTO rooms (branch_id, name, is_active)
-- VALUES
--   ('{{BRANCH_ID}}', 'Station 1', true),
--   ('{{BRANCH_ID}}', 'Station 2', true);
--
-- For CLEANING industry: Skip this step (no rooms needed)

-- ============================================================
-- STEP 6: Add Staff (Therapists/Crew/Stylists)
-- ============================================================
--
-- For SPA industry:
-- INSERT INTO therapists (branch_id, name, gender, specialties, is_active)
-- VALUES
--   ('{{BRANCH_ID}}', 'Anjali Thapa', 'Female', ARRAY['Massage', 'Facial'], true),
--   ('{{BRANCH_ID}}', 'Ram Shrestha', 'Male', ARRAY['Deep Tissue', 'Thai'], true);
--
-- For CLEANING industry:
-- INSERT INTO therapists (branch_id, name, gender, specialties, is_active)
-- VALUES
--   ('{{BRANCH_ID}}', 'Team Alpha', 'Male', ARRAY['Residential', 'Deep Clean'], true),
--   ('{{BRANCH_ID}}', 'Team Beta', 'Female', ARRAY['Commercial', 'Office'], true);
--
-- For SALON industry:
-- INSERT INTO therapists (branch_id, name, gender, specialties, is_active)
-- VALUES
--   ('{{BRANCH_ID}}', 'Maya Gurung', 'Female', ARRAY['Haircut', 'Color'], true);

-- ============================================================
-- STEP 7: Add Services (Examples per industry)
-- ============================================================
--
-- For SPA industry:
-- INSERT INTO services (name, duration_minutes, price_npr, category, org_id, is_active)
-- VALUES
--   ('Swedish Massage', 60, 3500, 'Spa', '{{ORG_ID}}', true),
--   ('Deep Tissue Massage', 90, 5000, 'Spa', '{{ORG_ID}}', true),
--   ('Basic Facial', 45, 2500, 'Facial', '{{ORG_ID}}', true);
--
-- For CLEANING industry:
-- INSERT INTO services (name, duration_minutes, price_npr, category, org_id, is_active)
-- VALUES
--   ('Regular Home Cleaning', 120, 3000, 'Residential', '{{ORG_ID}}', true),
--   ('Deep Clean', 240, 8000, 'Deep Clean', '{{ORG_ID}}', true),
--   ('Office Cleaning', 180, 5000, 'Commercial', '{{ORG_ID}}', true);
--
-- For SALON industry:
-- INSERT INTO services (name, duration_minutes, price_npr, category, org_id, is_active)
-- VALUES
--   ('Haircut - Men', 30, 500, 'Haircut', '{{ORG_ID}}', true),
--   ('Haircut - Women', 45, 800, 'Haircut', '{{ORG_ID}}', true),
--   ('Hair Color', 90, 3000, 'Hair Color', '{{ORG_ID}}', true);

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Run these to verify onboarding:

-- Check organization with industry:
-- SELECT id, name, code, industry_type FROM organizations WHERE code = '{{ORG_CODE}}';

-- Check branch:
-- SELECT id, name, org_id FROM branches WHERE org_id = '{{ORG_ID}}';

-- Check service categories (should match industry):
-- SELECT name, display_order FROM service_categories WHERE org_id = '{{ORG_ID}}' ORDER BY display_order;

-- Check industry config:
-- SELECT * FROM industries WHERE id = '{{INDUSTRY_TYPE}}';
