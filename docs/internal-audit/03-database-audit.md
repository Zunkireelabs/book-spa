# Database & RLS Audit

**Date:** 2026-03-08

---

## CRITICAL Issues

### 1. Schema-Code Drift — Missing Tables

**File:** `supabase/schema.sql` vs `src/services/api.js`
**Severity:** Critical

The api.js queries three tables not in `schema.sql`:
- `customers` (lines 2042, 2119, 2275)
- `audit_logs` (line 1971)
- `therapist_attendance` (lines 1087, 2665, 2757, 2769, 2825, 2927)

These were likely created via Supabase dashboard/MCP but are not in version control. A fresh deployment using these files will fail.

**Recommended Fix:** Add `CREATE TABLE` statements for all three tables to schema.sql or create migration files.

---

### 2. Schema-Code Drift — Missing Columns

**File:** `supabase/schema.sql` (bookings table) vs `src/services/api.js`
**Severity:** Critical

api.js references columns not in schema.sql:
- `service_name_snapshot` (line 667)
- `service_duration_snapshot` (line 668)
- `service_price_snapshot` (line 668)
- `therapist_name_snapshot` (line 669, 338)
- `room_name_snapshot` (line 669, 339)
- `customer_id` (line 2057, 2140, 2281)
- `branches.open_time`, `branches.close_time`, `branches.timezone` (lines 1063-1065)

**Recommended Fix:** Add these columns to respective CREATE TABLE statements.

---

### 3. Missing RLS for Undocumented Tables

**File:** `supabase/rls.sql`
**Severity:** Critical

No RLS policies for `customers`, `audit_logs`, or `therapist_attendance`. If RLS is disabled on these tables, any authenticated user can read/write all rows.

**Recommended Fix:** Add RLS policies following branch-scoping pattern.

---

## HIGH Issues

### 4. Booking Number Generation Race Condition

**File:** `supabase/schema.sql:234`
**Severity:** High

`generate_booking_number()` uses `COUNT(*) + 1` to derive sequence. Under concurrent inserts for same date, two transactions can read same count, producing duplicate booking numbers. The UNIQUE constraint will reject one.

**Business Impact:** User-facing booking creation failure under concurrent use.

**Recommended Fix:** Use `pg_advisory_xact_lock(hashtext('booking_number_' || NEW.date::text))` or a sequence table.

---

### 5. GIST Exclusion Does Not Cover "No Show"

**File:** `supabase/schema.sql:151-161`
**Severity:** High

Exclusion only filters `status != 'Cancelled'`. No Show bookings still block resources.

**Recommended Fix:** `WHERE (status NOT IN ('Cancelled', 'No Show'))`.

---

### 6. Anonymous Users Can Insert Bookings Without Restrictions

**File:** `supabase/rls.sql:134-137`
**Severity:** High

Policy `"Anonymous users can create bookings"` uses `WITH CHECK (true)`. Any anonymous request can insert a booking for any branch.

**Business Impact:** Spam bookings could fill room slots, causing denial of service.

**Recommended Fix:** Add rate limiting at edge or move through a Supabase Edge Function with validation.

---

### 7. No RLS Policies for INSERT/UPDATE/DELETE on Reference Tables

**File:** `supabase/rls.sql:24-79`
**Severity:** High

Tables `branches`, `rooms`, `services`, `therapists` only have SELECT policies. No INSERT, UPDATE, or DELETE policies. CRUD operations in api.js will be blocked by RLS (default deny) unless RLS was disabled via dashboard.

**Recommended Fix:** Add explicit INSERT/UPDATE policies restricted to `manager`/`admin` roles.

---

### 8. No Migration Files — Single Monolithic Schema

**File:** `supabase/schema.sql`, `supabase/rls.sql`
**Severity:** High

Entire schema in single file with no migration history. Not idempotent (`CREATE TABLE` without `IF NOT EXISTS`). Can't track incremental changes. Schema drift proves this is already a problem.

**Recommended Fix:** Adopt Supabase migration workflow. Export current production schema as baseline migration.

---

### 9. Search Query Pattern Injection

**File:** `src/services/api.js:1242-1244`
**Severity:** High

User input directly in `.or()` filter string. Special PostgREST characters could break filter or cause unexpected behavior.

**Recommended Fix:** Sanitize or use individual `.ilike()` calls.

---

### 10. assignTherapist Writes Non-Existent Snapshot Columns

**File:** `src/services/api.js:336-340`
**Severity:** High

Writes to `therapist_name_snapshot` and `room_name_snapshot` which don't exist in schema.sql. Every assignment may fail if columns missing.

---

### 11. Immutability Trigger vs Payment Trigger Ordering

**File:** `supabase/schema.sql:336-368` and `317-333`
**Severity:** High

The immutability trigger blocks changes to Completed bookings, but intentionally excludes `payment_status`. This is correct but fragile — if someone adds `payment_status` to the immutability check, payments on completed bookings break.

**Recommended Fix:** Add a comment explicitly noting `payment_status` and `is_locked` are intentionally excluded.

---

## MEDIUM Issues

### 12. No Index on bookings.therapist_id

**File:** `supabase/schema.sql:210-218`
**Severity:** Medium

Multiple queries filter by `therapist_id` but no B-tree index exists.

**Recommended Fix:** `CREATE INDEX idx_bookings_therapist ON bookings(therapist_id);`

---

### 13. No Index on bookings.payment_status

**File:** `supabase/schema.sql:210-218`
**Severity:** Medium

Revenue queries filter by `payment_status = 'paid'` with no index.

**Recommended Fix:** `CREATE INDEX idx_bookings_payment_status ON bookings(payment_status);` or composite `(branch_id, date, payment_status)`.

---

### 14. No UNIQUE Constraint on rooms(branch_id, name)

**File:** `supabase/schema.sql:53-59`
**Severity:** Medium

Application-level duplicate check exists but no DB constraint. Concurrent requests could create duplicates.

**Recommended Fix:** `CREATE UNIQUE INDEX uq_rooms_branch_name ON rooms(branch_id, lower(name));`

---

### 15. TOCTOU Race in recordPayment and updateBookingStatus

**File:** `src/services/api.js:177-237` and `239-282`
**Severity:** Medium

Fetch-validate-mutate pattern without optimistic locking. Two concurrent requests could both pass validation.

**Recommended Fix:** Add `WHERE status = :expectedOldStatus` to UPDATE statement.

---

### 16. closeDay Is Not Atomic

**File:** `src/services/api.js:542-630`
**Severity:** Medium

Report inserts, then locks bookings. If lock fails, inconsistent state.

**Recommended Fix:** Wrap in RPC function with single transaction.

---

### 17. Staff Can Read ALL Branch Bookings

**File:** `supabase/rls.sql:116-122`
**Severity:** Medium

SELECT grants access to all bookings in branch. Intentional for spa operations but worth documenting.

---

### 18. daily_reports SELECT Not Restricted to Manager/Admin

**File:** `supabase/rls.sql:230-236`
**Severity:** Medium

Staff can view daily closing reports and revenue figures.

**Recommended Fix:** Add `get_user_role() IN ('manager', 'admin')` if staff shouldn't see reports.

---

### 19. compute_booking_datetimes Fires on UPDATE but Immutability Blocks It

**File:** `supabase/schema.sql:284-287`
**Severity:** Medium

Two triggers on same event with no guaranteed ordering. Document or enforce via naming.

---

## LOW Issues

### 20. Enum Values Use Mixed Case

**Severity:** Low

`booking_status` uses Title-Case, `payment_status` uses lowercase. Requires `toDbStatus` transformer.

---

### 21. User Seed Data Is Commented Out

**File:** `supabase/seed.sql:122-143`
**Severity:** Low

Manual user creation required. Document prominently or automate.

---

### 22. Seed UUIDs Use Non-Standard Pattern

**File:** `supabase/seed.sql:14-105`
**Severity:** Low

`b0000000-...` is hex-valid but not UUIDv4. Acceptable for seed data.

---

### 23. SECURITY DEFINER on Payment Trigger

**File:** `supabase/schema.sql:327`
**Severity:** Low

Intentional bypass of RLS for payment trigger. Correctly scoped with `SET search_path = public`.

---

### 24. Supabase Client No Env Var Validation

**File:** `src/lib/supabase.js:3-4`
**Severity:** Low

Missing check for undefined `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

---

### 25. N+1 Potential in getUtilizationIntelligence

**File:** `src/services/api.js:1062-1068`
**Severity:** Medium

Queries `branches` for `open_time`/`close_time` which don't exist in schema. Returns null → NaN utilization percentages.
