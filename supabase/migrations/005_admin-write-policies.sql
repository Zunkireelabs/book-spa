-- ============================================================
-- Migration 005: Add INSERT/UPDATE policies for services, rooms, therapists
-- These tables only had SELECT policies, blocking admin/manager writes via RLS
-- Uses existing get_user_role() function from rls.sql
-- ============================================================

-- ============================================================
-- SERVICES: Admin can INSERT and UPDATE
-- ============================================================

CREATE POLICY "Admin can create services"
  ON services FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() = 'admin'
  );

CREATE POLICY "Admin can update services"
  ON services FOR UPDATE
  TO authenticated
  USING (
    get_user_role() = 'admin'
  )
  WITH CHECK (
    get_user_role() = 'admin'
  );

-- ============================================================
-- ROOMS: Manager/Admin can INSERT and UPDATE (branch enforced in API)
-- ============================================================

CREATE POLICY "Manager and admin can create rooms"
  ON rooms FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
  );

CREATE POLICY "Manager and admin can update rooms"
  ON rooms FOR UPDATE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
  )
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
  );

-- ============================================================
-- THERAPISTS: Manager/Admin can INSERT and UPDATE (branch enforced in API)
-- ============================================================

CREATE POLICY "Manager and admin can create therapists"
  ON therapists FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
  );

CREATE POLICY "Manager and admin can update therapists"
  ON therapists FOR UPDATE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
  )
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
  );
