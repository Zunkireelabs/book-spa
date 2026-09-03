-- ============================================================
-- BooX Phase 1: Seed Data
-- Run this AFTER schema.sql and rls.sql
-- ============================================================

-- 1. BRANCHES: real branches from staging (org: nuad-thai-spa)
INSERT INTO branches (id, name, address, phone, org_id, open_time, close_time, timezone, online_booking_capacity) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'Lazimpat', 'Lazimpat Road, Kathmandu 44600, Nepal', '+977-1-4441234', '00000000-0000-0000-0000-000000000001', '09:00:00', '21:00:00', 'Asia/Kathmandu', 5),
  ('0cdcc3e7-9e86-45f7-a282-6062b729d1e6', 'Sanepa', 'Sanepa, Lalitpur, Nepal', NULL, '00000000-0000-0000-0000-000000000001', '09:00:00', '21:00:00', 'Asia/Kathmandu', 3),
  ('934b299e-5742-41ca-803f-3b15248fb5cf', 'Bhaisepati', 'Bhaisepati, Lalitpur, Nepal', NULL, '00000000-0000-0000-0000-000000000001', '09:00:00', '21:00:00', 'Asia/Kathmandu', 2),
  ('a6ba7d21-f361-4181-b880-caf2e40bc4a5', 'Thamel', 'Thamel, Kathmandu, Nepal', NULL, '00000000-0000-0000-0000-000000000001', '09:00:00', '21:00:00', 'Asia/Kathmandu', 3);

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

-- 4. THERAPISTS/STAFF: real staff from staging (org: nuad-thai-spa)
INSERT INTO therapists (id, branch_id, name, gender, specialties, org_id, display_order, position, is_service_staff, is_active) VALUES
  ('69abe71d-b190-40e4-90fb-04f70a8d0e27', '0cdcc3e7-9e86-45f7-a282-6062b729d1e6', 'SABINA GHATANI', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 1, 'Therapist/Beautician', true, true),
  ('ae3491a7-6ce0-4103-9457-cfe8c31b02d2', '0cdcc3e7-9e86-45f7-a282-6062b729d1e6', 'SUSHILA RAI', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 1, 'Manager', false, true),
  ('a5a7e31d-bdb1-4c7b-9f7b-99414786c2c4', '0cdcc3e7-9e86-45f7-a282-6062b729d1e6', 'KUSUM SHERPA', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 2, 'Therapist', true, true),
  ('b7d99af1-8525-4465-8f6f-16f4d79a60b0', '0cdcc3e7-9e86-45f7-a282-6062b729d1e6', 'NIRMALA BARAM', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 3, 'Therapist', true, true),
  ('729fa1b1-fe9c-4cde-9f2b-2770280ab83b', '0cdcc3e7-9e86-45f7-a282-6062b729d1e6', 'SNEHA PRIYAR', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 4, 'Therapist', true, true),
  ('c3473fdb-00c1-4713-97ac-ac913ea447db', '0cdcc3e7-9e86-45f7-a282-6062b729d1e6', 'SANGITA LAMICHHANE', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 5, 'Therapist/Beautician', true, true),
  ('067712d2-8a35-4633-a403-456cd27c8831', '0cdcc3e7-9e86-45f7-a282-6062b729d1e6', 'JITENDRA THAKUR', 'Male', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 6, 'Hairdresser', true, true),
  ('347519f5-1280-40e6-89bc-824ff2c4da19', '0cdcc3e7-9e86-45f7-a282-6062b729d1e6', 'GOMA', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 9, 'Housekeeping', false, true),
  ('34d3d600-abac-43e8-8648-58d7fcd237f1', '0cdcc3e7-9e86-45f7-a282-6062b729d1e6', 'RAHUL SHRESTHA', 'Male', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 10, 'Waiter', false, true),
  ('28e28922-7f42-42d0-b5db-58600ff8db2c', '0cdcc3e7-9e86-45f7-a282-6062b729d1e6', 'BIJAYA MAGAR', 'Male', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 11, 'Chef', false, true),
  ('4aa13d0a-6f09-4da5-a92c-25f76a7fe9f4', '0cdcc3e7-9e86-45f7-a282-6062b729d1e6', 'Poojan Nachhring Rai', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 12, 'Receptionist', false, true),
  ('7022c1fa-04b4-4c7e-b276-cec64645aa55', 'a6ba7d21-f361-4181-b880-caf2e40bc4a5', 'Aksa Rasaili Sunar', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 1, 'Therapist', true, true),
  ('5763b654-7d28-4927-ac64-00cdd994e979', 'a6ba7d21-f361-4181-b880-caf2e40bc4a5', 'Trisha Acharya', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 1, 'GRE', false, true),
  ('6b81b214-9300-4365-bb10-0dccbed4665b', 'a6ba7d21-f361-4181-b880-caf2e40bc4a5', 'Mandira Rai', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 2, 'Therapist', true, true),
  ('80309435-7d5e-4075-abcd-ac76ab3c9275', 'a6ba7d21-f361-4181-b880-caf2e40bc4a5', 'Devina Karki', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 2, 'Housekeeping', false, true),
  ('059babad-46fa-446c-a01c-126fb37ef5f0', 'a6ba7d21-f361-4181-b880-caf2e40bc4a5', 'Jasmine Shrestha', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 3, 'Therapist', true, true),
  ('e1eb0e64-eb9e-4881-9f5a-36da825a6aea', 'a6ba7d21-f361-4181-b880-caf2e40bc4a5', 'Puja Baral Rana', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 4, 'Therapist', true, true),
  ('8af35b07-58e5-4eff-9634-7a2c46240c30', 'a6ba7d21-f361-4181-b880-caf2e40bc4a5', 'Asmita Pariyar', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 5, 'Therapist', true, true),
  ('87f1d0c8-bd58-40a3-b1e1-aa4d30ac18b3', 'a6ba7d21-f361-4181-b880-caf2e40bc4a5', 'Nirmala Balami', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 6, 'Therapist', true, true),
  ('cc35a09c-251a-4a46-9242-a7f071c3aed4', 'a6ba7d21-f361-4181-b880-caf2e40bc4a5', 'NIMISHA RAI', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 7, 'Therapist', true, true),
  ('827c77fa-851d-4e55-8b94-7d2aae59cde3', 'a6ba7d21-f361-4181-b880-caf2e40bc4a5', 'ROSHAN RAI', 'Male', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 10, 'Facilitate Supervisor/Receptionist', false, true),
  ('8180121b-0090-4ac8-82ed-b88b275044e6', 'b0000000-0000-0000-0000-000000000001', 'SUMNIMA THARU', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 0, 'Intern/Receptionist', false, true),
  ('0ea89df4-7d3f-48fc-b59b-eeafb68d6d2e', 'b0000000-0000-0000-0000-000000000001', 'JEEVAN SHRESTHA', 'Male', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 0, 'Gardener', false, true),
  ('5f52b6f0-bb02-4f64-8d65-beae2154f117', 'b0000000-0000-0000-0000-000000000001', 'MANISHA THING', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 1, 'Therapist', true, true),
  ('fd9bbf42-a241-485a-9a92-d5207002b6f1', 'b0000000-0000-0000-0000-000000000001', 'ANKITA YONJAN', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 2, 'Hairdresser/Beautician', true, true),
  ('e75e3d6b-8669-4d16-bbb6-2fcab0bc290b', 'b0000000-0000-0000-0000-000000000001', 'ANKITA TAMANG', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 3, 'Therapist', true, true),
  ('b3d472be-de45-4bd6-a3f1-50e40fcd8b19', 'b0000000-0000-0000-0000-000000000001', 'APSARA KHATRI', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 4, 'Housekeeping', false, true),
  ('da8e19bc-93c9-4b2c-b9c6-2e0ba7a1e02f', 'b0000000-0000-0000-0000-000000000001', 'ANISHA THAKURI', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 4, 'Therapist', true, true),
  ('602c10df-40c3-480a-9aed-d09d8a7b5e37', 'b0000000-0000-0000-0000-000000000001', 'ASMITA PARIYAR', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 5, 'Therapist', true, true),
  ('a2377dac-1f17-43cc-bf6d-e7b2ba9e54b0', 'b0000000-0000-0000-0000-000000000001', 'ASHMI THING TAMANG', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 6, 'Therapist', true, true),
  ('0047b57c-a801-4f94-8730-0277b44f762c', 'b0000000-0000-0000-0000-000000000001', 'CHETAN SAUD', 'Male', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 7, 'Beautician/Pedicurist', true, true),
  ('7d1c45a4-9a20-435d-99bf-2d69705d7a42', 'b0000000-0000-0000-0000-000000000001', 'ADITYA JUNG RANA', 'Male', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 7, 'Manager', false, true),
  ('dd892f2b-a32f-4c86-b6bf-121c856ea7c8', 'b0000000-0000-0000-0000-000000000001', 'ANJITA KARKI DARJI', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 8, 'Therapist', true, true),
  ('c9a011f4-5651-4adf-a241-89430f178e11', 'b0000000-0000-0000-0000-000000000001', 'DEEPIKA TAMANG', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 9, 'Therapist', true, true),
  ('13173c37-9ad2-4349-a50f-33f7f9255ba5', 'b0000000-0000-0000-0000-000000000001', 'DOLMA LOPCHAN', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 10, 'Therapist', true, true),
  ('8312fa7a-0e29-4778-b170-c18e6c1a18cf', 'b0000000-0000-0000-0000-000000000001', 'DEVINA KARKI', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 10, 'Housekeeping', false, true),
  ('c0846e35-890a-4fe3-88c3-aa1b22ef39d8', 'b0000000-0000-0000-0000-000000000001', 'GANESH BISHUNKHE', 'Male', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 11, 'Hairdresser', true, true),
  ('09ad92d2-79e1-40ac-8f89-d46a9c78f485', 'b0000000-0000-0000-0000-000000000001', 'JASMINE SHRESTHA', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 12, 'Therapist', true, true),
  ('d2013be5-b44f-4abc-a721-4788d64039a5', 'b0000000-0000-0000-0000-000000000001', 'KALA BARAM', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 13, 'Therapist', true, true),
  ('bffd9990-7615-462a-868c-f35d7e259c86', 'b0000000-0000-0000-0000-000000000001', 'KAMALA TAMANG', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 14, 'Therapist', true, true),
  ('2d381425-e171-4d91-b096-d3bede0008f2', 'b0000000-0000-0000-0000-000000000001', 'KAMANA THING', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 15, 'Therapist', true, true),
  ('3a0dff36-cf4c-44b2-bb45-140b93acad8b', 'b0000000-0000-0000-0000-000000000001', 'MANDIRA RAI', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 16, 'Therapist', true, true),
  ('d8de75bc-45e3-40fa-9f16-c247e9631d00', 'b0000000-0000-0000-0000-000000000001', 'MANISHA TAMANG A', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 17, 'Therapist', true, true),
  ('57f368e3-3a00-42a4-80de-cadbbfced1ea', 'b0000000-0000-0000-0000-000000000001', 'MANISHA TAMANG B', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 18, 'Therapist', true, true),
  ('8908d845-508f-4cc7-b606-dfde02cd80e9', 'b0000000-0000-0000-0000-000000000001', 'MUSKAN SHRESTHA', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 19, 'Beautician', true, true),
  ('5abea27e-d5d1-4b22-babf-a125697f3234', 'b0000000-0000-0000-0000-000000000001', 'NILA RAI', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 20, 'Therapist', true, true),
  ('2750d381-9e91-4f54-a152-b4a93745d5a0', 'b0000000-0000-0000-0000-000000000001', 'MANJU POUDEL', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 20, 'Housekeeping', false, true),
  ('6b6e7b0e-e562-40dc-810e-fb1aa78f0db3', 'b0000000-0000-0000-0000-000000000001', 'NIRAJ BOGATI', 'Male', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 21, 'Therapist', true, true),
  ('643e973c-0e80-42dd-93d6-d56ff761f497', 'b0000000-0000-0000-0000-000000000001', 'PABITRA RAI', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 22, 'Therapist', true, true),
  ('dcb64a90-e8d9-45a4-9982-f9937ea6828e', 'b0000000-0000-0000-0000-000000000001', 'PUJA BARAL RANA', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 23, 'Therapist', true, true),
  ('e48a6f90-0cab-425d-958f-f8b341c7bc57', 'b0000000-0000-0000-0000-000000000001', 'PUJA TAMANG', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 24, 'Therapist', true, true),
  ('a6d9f05e-a561-41e1-a758-469661f0a2ef', 'b0000000-0000-0000-0000-000000000001', 'NISSA KUMARI MAGAR', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 24, 'Guest Relation Officer', false, true),
  ('bee9518f-39cc-4c97-8e7c-f3164200b5b6', 'b0000000-0000-0000-0000-000000000001', 'PUSHPA BARAM', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 25, 'Therapist', true, true),
  ('242d2e88-ce4a-4ad2-a7b4-5941ed98ba6e', 'b0000000-0000-0000-0000-000000000001', 'RABIN MAJHI', 'Male', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 26, 'Therapist', true, true),
  ('1e91a42e-21c5-47d9-8566-2bca8b942261', 'b0000000-0000-0000-0000-000000000001', 'SONI YAKHA', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 27, 'Therapist', true, true),
  ('84e1aca8-446d-4cad-a563-3164133fbf41', 'b0000000-0000-0000-0000-000000000001', 'SUMINA RAI', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 28, 'Therapist', true, true),
  ('3a8235ef-6d74-43f0-8e02-c5dacb403d60', 'b0000000-0000-0000-0000-000000000001', 'SUNITA THING', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 29, 'Therapist', true, true),
  ('3434b71d-d908-43fd-a31a-d1e5ff268224', 'b0000000-0000-0000-0000-000000000001', 'SUSHILA RAI', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 30, 'Therapist', true, true),
  ('d353f99d-45db-4243-af3c-0b97eeca1704', 'b0000000-0000-0000-0000-000000000001', 'TRISHA ACHARYA', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 31, 'Therapist', true, true),
  ('677e4728-75ec-4b8a-80ed-68b07d54fa36', 'b0000000-0000-0000-0000-000000000001', 'SANTOSH KHADKA', 'Male', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 31, 'Maintenance Head and Driver', false, true),
  ('54e18afb-60c8-4cb7-bc1b-facb871d2f90', 'b0000000-0000-0000-0000-000000000001', 'USHA TAMANG', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 32, 'Therapist', true, true),
  ('dcde9082-c1e4-44b0-96aa-f52e0d831336', 'b0000000-0000-0000-0000-000000000001', 'SIRMAYA GURUNG', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 32, 'Housekeeping', false, true),
  ('9aaf9234-83a6-4905-9c60-0ceaea168fbd', 'b0000000-0000-0000-0000-000000000001', 'YAMSARA ALE MAGAR', 'Female', ARRAY[]::text[], '00000000-0000-0000-0000-000000000001', 33, 'Therapist', true, true);

-- 5. ADMIN LOGIN (local dev only — PIN login needs the cloud-only pin-login Edge
--    Function, see supabase/LOCAL_DEV.md, so use email/password against
--    /nuad-thai-spa/login):
--      admin@local.test / LocalAdmin123
--    email matches the existing (previously undocumented, ad hoc) admin@local.test /
--    manager@local.test / staff@local.test convention some local DBs already have.
--    ON CONFLICT makes this idempotent against both a fresh bootstrap and one of
--    those pre-existing ad hoc rows (known password either way).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO auth.users (
  id, instance_id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  aud, role, created_at, updated_at,
  confirmation_token, recovery_token
) VALUES (
  'e0000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'admin@local.test',
  crypt('LocalAdmin123', gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"full_name": "Local Admin"}',
  'authenticated', 'authenticated', now(), now(),
  '', ''
)
ON CONFLICT (email) WHERE is_sso_user = false
DO UPDATE SET encrypted_password = EXCLUDED.encrypted_password, email_confirmed_at = EXCLUDED.email_confirmed_at;

INSERT INTO auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
SELECT
  u.id, u.id, 'admin@local.test', 'email',
  jsonb_build_object('sub', u.id::text, 'email', 'admin@local.test'),
  now(), now(), now()
FROM auth.users u WHERE u.email = 'admin@local.test'
ON CONFLICT (provider_id, provider) DO NOTHING;

INSERT INTO users (id, email, full_name, role, org_id, pin, is_active)
SELECT u.id, 'admin@local.test', 'Local Admin', 'admin', '00000000-0000-0000-0000-000000000001', '1111', true
FROM auth.users u WHERE u.email = 'admin@local.test'
ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, pin = EXCLUDED.pin, is_active = EXCLUDED.is_active;

-- SEED DATA COMPLETE