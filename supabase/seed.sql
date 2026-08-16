-- ============================================================
-- BooX Phase 1: Seed Data
-- Run this AFTER schema.sql and rls.sql
-- ============================================================

-- 1. BRANCH: Lazimpat
INSERT INTO branches (id, name, address, phone, org_id) VALUES
  ('b0000000-0000-0000-0000-000000000001',
   'Lazimpat',
   'Lazimpat Road, Kathmandu 44600, Nepal',
   '+977-1-4441234',
   '00000000-0000-0000-0000-000000000001');

-- 2. ROOMS: 14 rooms for Lazimpat with Amenities and Floors
INSERT INTO rooms (id, branch_id, name, floor, amenities) VALUES
  -- Ground Floor
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Salon',        'Ground Floor', ARRAY['3 Chair']),
  -- Nepali Floor
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'Foot Massage',  'Nepali Floor', ARRAY['3 Chair']),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'Kathmandu',     'Nepali Floor', ARRAY['1 Bed']),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'Pokhara',       'Nepali Floor', ARRAY['2 Bed']),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 'Lumbini',       'Nepali Floor', ARRAY['2 Bed']),
  -- Thai Floor
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000001', 'Facial Room',   'Thai Floor',   ARRAY['1 Bed']),
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000001', 'Bankok',        'Thai Floor',   ARRAY['1 Bed']),
  ('a0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000001', 'Phuket',        'Thai Floor',   ARRAY['1 Bed']),
  ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000001', 'Huahin',        'Thai Floor',   ARRAY['1 Bed']),
  ('a0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000001', 'Chaingmai',     'Thai Floor',   ARRAY['2 Bed']),
  -- VIP Floor
  ('a0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000001', 'Oxford',        'VIP Floor',    ARRAY['2 Bed', '1 Jacuzzi & Shower']),
  ('a0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000001', 'London',        'VIP Floor',    ARRAY['2 Bed', '1 Jacuzzi & Shower']),
  -- Top Floor
  ('a0000000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-000000000001', 'Pedicure',      'Top Floor',    ARRAY['3 Chair']);

-- 3. SERVICES: 8 services
INSERT INTO services (id, name, duration_minutes, price_npr, description, org_id) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'Deep Tissue Massage', 60, 2500.00, 'Therapeutic massage targeting knots', '00000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000002', 'Swedish Massage', 60, 2000.00, 'Classic relaxation massage', '00000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000003', 'Hot Stone Therapy', 90, 3500.00, 'Heated basalt stones relaxation', '00000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000004', 'Aromatherapy Massage', 75, 2800.00, 'Essential oil-infused massage', '00000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000005', 'Traditional Thai Massage', 90, 3000.00, 'Ancient stretching art', '00000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000006', 'Couples Massage', 60, 4500.00, 'Side-by-side experience', '00000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000007', 'Prenatal Massage', 60, 2800.00, 'Gentle expectant mother massage', '00000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000008', 'Foot Reflexology', 45, 1800.00, 'Holistic pressure point therapy', '00000000-0000-0000-0000-000000000001');

-- 4. THERAPISTS: 6 therapists
INSERT INTO therapists (id, branch_id, name, gender, specialties, org_id) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Emma Wilson', 'Female', ARRAY['Deep Tissue', 'Swedish'], '00000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'David Kim', 'Male', ARRAY['Sports', 'Deep Tissue'], '00000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'Lisa Rodriguez', 'Female', ARRAY['Aromatherapy', 'Hot Stone'], '00000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'Anjali Thapa', 'Female', ARRAY['Reflexology', 'Thai'], '00000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 'Michael Chen', 'Male', ARRAY['Swedish', 'Sports'], '00000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000001', 'Sita Gurung', 'Female', ARRAY['Traditional Thai', 'Aromatherapy'], '00000000-0000-0000-0000-000000000001');

-- SEED DATA COMPLETE