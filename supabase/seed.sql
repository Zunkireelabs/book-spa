-- ============================================================
-- BookSpa Phase 1: Seed Data
-- Run this AFTER schema.sql and rls.sql
-- ============================================================
-- NOTE: User rows (staff, manager, admin) must be created AFTER
-- you manually create auth users in the Supabase Auth dashboard.
-- See instructions below.
-- ============================================================

-- ============================================================
-- 1. BRANCH: Lazimpat
-- ============================================================

INSERT INTO branches (id, name, address, phone) VALUES
  ('b0000000-0000-0000-0000-000000000001',
   'Lazimpat',
   'Lazimpat Road, Kathmandu 44600, Nepal',
   '+977-1-4441234');

-- ============================================================
-- 2. ROOMS: 9 rooms for Lazimpat
-- ============================================================

INSERT INTO rooms (id, branch_id, name) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Room 1'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'Room 2'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'Room 3'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'Room 4'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 'Room 5'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000001', 'Room 6'),
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000001', 'Room 7'),
  ('a0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000001', 'Room 8'),
  ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000001', 'Room 9');

-- ============================================================
-- 3. SERVICES: 8 services
-- ============================================================

INSERT INTO services (id, name, duration_minutes, price_npr, description) VALUES
  ('c0000000-0000-0000-0000-000000000001',
   'Deep Tissue Massage', 60, 2500.00,
   'Therapeutic massage targeting muscle tension and knots using firm pressure and slow strokes'),

  ('c0000000-0000-0000-0000-000000000002',
   'Swedish Massage', 60, 2000.00,
   'Classic relaxation massage with long flowing strokes to improve circulation and reduce stress'),

  ('c0000000-0000-0000-0000-000000000003',
   'Hot Stone Therapy', 90, 3500.00,
   'Heated basalt stones placed on key body points combined with massage techniques for deep relaxation'),

  ('c0000000-0000-0000-0000-000000000004',
   'Aromatherapy Massage', 75, 2800.00,
   'Essential oil-infused massage combining therapeutic scents with gentle to medium pressure techniques'),

  ('c0000000-0000-0000-0000-000000000005',
   'Traditional Thai Massage', 90, 3000.00,
   'Ancient healing art combining acupressure, stretching, and energy line work without oils'),

  ('c0000000-0000-0000-0000-000000000006',
   'Couples Massage', 60, 4500.00,
   'Side-by-side massage experience for two, available with choice of massage styles'),

  ('c0000000-0000-0000-0000-000000000007',
   'Prenatal Massage', 60, 2800.00,
   'Gentle massage specifically designed for expectant mothers to relieve pregnancy-related discomfort'),

  ('c0000000-0000-0000-0000-000000000008',
   'Foot Reflexology', 45, 1800.00,
   'Pressure point therapy on feet that corresponds to body organs and systems for holistic healing');

-- ============================================================
-- 4. THERAPISTS: 6 therapists for Lazimpat
-- ============================================================

INSERT INTO therapists (id, branch_id, name, gender, specialties) VALUES
  ('d0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001',
   'Emma Wilson', 'Female',
   ARRAY['Deep Tissue', 'Swedish', 'Prenatal']),

  ('d0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000001',
   'David Kim', 'Male',
   ARRAY['Sports', 'Deep Tissue', 'Hot Stone']),

  ('d0000000-0000-0000-0000-000000000003',
   'b0000000-0000-0000-0000-000000000001',
   'Lisa Rodriguez', 'Female',
   ARRAY['Aromatherapy', 'Hot Stone', 'Reflexology']),

  ('d0000000-0000-0000-0000-000000000004',
   'b0000000-0000-0000-0000-000000000001',
   'Anjali Thapa', 'Female',
   ARRAY['Reflexology', 'Traditional Thai', 'Prenatal']),

  ('d0000000-0000-0000-0000-000000000005',
   'b0000000-0000-0000-0000-000000000001',
   'Michael Chen', 'Male',
   ARRAY['Swedish', 'Sports', 'Deep Tissue']),

  ('d0000000-0000-0000-0000-000000000006',
   'b0000000-0000-0000-0000-000000000001',
   'Sita Gurung', 'Female',
   ARRAY['Traditional Thai', 'Aromatherapy', 'Hot Stone']);

-- ============================================================
-- 5. USERS: Run AFTER creating auth users in Supabase dashboard
-- ============================================================
-- INSTRUCTIONS:
-- 1. Go to Supabase Dashboard → Authentication → Users
-- 2. Click "Add user" → "Create new user" for each:
--    a. Email: staff@bookspa.com.np    Password: BookSpa@Staff123
--    b. Email: manager@bookspa.com.np  Password: BookSpa@Manager123
--    c. Email: admin@bookspa.com.np    Password: BookSpa@Admin123
--    (Check "Auto Confirm User" for each)
-- 3. Copy the UUID for each created user
-- 4. Replace the UUIDs below with the actual UUIDs from step 3
-- 5. Then run the INSERT statements below
-- ============================================================

-- UNCOMMENT AND UPDATE UUIDs AFTER CREATING AUTH USERS:

-- INSERT INTO users (id, email, full_name, role, branch_id) VALUES
--   ('<STAFF_AUTH_UUID>',
--    'staff@bookspa.com.np',
--    'Ramesh Thapa',
--    'staff',
--    'b0000000-0000-0000-0000-000000000001');

-- INSERT INTO users (id, email, full_name, role, branch_id) VALUES
--   ('<MANAGER_AUTH_UUID>',
--    'manager@bookspa.com.np',
--    'Rajesh Shrestha',
--    'manager',
--    'b0000000-0000-0000-0000-000000000001');

-- INSERT INTO users (id, email, full_name, role, branch_id) VALUES
--   ('<ADMIN_AUTH_UUID>',
--    'admin@bookspa.com.np',
--    'Sunil Maharjan',
--    'admin',
--    'b0000000-0000-0000-0000-000000000001');

-- ============================================================
-- SEED DATA COMPLETE
-- ============================================================
