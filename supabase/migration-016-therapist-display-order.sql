-- Migration 016: Add display_order column to therapists
-- Enables drag-to-reorder on the Therapist Management panel

-- 1. Add the column
ALTER TABLE therapists
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

-- 2. Backfill existing rows: preserve current alphabetical order per branch
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY branch_id ORDER BY name) AS rn
  FROM therapists
)
UPDATE therapists t
SET display_order = n.rn
FROM numbered n
WHERE t.id = n.id;

-- 3. Composite index for efficient ordered queries
CREATE INDEX IF NOT EXISTS idx_therapists_branch_display_order
  ON therapists (branch_id, display_order);
