-- ============================================================
-- Migration 008: Allow anonymous users to create bookings
-- Fixes: RLS blocking customer booking flow
-- ============================================================

-- Drop any conflicting policies first
DROP POLICY IF EXISTS "Anonymous can create customers for booking" ON customers;
DROP POLICY IF EXISTS "Anonymous can create bookings" ON bookings;
DROP POLICY IF EXISTS "Public can create customers" ON customers;
DROP POLICY IF EXISTS "Public can create bookings" ON bookings;

-- Allow anonymous users to create customer records during booking
CREATE POLICY "anon_insert_customers"
  ON customers FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anonymous users to read customers (for lookup before insert)
CREATE POLICY "anon_select_customers"
  ON customers FOR SELECT
  TO anon
  USING (true);

-- Allow anonymous users to create bookings (public booking page)
CREATE POLICY "anon_insert_bookings"
  ON bookings FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anonymous users to read bookings (for overlap check)
CREATE POLICY "anon_select_bookings"
  ON bookings FOR SELECT
  TO anon
  USING (true);
