-- Migration 017: Add display_order column to rooms
-- Enables drag-to-reorder on room columns in calendar view

-- 1. Add the column
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

-- 2. Backfill existing rows: preserve current alphabetical order per branch
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY branch_id ORDER BY name) AS rn
  FROM rooms
)
UPDATE rooms r
SET display_order = n.rn
FROM numbered n
WHERE r.id = n.id;

-- 3. Composite index for efficient ordered queries
CREATE INDEX IF NOT EXISTS idx_rooms_branch_display_order
  ON rooms (branch_id, display_order);
