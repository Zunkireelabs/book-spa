-- ============================================================
-- Migration 007: Add DELETE policy for rooms table
-- Manager and Admin can delete rooms (branch enforcement in API)
-- API layer enforces: no bookings exist for the room
-- ============================================================

-- ============================================================
-- ROOMS: Manager/Admin can DELETE (booking check enforced in API)
-- ============================================================

CREATE POLICY "Manager and admin can delete rooms"
  ON rooms FOR DELETE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
  );

-- ============================================================
-- Helper function: Check if a room can be deleted (has no bookings)
-- Returns true if room has zero bookings, false otherwise
-- ============================================================

CREATE OR REPLACE FUNCTION can_delete_room(p_room_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM bookings WHERE room_id = p_room_id LIMIT 1
  );
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION can_delete_room(uuid) TO authenticated;
