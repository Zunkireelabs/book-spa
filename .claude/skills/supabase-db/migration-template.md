# Migration Template

> Use this template when writing migrations via `mcp__supabase__apply_migration`.

## Standard Migration Structure

```sql
-- ============================================================
-- Migration: <descriptive_name>
-- Purpose: <what this migration does and why>
-- ============================================================

-- Step 1: <description>
<SQL statement>;

-- Step 2: <description>
<SQL statement>;

-- Rollback (manual, if needed):
-- DROP TABLE IF EXISTS <table>;
-- ALTER TABLE <table> DROP COLUMN IF EXISTS <column>;
```

## Examples

### New Table
```sql
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  title text NOT NULL,
  message text NOT NULL,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS immediately
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users read own notifications
CREATE POLICY "Users can read own notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
```

### Add Column
```sql
ALTER TABLE therapists
  ADD COLUMN phone text,
  ADD COLUMN email text;
```

### New Index
```sql
CREATE INDEX idx_bookings_therapist_date
  ON bookings(therapist_id, date)
  WHERE status != 'Cancelled';
```

### New Function + Trigger
```sql
CREATE OR REPLACE FUNCTION <function_name>()
RETURNS TRIGGER AS $$
BEGIN
  -- Logic here
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_<name>
  BEFORE INSERT OR UPDATE ON <table>
  FOR EACH ROW
  EXECUTE FUNCTION <function_name>();
```

## Checklist Before Applying

- [ ] Does the migration name use snake_case?
- [ ] Are all FK references to existing tables?
- [ ] Is RLS enabled on new tables?
- [ ] Are appropriate RLS policies created?
- [ ] Are indexes created for columns used in WHERE/JOIN?
- [ ] Are triggers needed for computed fields?
- [ ] Is there a rollback comment?
- [ ] Will this break existing data or constraints?
