# Phase 11A — Database Schema & Data Integrity Audit

**Project:** BookSpa (bookspa-nuad-thai)
**Database:** pmbvogiphelmpjdalmtv.supabase.co
**Audit Date:** 2026-02-15
**Auditor:** Claude Code (read-only inspection)

---

## SECTION 1 — TABLE INVENTORY

**12 tables** in `public` schema:

| Table | Rows | PK | FKs | UNIQUE | RLS | Key Notes |
|---|---|---|---|---|---|---|
| `attendance` | 0 | `id` (uuid) | `user_id->users`, `branch_id->branches` | `(user_id, date)` | Yes | Staff check-in/out |
| `audit_logs` | 27 | `id` (uuid) | None (soft ref) | -- | Yes | Append-only audit trail |
| `bookings` | 8 | `id` (uuid) | `branch_id->branches`, `room_id->rooms`, `service_id->services`, `therapist_id->therapists`, `customer_id->customers`, `created_by->users`, `discount_approved_by->users` | `booking_number` | Yes | Core entity |
| `branches` | 1 | `id` (uuid) | -- | -- | Yes | Global reference |
| `customers` | 2 | `id` (uuid) | `branch_id->branches` | `(branch_id, phone)` | Yes | CRM |
| `daily_reports` | 0 | `id` (uuid) | `branch_id->branches`, `closed_by->users` | `(branch_id, report_date)` | Yes | Day-close snapshot |
| `payments` | 3 | `id` (uuid) | `booking_id->bookings`, `recorded_by->users` | `booking_id` | Yes | Immutable payments |
| `rooms` | 9 | `id` (uuid) | `branch_id->branches` | -- | Yes | Master data |
| `services` | 8 | `id` (uuid) | -- | -- | Yes | Global catalog |
| `therapist_attendance` | 0 | `id` (uuid) | `therapist_id->therapists`, `branch_id->branches`, `marked_by->users` | `(therapist_id, date)` | Yes | Daily therapist status |
| `therapists` | 6 | `id` (uuid) | `branch_id->branches` | -- | Yes | Master data |
| `users` | 3 | `id` (uuid) | `id->auth.users`, `branch_id->branches` | `email` | Yes | Auth profiles |

### CHECK Constraints (Business Rules)

- `chk_base_positive`: `base_amount > 0`
- `chk_discount_positive`: `discount_amount >= 0`
- `chk_final_amount`: `final_amount = base_amount - discount_amount`
- `chk_discount_approval`: approved discount requires `discount_approved_by IS NOT NULL`
- `therapists_gender_check`: `gender IN ('Male', 'Female')`
- `therapist_attendance_status_check`: `status IN ('Present', 'Absent', 'Leave', 'Half-Day')`

### Exclusion Constraints (GIST)

- `excl_room_overlap`: prevents room double-booking (non-Cancelled)
- `excl_therapist_overlap`: prevents therapist double-booking (non-Cancelled, non-NULL)

### Custom Enums

- `booking_status`: Pending, Confirmed, In-Progress, Completed, Cancelled, No Show
- `payment_status_enum`: unpaid, paid
- `discount_status_enum`: none, pending, approved
- `payment_mode`: Cash, Nabil, GlobalIME, NICAsia, Fonepay
- `user_role`: staff, manager, admin

---

## SECTION 2 — FOREIGN KEY INTEGRITY

### ON DELETE Behavior

| FK Path | ON DELETE | Assessment |
|---|---|---|
| `bookings.customer_id -> customers` | **RESTRICT** | Correct -- prevent orphaning |
| `bookings.therapist_id -> therapists` | NO ACTION | OK -- therapist_id is nullable |
| `bookings.room_id -> rooms` | NO ACTION | OK -- functionally same as RESTRICT |
| `bookings.service_id -> services` | NO ACTION | OK |
| `bookings.branch_id -> branches` | NO ACTION | OK |
| `bookings.created_by -> users` | NO ACTION | OK |
| `payments.booking_id -> bookings` | **RESTRICT** | Correct -- payment immutability |
| `daily_reports.branch_id -> branches` | NO ACTION | OK |
| `daily_reports.closed_by -> users` | NO ACTION | OK |
| `therapist_attendance.therapist_id -> therapists` | **RESTRICT** | Correct |
| `therapist_attendance.branch_id -> branches` | **RESTRICT** | Correct |
| `therapist_attendance.marked_by -> users` | **RESTRICT** | Correct |
| `customers.branch_id -> branches` | **RESTRICT** | Correct |
| `attendance.user_id -> users` | NO ACTION | OK |
| `attendance.branch_id -> branches` | NO ACTION | OK |
| `users.id -> auth.users` | NO ACTION | OK |
| `users.branch_id -> branches` | NO ACTION | OK |

### Orphan Check Results

| FK Path | Orphaned Rows |
|---|---|
| `bookings.customer_id -> customers` | **0** |
| `bookings.therapist_id -> therapists` | **0** |
| `bookings.room_id -> rooms` | **0** |
| `bookings.service_id -> services` | **0** |
| `bookings.branch_id -> branches` | **0** |
| `payments.booking_id -> bookings` | **0** |
| `daily_reports.branch_id -> branches` | **0** |
| `therapist_attendance.therapist_id -> therapists` | **0** |
| `therapist_attendance.branch_id -> branches` | **0** |
| `users.branch_id -> branches` | **0** |
| `attendance.user_id -> users` | **0** |
| `attendance.branch_id -> branches` | **0** |

**Result: CLEAN -- zero orphaned rows across all FK relationships.**

### Nullable FK Analysis

| FK Column | Nullable? | Assessment |
|---|---|---|
| `bookings.therapist_id` | YES | Correct -- therapist assigned later |
| `bookings.customer_id` | YES | **FINDING** -- 3 bookings have NULL customer_id. Walk-in scenario is valid but should be documented |
| `bookings.created_by` | YES | Correct -- anon bookings have no auth user |
| `bookings.discount_approved_by` | YES | Correct -- only set when approved |
| `audit_logs.branch_id` | YES | Correct -- some system-level logs |
| `audit_logs.changed_by` | YES | Correct -- triggers may fire without auth context |
| `users.branch_id` | YES | **FINDING** -- see Section 4 (admin design) |

---

## SECTION 3 — SNAPSHOT INTEGRITY

### Snapshot Field Status

| Field | NOT NULL? | NULLs Found | Assessment |
|---|---|---|---|
| `service_name_snapshot` | NOT NULL | 0 | PASS |
| `service_duration_snapshot` | NOT NULL | 0 | PASS |
| `service_price_snapshot` | NOT NULL | 0 | PASS |
| `therapist_name_snapshot` | **NULLABLE** | 1 | See below |
| `room_name_snapshot` | **NULLABLE** | 0 | OK |

### Snapshot vs. Current Master Data

| Check | Mismatches |
|---|---|
| service_name_snapshot vs services.name | 0 |
| service_price_snapshot vs services.price_npr | 0 |
| service_duration_snapshot vs services.duration_minutes | 0 |

**Note:** Zero mismatches indicates master data has not been modified since bookings were created. Snapshots will diverge once services are updated -- this is the intended design.

### Finding: Completed Booking Without Therapist Snapshot

**Booking `BK-20260214-0001`** (status=Completed, payment_status=paid) has:
- `therapist_id = NULL`
- `therapist_name_snapshot = NULL`

This is a **data quality concern**. A completed booking should logically have a therapist assigned. The schema allows this (therapist_id is nullable), but business logic should enforce therapist assignment before completion.

### Immutability Trigger Verified

`enforce_booking_immutability()` explicitly blocks changes to all snapshot fields on Completed bookings: `service_name_snapshot`, `service_duration_snapshot`, `service_price_snapshot`, `therapist_name_snapshot`, `room_name_snapshot`. **PASS.**

---

## SECTION 4 — BRANCH ISOLATION

### Branch-Scoped Tables

| Table | Has `branch_id`? | Scoping Method |
|---|---|---|
| `bookings` | YES (NOT NULL) | Direct |
| `payments` | NO | Via `bookings` JOIN in RLS |
| `daily_reports` | YES (NOT NULL) | Direct |
| `rooms` | YES (NOT NULL) | Direct |
| `therapists` | YES (NOT NULL) | Direct |
| `customers` | YES (NOT NULL) | Direct |
| `therapist_attendance` | YES (NOT NULL) | Direct |
| `attendance` | YES (NOT NULL) | Direct |
| `audit_logs` | YES (nullable) | Direct, nullable for system logs |
| `users` | YES (nullable) | Direct, nullable for admin |

### Global Tables (correctly no branch_id)

| Table | Why Global |
|---|---|
| `services` | Shared service catalog across all branches |
| `branches` | Reference table for branches themselves |

**Assessment: CORRECT** -- `payments` lacks its own `branch_id` but enforces branch isolation via JOIN to `bookings` in RLS. This is the correct pattern for a 1:1 payment-to-booking relationship.

### Admin Branch Scoping

**FINDING (MODERATE):** Admin user `44ff77b9-...` has `branch_id = b0000000-...-000000000001` (Lazimpat), **NOT NULL**.

- RLS policies use `OR (get_user_role() = 'admin')` fallback, so admin CAN read all branches
- However, `get_user_branch_id()` returns Lazimpat for admin
- When admin creates bookings/records, they will be auto-scoped to Lazimpat
- **For multi-branch admin context-switching, admin should have `branch_id = NULL`** or the app must explicitly set branch_id per operation

### Manager Isolation

RLS policies consistently use `branch_id = get_user_branch_id()` for manager role without admin fallback. **Managers CANNOT see other branches.** PASS.

---

## SECTION 5 — TRIGGER INTEGRITY

### Trigger Inventory

| Trigger | Table | Timing | Event | Function | Assessment |
|---|---|---|---|---|---|
| `trg_booking_number` | bookings | BEFORE | INSERT | `generate_booking_number()` | PASS |
| `trg_compute_datetimes` | bookings | BEFORE | INSERT, UPDATE | `compute_booking_datetimes()` | PASS |
| `trg_compute_final_amount` | bookings | BEFORE | INSERT, UPDATE | `compute_final_amount()` | PASS |
| `trg_enforce_booking_immutability` | bookings | BEFORE | UPDATE | `enforce_booking_immutability()` | PASS |
| `trg_updated_at` | bookings | BEFORE | UPDATE | `update_updated_at()` | PASS |
| `trg_audit_bookings` | bookings | AFTER | UPDATE | `fn_insert_audit_log()` | PASS |
| `trg_payment_update_booking_status` | payments | AFTER | INSERT | `update_booking_payment_status()` | PASS |
| `trg_audit_payments` | payments | AFTER | INSERT | `fn_insert_audit_log()` | PASS |
| `trg_audit_daily_reports` | daily_reports | AFTER | INSERT | `fn_insert_audit_log()` | PASS |
| `trg_attendance_day_lock` | therapist_attendance | BEFORE | UPDATE | `check_attendance_day_lock()` | PASS |
| `trg_attendance_day_lock_insert` | therapist_attendance | BEFORE | INSERT | `check_attendance_day_lock()` | PASS |
| `trg_updated_at` | therapist_attendance | BEFORE | UPDATE | `update_updated_at()` | PASS |
| `trg_audit_rooms` | rooms | AFTER | UPDATE | `fn_insert_audit_log()` | PASS |
| `trg_audit_services` | services | AFTER | UPDATE | `fn_insert_audit_log()` | PASS |
| `trg_audit_therapists` | therapists | AFTER | UPDATE | `fn_insert_audit_log()` | PASS |

### Trigger Timing Analysis

- All computation triggers (datetimes, final_amount, immutability) fire **BEFORE** -- CORRECT
- All audit triggers fire **AFTER** -- CORRECT
- No duplicate triggers found
- No trigger order conflicts (alphabetical ordering within same timing is predictable)

### Missing Audit Triggers (observation)

| Table | INSERT Audit | UPDATE Audit | Assessment |
|---|---|---|---|
| `customers` | NO | NO | **Gap** -- customer modifications untracked |
| `attendance` | NO | NO | **Gap** -- staff attendance untracked |
| `therapist_attendance` | NO (only day-lock) | NO (only day-lock + updated_at) | **Gap** -- therapist attendance changes untracked |

---

## SECTION 6 — INDEX & PERFORMANCE HEALTH

### Current Indexes

| Table | Index | Type | Assessment |
|---|---|---|---|
| `bookings` | `idx_bookings_branch_date` | btree (branch_id, date) | Optimal for daily queries |
| `bookings` | `idx_bookings_date` | btree (date) | Supports date-only queries |
| `bookings` | `idx_bookings_status` | btree (status) | Supports status filtering |
| `bookings` | `idx_bookings_customer_id` | btree (customer_id) | Supports customer lookups |
| `bookings` | `excl_room_overlap` | GIST | Overlap prevention |
| `bookings` | `excl_therapist_overlap` | GIST | Overlap prevention |
| `audit_logs` | `idx_audit_logs_branch_changed_at` | btree (branch_id, changed_at DESC) | Optimal for dashboard queries |
| `audit_logs` | `idx_audit_logs_record_id` | btree (record_id) | Record lookup |
| `audit_logs` | `idx_audit_logs_table_name` | btree (table_name) | Table filtering |
| `customers` | `idx_customers_branch_id` | btree (branch_id) | Branch scoping |
| `customers` | `idx_customers_phone` | btree (phone) | Phone lookup |
| `daily_reports` | `idx_daily_reports_branch_date` | btree (branch_id, report_date) | Optimal |
| `payments` | `idx_payments_created_at` | btree (created_at) | Time-based queries |
| `therapist_attendance` | `idx_attendance_branch_date` | btree (branch_id, date) | Optimal |
| `therapist_attendance` | `idx_attendance_therapist_date` | btree (therapist_id, date) | Therapist lookup |
| `attendance` | `idx_attendance_date` | btree (date) | Date lookup |

### Missing Indexes (Recommendations)

| Table | Suggested Index | Reason |
|---|---|---|
| `rooms` | `idx_rooms_branch_id` | FK lookups when loading branch rooms (9 rows now, may grow) |
| `therapists` | `idx_therapists_branch_id` | FK lookups when loading branch therapists |
| `bookings` | `idx_bookings_therapist_id` | Therapist performance queries |
| `bookings` | `idx_bookings_payment_status` | Unpaid booking queries for daily closing |

**No table exceeds 1k rows currently.** Index recommendations are preemptive for production scale.

---

## SECTION 7 — DATA ANOMALY CHECKS

| Anomaly Check | Count | Severity |
|---|---|---|
| Paid bookings without payment row | **0** | CLEAN |
| Payments for cancelled bookings | **0** | CLEAN |
| Duplicate customer phones per branch | **0** | CLEAN |
| Inactive therapists on future bookings | **0** | CLEAN |
| Daily reports without bookings | **0** | CLEAN |
| Attendance records on closed days | **0** | CLEAN |

### Findings

**FINDING 1 -- Completed booking without therapist (MODERATE)**
`BK-20260214-0001`: Completed + Paid, but `therapist_id = NULL`. Business rules should require therapist assignment before marking Complete.

**FINDING 2 -- Completed bookings with unpaid status (5 of 8)**

| Booking | Status | Payment Status |
|---|---|---|
| BK-20260214-0003 | Completed | **unpaid** |
| BK-20260215-0001 | Completed | **unpaid** |
| BK-20260215-0002 | Completed | **unpaid** |
| BK-20260215-0003 | Completed | **unpaid** |
| BK-20260215-0004 | Completed | **unpaid** |

This is not a schema violation (the schema allows it), but 62.5% of completed bookings being unpaid is a reconciliation concern. The daily closing system should flag these.

**FINDING 3 -- Bookings without customer_id (3 of 8)**
`BK-20260215-0002`, `BK-20260215-0003`, `BK-20260215-0004` have `customer_id = NULL`. Walk-in support is valid, but CRM tracking suffers.

---

## SECTION 8 — SECURITY & RLS AUDIT

### RLS Enabled

All 12 tables: **RLS ENABLED.** PASS.

### Critical Security Findings

**FINDING S1 -- HIGH: Anonymous users can read ALL customer data**
```
Policy: "Anonymous users can read customers"
Role: {public}   Cmd: SELECT   USING: (true)
```
This exposes customer PII (full_name, phone, email) to unauthenticated requests. The `{public}` role means BOTH anon AND authenticated users match.

**FINDING S2 -- HIGH: Anonymous users can read ALL bookings**
```
Policy: "Anonymous users can read bookings for overlap check"
Role: {anon}   Cmd: SELECT   USING: (true)
```
All booking data (customer name, phone, amounts, status) is readable without authentication. Intended for overlap checks but over-exposes.

**FINDING S3 -- MODERATE: Anonymous INSERT on customers with no branch validation**
```
Policy: "Anonymous users can create customers"
Role: {public}   Cmd: INSERT   WITH CHECK: (true)
```
Any unauthenticated user can INSERT customers with any `branch_id`. The FK constraint validates branch existence, but there's no scoping.

**FINDING S4 -- MODERATE: Anonymous INSERT on bookings with no validation**
```
Policy: "Anonymous users can create bookings"
Role: {anon}   Cmd: INSERT   WITH CHECK: (true)
```
Any anon user can create bookings for any branch. While intentional for public booking flow, this lacks rate limiting or input validation at DB level.

**FINDING S5 -- LOW: Audit log policies use `{public}` role instead of `{authenticated}`**
```
Policies: "Admin can read all audit logs", "Manager can read branch audit logs"
Role: {public}
```
The `get_user_role()` function returns NULL for unauthenticated users (auth.uid() is NULL), so this is not exploitable. But using `{authenticated}` would be more explicit.

### Policy Completeness

| Table | SELECT | INSERT | UPDATE | DELETE | Assessment |
|---|---|---|---|---|---|
| `attendance` | Auth | Auth | Auth | **NONE** | OK (no soft-delete) |
| `audit_logs` | Auth (role-based) | **NONE** | **NONE** | **NONE** | Correct -- insert-only via triggers |
| `bookings` | Auth + Anon | Auth + Anon | Auth | **NONE** | Anon SELECT too broad |
| `branches` | Auth + Anon | **NONE** | **NONE** | **NONE** | Correct -- read-only ref |
| `customers` | Public(!) | Public(!) | Auth | **NONE** | Over-permissive |
| `daily_reports` | Auth | Auth (manager+) | **NONE** | **NONE** | Correct -- immutable |
| `payments` | Auth | Auth | **NONE** | **NONE** | Correct -- immutable |
| `rooms` | Auth + Anon | Auth (manager+) | Auth (manager+) | **NONE** | OK |
| `services` | Auth + Anon | **NONE** | Auth (admin) | **NONE** | OK |
| `therapist_attendance` | Auth | Auth (manager+) | Auth (manager+) | **NONE** | OK |
| `therapists` | Auth + Anon | Auth (manager+) | Auth (manager+) | **NONE** | OK |
| `users` | Auth (scoped) | **NONE** | **NONE** | **NONE** | OK |

### `USING (true)` Audit

| Table | Policy | Dangerous? |
|---|---|---|
| `bookings` | "Anonymous users can read bookings for overlap check" | **YES** -- exposes all data |
| `bookings` | "Anonymous users can create bookings" (WITH CHECK true) | **MODERATE** -- no input scoping |
| `branches` | "Anonymous/Authenticated can read branches" | NO -- public reference data |
| `customers` | "Anonymous users can read/create customers" | **YES** -- exposes PII |
| `rooms` | "Anonymous users can read rooms" | NO -- public info for booking flow |
| `services` | "Anonymous/Anyone can read services" | NO -- public catalog |
| `therapists` | "Anonymous users can read therapists" | NO -- public info for booking flow |

---

## SUMMARY

### Risk Level: **MODERATE-HIGH**

The schema is architecturally sound with excellent constraint design, proper trigger ordering, correct immutability enforcement, and clean referential integrity. However, there are significant RLS security gaps for production.

### Required Fixes (before production)

| # | Severity | Issue | Fix Description |
|---|---|---|---|
| **F1** | **HIGH** | Customers `{public}` SELECT with `USING(true)` | Restrict anon customer read to phone-lookup only (e.g., via server-side RPC function) or remove anon SELECT entirely |
| **F2** | **HIGH** | Bookings anon SELECT with `USING(true)` | Restrict to overlap-check-only via a server-side RPC function. Remove the blanket anon SELECT policy |
| **F3** | **MODERATE** | Customers anon INSERT with `WITH CHECK(true)` | Add branch_id validation or require branch_id to come from a validated source |
| **F4** | **MODERATE** | Admin user has `branch_id` set | Set admin `branch_id = NULL` and ensure RLS `OR (get_user_role() = 'admin')` handles this correctly. Or: pass branch context explicitly in each admin operation |
| **F5** | **MODERATE** | No DB-level enforcement of therapist before completion | Add CHECK or trigger: if `status = 'Completed'` then `therapist_id IS NOT NULL` |

### Recommended Improvements (optional)

| # | Area | Recommendation |
|---|---|---|
| R1 | Audit coverage | Add audit triggers for `customers`, `attendance`, `therapist_attendance` |
| R2 | Indexes | Add `idx_rooms_branch_id`, `idx_therapists_branch_id`, `idx_bookings_therapist_id` |
| R3 | Audit log roles | Change audit_logs policies from `{public}` to `{authenticated}` |
| R4 | Booking number | `generate_booking_number()` uses COUNT-based sequencing -- under high concurrency this could have race conditions. Consider `pg_advisory_lock` or a sequence |
| R5 | Daily closing | Add trigger or constraint: block status changes to `Completed` if `payment_status = 'unpaid'` (or explicitly flag it in daily report) |
| R6 | Soft-delete | No table supports DELETE via RLS. This is by design, but ensure the application layer also prevents accidental deletions via service-role key |

---

**End of Phase 11A Audit. No modifications were made to the database.**
