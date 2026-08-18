-- ============================================================
-- Migration 008: Add DELETE policies for therapists and services
-- Therapists: Manager/Admin can delete (branch enforcement in API)
-- Services: Admin only can delete (global, no branch scope)
-- API layer enforces: no bookings exist for the entity
-- ============================================================

-- ============================================================
-- THERAPISTS: Manager/Admin can DELETE (booking check in API)
-- ============================================================

CREATE POLICY "Manager and admin can delete therapists"
  ON therapists FOR DELETE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
  );

-- ============================================================
-- SERVICES: Admin only can DELETE (booking check in API)
-- ============================================================

CREATE POLICY "Admin can delete services"
  ON services FOR DELETE
  TO authenticated
  USING (
    get_user_role() = 'admin'
  );

-- ============================================================
-- Helper function: Check if a therapist can be deleted
-- Returns true if therapist has zero bookings, false otherwise
-- ============================================================

CREATE OR REPLACE FUNCTION can_delete_therapist(p_therapist_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM bookings WHERE therapist_id = p_therapist_id LIMIT 1
  );
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION can_delete_therapist(uuid) TO authenticated;

-- ============================================================
-- Helper function: Check if a service can be deleted
-- Returns true if service has zero bookings, false otherwise
-- ============================================================

CREATE OR REPLACE FUNCTION can_delete_service(p_service_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM bookings WHERE service_id = p_service_id LIMIT 1
  );
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION can_delete_service(uuid) TO authenticated;
