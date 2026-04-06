-- ============================================================
-- Migration 011: Organization RLS Helper Function
-- ============================================================

-- Get current user's organization ID
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT org_id FROM users WHERE id = auth.uid();
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_user_org_id() TO authenticated;
