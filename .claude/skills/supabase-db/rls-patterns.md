# BooX RLS Patterns

> Follow these established patterns when creating new RLS policies.

## Pattern 1: Public Read (anon + authenticated)

Used for: branches, rooms, services, therapists (data customers need to see).

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read <table>"
  ON <table> FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anonymous users can read <table>"
  ON <table> FOR SELECT
  TO anon
  USING (true);
```

## Pattern 2: Branch-Scoped Access

Used for: bookings (staff sees only their branch, admin sees all).

```sql
-- Read
CREATE POLICY "Staff can read branch <table>"
  ON <table> FOR SELECT
  TO authenticated
  USING (
    branch_id = get_user_branch_id()
    OR get_user_role() = 'admin'
  );

-- Insert
CREATE POLICY "Staff can create branch <table>"
  ON <table> FOR INSERT
  TO authenticated
  WITH CHECK (
    branch_id = get_user_branch_id()
    OR get_user_role() = 'admin'
  );

-- Update
CREATE POLICY "Staff can update branch <table>"
  ON <table> FOR UPDATE
  TO authenticated
  USING (
    branch_id = get_user_branch_id()
    OR get_user_role() = 'admin'
  )
  WITH CHECK (
    branch_id = get_user_branch_id()
    OR get_user_role() = 'admin'
  );
```

## Pattern 3: Own-Record Access

Used for: users (read own profile), attendance (own check-in/out).

```sql
CREATE POLICY "Users can read own <table>"
  ON <table> FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own <table>"
  ON <table> FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own <table>"
  ON <table> FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

## Pattern 4: Manager Escalation

Used for: users (managers see branch users), attendance (managers see branch records).

```sql
CREATE POLICY "Managers can read branch <table>"
  ON <table> FOR SELECT
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND (branch_id = get_user_branch_id() OR get_user_role() = 'admin')
  );
```

## Pattern 5: Cross-Table RLS (via EXISTS)

Used for: payments (access controlled via parent booking's branch).

```sql
CREATE POLICY "Staff can read branch payments"
  ON payments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = payments.booking_id
      AND (b.branch_id = get_user_branch_id() OR get_user_role() = 'admin')
    )
  );
```

## Pattern 6: Immutable Records

Used for: payments (INSERT only, no UPDATE or DELETE).

```sql
-- Only INSERT policy, deliberately NO UPDATE or DELETE policies
CREATE POLICY "Staff can record payments"
  ON payments FOR INSERT
  TO authenticated
  WITH CHECK (...);
-- NO UPDATE policy
-- NO DELETE policy
```

## Pattern 7: Anonymous Insert

Used for: bookings (customer booking flow creates bookings without auth).

```sql
CREATE POLICY "Anonymous users can create bookings"
  ON bookings FOR INSERT
  TO anon
  WITH CHECK (true);
```

## Helper Functions

Always use these instead of inline subqueries for role/branch checks:

```sql
get_user_role()      -- Returns user_role enum for auth.uid()
get_user_branch_id() -- Returns uuid branch_id for auth.uid()
```

## Naming Convention

Format: `"<Subject> can <action> <scope> <table>"`

Examples:
- `"Authenticated users can read branches"`
- `"Staff can read branch bookings"`
- `"Staff can create branch bookings"`
- `"Managers can read branch attendance"`
- `"Users can check in"`
- `"Anonymous users can create bookings"`
