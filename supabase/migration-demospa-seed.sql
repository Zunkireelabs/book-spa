-- ============================================================
-- DemoSpa Tenant Seed Data
-- Purpose: Demo tenant for client pitches
-- Run this AFTER all migrations are applied
-- ============================================================

BEGIN;

-- ============================================================
-- STEP 1: Organization
-- ============================================================

INSERT INTO organizations (id, name, code, slug, owner_email, timezone, currency, industry_type, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'DemoSpa',
  'DMS',
  'demospa',
  'admin@demospa.com',
  'Asia/Kathmandu',
  'NPR',
  'spa',
  true
);

-- ============================================================
-- STEP 2: Branch — Thamel
-- ============================================================

INSERT INTO branches (id, name, address, phone, org_id, is_active, open_time, close_time)
VALUES (
  'b0000000-0000-0000-0000-000000000002',
  'Thamel',
  'Thamel Marg, Kathmandu 44600, Nepal',
  '+977-1-4567890',
  '00000000-0000-0000-0000-000000000002',
  true,
  '09:00',
  '21:00'
);

-- ============================================================
-- STEP 3: Rooms (8 rooms across floors)
-- ============================================================

INSERT INTO rooms (id, branch_id, name, floor, amenities) VALUES
  ('a0000000-0000-0000-0000-000000000101', 'b0000000-0000-0000-0000-000000000002', 'Reception',        'Ground Floor', ARRAY['2 Chair']),
  ('a0000000-0000-0000-0000-000000000102', 'b0000000-0000-0000-0000-000000000002', 'Relaxation Lounge', 'Ground Floor', ARRAY['3 Chair', '1 Foot Bath']),
  ('a0000000-0000-0000-0000-000000000103', 'b0000000-0000-0000-0000-000000000002', 'Serenity',          '1st Floor',    ARRAY['1 Bed']),
  ('a0000000-0000-0000-0000-000000000104', 'b0000000-0000-0000-0000-000000000002', 'Harmony',           '1st Floor',    ARRAY['1 Bed', '1 Shower']),
  ('a0000000-0000-0000-0000-000000000105', 'b0000000-0000-0000-0000-000000000002', 'Bliss',             '1st Floor',    ARRAY['2 Bed']),
  ('a0000000-0000-0000-0000-000000000106', 'b0000000-0000-0000-0000-000000000002', 'Zen Suite',         '2nd Floor',    ARRAY['2 Bed', '1 Jacuzzi']),
  ('a0000000-0000-0000-0000-000000000107', 'b0000000-0000-0000-0000-000000000002', 'Royal Suite',       '2nd Floor',    ARRAY['2 Bed', '1 Jacuzzi & Shower']),
  ('a0000000-0000-0000-0000-000000000108', 'b0000000-0000-0000-0000-000000000002', 'Panorama',          'Top Floor',    ARRAY['2 Bed', '1 Jacuzzi & Shower', 'City View']);

-- ============================================================
-- STEP 4: Services (8 services, org-scoped)
-- ============================================================

INSERT INTO services (id, name, duration_minutes, price_npr, description, org_id) VALUES
  ('c0000000-0000-0000-0000-000000000101', 'Deep Tissue Massage',     60, 2500.00, 'Therapeutic massage targeting deep muscle knots',     '00000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000102', 'Swedish Massage',         60, 2000.00, 'Classic full-body relaxation massage',                '00000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000103', 'Hot Stone Therapy',       90, 3500.00, 'Heated basalt stones for deep relaxation',            '00000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000104', 'Aromatherapy Massage',    75, 2800.00, 'Essential oil-infused therapeutic massage',            '00000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000105', 'Traditional Thai Massage',90, 3000.00, 'Ancient stretching and pressure point therapy',       '00000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000106', 'Couples Massage',         60, 4500.00, 'Side-by-side relaxation experience for two',          '00000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000107', 'Foot Reflexology',        45, 1800.00, 'Holistic pressure point therapy for feet',            '00000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000108', 'Facial Treatment',        60, 2200.00, 'Rejuvenating facial with natural ingredients',        '00000000-0000-0000-0000-000000000002');

-- ============================================================
-- STEP 5: Therapists (6 therapists)
-- ============================================================

INSERT INTO therapists (id, branch_id, name, gender, specialties) VALUES
  ('d0000000-0000-0000-0000-000000000101', 'b0000000-0000-0000-0000-000000000002', 'Priya Sharma',    'Female', ARRAY['Deep Tissue', 'Swedish']),
  ('d0000000-0000-0000-0000-000000000102', 'b0000000-0000-0000-0000-000000000002', 'Raj Patel',       'Male',   ARRAY['Sports', 'Deep Tissue']),
  ('d0000000-0000-0000-0000-000000000103', 'b0000000-0000-0000-0000-000000000002', 'Maya Tamang',     'Female', ARRAY['Aromatherapy', 'Hot Stone']),
  ('d0000000-0000-0000-0000-000000000104', 'b0000000-0000-0000-0000-000000000002', 'Bikash Rai',      'Male',   ARRAY['Thai', 'Reflexology']),
  ('d0000000-0000-0000-0000-000000000105', 'b0000000-0000-0000-0000-000000000002', 'Sunita Karki',    'Female', ARRAY['Facial', 'Aromatherapy']),
  ('d0000000-0000-0000-0000-000000000106', 'b0000000-0000-0000-0000-000000000002', 'Arun Shrestha',   'Male',   ARRAY['Swedish', 'Sports']);

-- ============================================================
-- STEP 6: Auth Users + Public Users
-- Credentials:
--   Admin:   admin@demospa.com   / Demo@Admin123   / PIN: 1111
--   Manager: manager@demospa.com / Demo@Manager123 / PIN: 2222
--   Staff:   staff@demospa.com   / Demo@Staff123   / PIN: 3333
-- ============================================================

-- Enable pgcrypto for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 6a. Insert into auth.users
INSERT INTO auth.users (
  id, instance_id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  aud, role, created_at, updated_at,
  confirmation_token, recovery_token
) VALUES
  -- Admin
  (
    'e0000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000000',
    'admin@demospa.com',
    crypt('Demo@Admin123', gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}',
    '{"full_name": "Demo Admin"}',
    'authenticated', 'authenticated', now(), now(),
    '', ''
  ),
  -- Manager
  (
    'e0000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000000',
    'manager@demospa.com',
    crypt('Demo@Manager123', gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}',
    '{"full_name": "Demo Manager"}',
    'authenticated', 'authenticated', now(), now(),
    '', ''
  ),
  -- Staff
  (
    'e0000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000000',
    'staff@demospa.com',
    crypt('Demo@Staff123', gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}',
    '{"full_name": "Demo Staff"}',
    'authenticated', 'authenticated', now(), now(),
    '', ''
  );

-- 6b. Insert into auth.identities (required by Supabase Auth)
INSERT INTO auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
) VALUES
  (
    'e0000000-0000-0000-0000-000000000101',
    'e0000000-0000-0000-0000-000000000101',
    'admin@demospa.com',
    'email',
    '{"sub": "e0000000-0000-0000-0000-000000000101", "email": "admin@demospa.com"}',
    now(), now(), now()
  ),
  (
    'e0000000-0000-0000-0000-000000000102',
    'e0000000-0000-0000-0000-000000000102',
    'manager@demospa.com',
    'email',
    '{"sub": "e0000000-0000-0000-0000-000000000102", "email": "manager@demospa.com"}',
    now(), now(), now()
  ),
  (
    'e0000000-0000-0000-0000-000000000103',
    'e0000000-0000-0000-0000-000000000103',
    'staff@demospa.com',
    'email',
    '{"sub": "e0000000-0000-0000-0000-000000000103", "email": "staff@demospa.com"}',
    now(), now(), now()
  );

-- 6c. Insert into public.users
INSERT INTO users (id, email, full_name, role, branch_id, org_id, pin, is_active) VALUES
  ('e0000000-0000-0000-0000-000000000101', 'admin@demospa.com',   'Demo Admin',   'admin',   'b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '1111', true),
  ('e0000000-0000-0000-0000-000000000102', 'manager@demospa.com', 'Demo Manager', 'manager', 'b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '2222', true),
  ('e0000000-0000-0000-0000-000000000103', 'staff@demospa.com',   'Demo Staff',   'staff',   'b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '3333', true);

-- ============================================================
-- STEP 7: Demo Customers (5 CRM entries)
-- ============================================================

INSERT INTO customers (id, branch_id, full_name, phone, email) VALUES
  ('f0000000-0000-0000-0000-000000000101', 'b0000000-0000-0000-0000-000000000002', 'Aarav Sharma',     '+977-9841000001', 'aarav@example.com'),
  ('f0000000-0000-0000-0000-000000000102', 'b0000000-0000-0000-0000-000000000002', 'Sanya Joshi',      '+977-9841000002', 'sanya@example.com'),
  ('f0000000-0000-0000-0000-000000000103', 'b0000000-0000-0000-0000-000000000002', 'Rohan Thapa',      '+977-9841000003', 'rohan@example.com'),
  ('f0000000-0000-0000-0000-000000000104', 'b0000000-0000-0000-0000-000000000002', 'Nisha Gurung',     '+977-9841000004', 'nisha@example.com'),
  ('f0000000-0000-0000-0000-000000000105', 'b0000000-0000-0000-0000-000000000002', 'Kiran Maharjan',   '+977-9841000005', 'kiran@example.com');

-- ============================================================
-- STEP 8: Demo Bookings (12 bookings across statuses)
-- Uses CURRENT_DATE for relative date positioning
-- Triggers auto-compute: end_time, start_datetime, end_datetime, final_amount
-- ============================================================

-- --- 3x COMPLETED (yesterday, with payments) ---

INSERT INTO bookings (
  id, booking_number, branch_id, room_id, service_id, therapist_id,
  customer_name, customer_email, customer_phone, customer_gender, customer_id,
  date, start_time,
  status, payment_status, base_amount, discount_amount,
  service_name_snapshot, service_duration_snapshot, service_price_snapshot,
  therapist_name_snapshot, room_name_snapshot,
  created_by
) VALUES
  (
    'bb000000-0000-0000-0000-000000000001',
    'DMS-0001',
    'b0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000103', -- Serenity
    'c0000000-0000-0000-0000-000000000101', -- Deep Tissue
    'd0000000-0000-0000-0000-000000000101', -- Priya
    'Aarav Sharma', 'aarav@example.com', '+977-9841000001', 'Male',
    'f0000000-0000-0000-0000-000000000101',
    CURRENT_DATE - 1, '10:00',
    'Completed', 'paid', 2500.00, 0.00,
    'Deep Tissue Massage', 60, 2500.00,
    'Priya Sharma', 'Serenity',
    'e0000000-0000-0000-0000-000000000103'
  ),
  (
    'bb000000-0000-0000-0000-000000000002',
    'DMS-0002',
    'b0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000104', -- Harmony
    'c0000000-0000-0000-0000-000000000103', -- Hot Stone
    'd0000000-0000-0000-0000-000000000103', -- Maya
    'Sanya Joshi', 'sanya@example.com', '+977-9841000002', 'Female',
    'f0000000-0000-0000-0000-000000000102',
    CURRENT_DATE - 1, '11:00',
    'Completed', 'paid', 3500.00, 500.00,
    'Hot Stone Therapy', 90, 3500.00,
    'Maya Tamang', 'Harmony',
    'e0000000-0000-0000-0000-000000000103'
  ),
  (
    'bb000000-0000-0000-0000-000000000003',
    'DMS-0003',
    'b0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000106', -- Zen Suite
    'c0000000-0000-0000-0000-000000000106', -- Couples
    'd0000000-0000-0000-0000-000000000102', -- Raj
    'Rohan Thapa', 'rohan@example.com', '+977-9841000003', 'Male',
    'f0000000-0000-0000-0000-000000000103',
    CURRENT_DATE - 1, '14:00',
    'Completed', 'paid', 4500.00, 0.00,
    'Couples Massage', 60, 4500.00,
    'Raj Patel', 'Zen Suite',
    'e0000000-0000-0000-0000-000000000103'
  ),

-- --- 2x IN-PROGRESS (today, morning slots) ---

  (
    'bb000000-0000-0000-0000-000000000004',
    'DMS-0004',
    'b0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000105', -- Bliss
    'c0000000-0000-0000-0000-000000000104', -- Aromatherapy
    'd0000000-0000-0000-0000-000000000105', -- Sunita
    'Nisha Gurung', 'nisha@example.com', '+977-9841000004', 'Female',
    'f0000000-0000-0000-0000-000000000104',
    CURRENT_DATE, '09:00',
    'In-Progress', 'unpaid', 2800.00, 0.00,
    'Aromatherapy Massage', 75, 2800.00,
    'Sunita Karki', 'Bliss',
    'e0000000-0000-0000-0000-000000000103'
  ),
  (
    'bb000000-0000-0000-0000-000000000005',
    'DMS-0005',
    'b0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000107', -- Royal Suite
    'c0000000-0000-0000-0000-000000000105', -- Thai
    'd0000000-0000-0000-0000-000000000104', -- Bikash
    'Kiran Maharjan', 'kiran@example.com', '+977-9841000005', 'Male',
    'f0000000-0000-0000-0000-000000000105',
    CURRENT_DATE, '09:30',
    'In-Progress', 'unpaid', 3000.00, 0.00,
    'Traditional Thai Massage', 90, 3000.00,
    'Bikash Rai', 'Royal Suite',
    'e0000000-0000-0000-0000-000000000103'
  ),

-- --- 3x CONFIRMED (today afternoon + tomorrow) ---

  (
    'bb000000-0000-0000-0000-000000000006',
    'DMS-0006',
    'b0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000103', -- Serenity
    'c0000000-0000-0000-0000-000000000102', -- Swedish
    'd0000000-0000-0000-0000-000000000106', -- Arun
    'Aarav Sharma', 'aarav@example.com', '+977-9841000001', 'Male',
    'f0000000-0000-0000-0000-000000000101',
    CURRENT_DATE, '14:00',
    'Confirmed', 'unpaid', 2000.00, 0.00,
    'Swedish Massage', 60, 2000.00,
    'Arun Shrestha', 'Serenity',
    'e0000000-0000-0000-0000-000000000103'
  ),
  (
    'bb000000-0000-0000-0000-000000000007',
    'DMS-0007',
    'b0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000108', -- Panorama
    'c0000000-0000-0000-0000-000000000103', -- Hot Stone
    'd0000000-0000-0000-0000-000000000101', -- Priya
    'Sanya Joshi', 'sanya@example.com', '+977-9841000002', 'Female',
    'f0000000-0000-0000-0000-000000000102',
    CURRENT_DATE, '15:00',
    'Confirmed', 'unpaid', 3500.00, 0.00,
    'Hot Stone Therapy', 90, 3500.00,
    'Priya Sharma', 'Panorama',
    'e0000000-0000-0000-0000-000000000103'
  ),
  (
    'bb000000-0000-0000-0000-000000000008',
    'DMS-0008',
    'b0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000104', -- Harmony
    'c0000000-0000-0000-0000-000000000108', -- Facial
    'd0000000-0000-0000-0000-000000000105', -- Sunita
    'Nisha Gurung', 'nisha@example.com', '+977-9841000004', 'Female',
    'f0000000-0000-0000-0000-000000000104',
    CURRENT_DATE + 1, '10:00',
    'Confirmed', 'unpaid', 2200.00, 0.00,
    'Facial Treatment', 60, 2200.00,
    'Sunita Karki', 'Harmony',
    'e0000000-0000-0000-0000-000000000103'
  ),

-- --- 2x PENDING (upcoming days) ---

  (
    'bb000000-0000-0000-0000-000000000009',
    'DMS-0009',
    'b0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000106', -- Zen Suite
    'c0000000-0000-0000-0000-000000000106', -- Couples
    'd0000000-0000-0000-0000-000000000102', -- Raj
    'Rohan Thapa', 'rohan@example.com', '+977-9841000003', 'Male',
    'f0000000-0000-0000-0000-000000000103',
    CURRENT_DATE + 2, '11:00',
    'Pending', 'unpaid', 4500.00, 0.00,
    'Couples Massage', 60, 4500.00,
    'Raj Patel', 'Zen Suite',
    'e0000000-0000-0000-0000-000000000103'
  ),
  (
    'bb000000-0000-0000-0000-000000000010',
    'DMS-0010',
    'b0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000102', -- Relaxation Lounge
    'c0000000-0000-0000-0000-000000000107', -- Foot Reflexology
    'd0000000-0000-0000-0000-000000000104', -- Bikash
    'Kiran Maharjan', 'kiran@example.com', '+977-9841000005', 'Male',
    'f0000000-0000-0000-0000-000000000105',
    CURRENT_DATE + 3, '13:00',
    'Pending', 'unpaid', 1800.00, 0.00,
    'Foot Reflexology', 45, 1800.00,
    'Bikash Rai', 'Relaxation Lounge',
    'e0000000-0000-0000-0000-000000000103'
  ),

-- --- 1x CANCELLED ---

  (
    'bb000000-0000-0000-0000-000000000011',
    'DMS-0011',
    'b0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000105', -- Bliss
    'c0000000-0000-0000-0000-000000000101', -- Deep Tissue
    'd0000000-0000-0000-0000-000000000106', -- Arun
    'Aarav Sharma', 'aarav@example.com', '+977-9841000001', 'Male',
    'f0000000-0000-0000-0000-000000000101',
    CURRENT_DATE - 2, '16:00',
    'Cancelled', 'unpaid', 2500.00, 0.00,
    'Deep Tissue Massage', 60, 2500.00,
    'Arun Shrestha', 'Bliss',
    'e0000000-0000-0000-0000-000000000103'
  ),

-- --- 1x NO SHOW ---

  (
    'bb000000-0000-0000-0000-000000000012',
    'DMS-0012',
    'b0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000101', -- Reception
    'c0000000-0000-0000-0000-000000000107', -- Foot Reflexology
    'd0000000-0000-0000-0000-000000000103', -- Maya
    'Sanya Joshi', 'sanya@example.com', '+977-9841000002', 'Female',
    'f0000000-0000-0000-0000-000000000102',
    CURRENT_DATE - 2, '11:00',
    'No Show', 'unpaid', 1800.00, 0.00,
    'Foot Reflexology', 45, 1800.00,
    'Maya Tamang', 'Reception',
    'e0000000-0000-0000-0000-000000000103'
  );

-- ============================================================
-- STEP 9: Booking-Therapist Junction Records
-- ============================================================

INSERT INTO booking_therapists (booking_id, therapist_id, start_time, end_time) VALUES
  ('bb000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000101', '10:00', '11:00'),
  ('bb000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000103', '11:00', '12:30'),
  ('bb000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000102', '14:00', '15:00'),
  ('bb000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000105', '09:00', '10:15'),
  ('bb000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000104', '09:30', '11:00'),
  ('bb000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000106', '14:00', '15:00'),
  ('bb000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000101', '15:00', '16:30'),
  ('bb000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000105', '10:00', '11:00'),
  ('bb000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000102', '11:00', '12:00'),
  ('bb000000-0000-0000-0000-000000000010', 'd0000000-0000-0000-0000-000000000104', '13:00', '13:45'),
  ('bb000000-0000-0000-0000-000000000011', 'd0000000-0000-0000-0000-000000000106', '16:00', '17:00'),
  ('bb000000-0000-0000-0000-000000000012', 'd0000000-0000-0000-0000-000000000103', '11:00', '11:45');

-- ============================================================
-- STEP 10: Payments for Completed Bookings
-- ============================================================

INSERT INTO payments (booking_id, amount, payment_mode, recorded_by, notes) VALUES
  ('bb000000-0000-0000-0000-000000000001', 2500.00, 'Cash',    'e0000000-0000-0000-0000-000000000103', 'Full payment received'),
  ('bb000000-0000-0000-0000-000000000002', 3000.00, 'Fonepay', 'e0000000-0000-0000-0000-000000000103', 'Paid after 500 NPR discount'),
  ('bb000000-0000-0000-0000-000000000003', 4500.00, 'Nabil',   'e0000000-0000-0000-0000-000000000103', 'Card payment');

COMMIT;

-- ============================================================
-- DEMOSPA SEED COMPLETE
--
-- Login Credentials:
-- ┌──────────┬─────────────────────────┬─────────────────────┬──────┐
-- │ Role     │ Email                   │ Password            │ PIN  │
-- ├──────────┼─────────────────────────┼─────────────────────┼──────┤
-- │ Admin    │ admin@demospa.com       │ Demo@Admin123       │ 1111 │
-- │ Manager  │ manager@demospa.com     │ Demo@Manager123     │ 2222 │
-- │ Staff    │ staff@demospa.com       │ Demo@Staff123       │ 3333 │
-- └──────────┴─────────────────────────┴─────────────────────┴──────┘
--
-- Access URL: /demospa/login
-- ============================================================
