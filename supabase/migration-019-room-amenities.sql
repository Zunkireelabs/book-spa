-- ============================================================
-- Migration 019: Add Amenities and Floor to Rooms
-- Allows tagging rooms with features (Bed, Chair, Jacuzzi, etc.)
-- and organizing them by floor
-- ============================================================

-- Add amenities column to rooms table
ALTER TABLE rooms
  ADD COLUMN amenities text[] DEFAULT '{}';

-- Add floor column to rooms table
ALTER TABLE rooms
  ADD COLUMN floor text;

-- Add comments for documentation
COMMENT ON COLUMN rooms.amenities IS 'List of features/amenities available in the room (e.g., 1 Bed, 3 Chair, 1 Jacuzzi & Shower)';
COMMENT ON COLUMN rooms.floor IS 'Floor where the room is located (e.g., Ground Floor, Nepali Floor, Thai Floor)';
