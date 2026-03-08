# Business Logic Audit

**Date:** 2026-03-08

---

## CRITICAL Issues

### 1. SQL Injection via Search Input (PostgREST Filter Injection)

**File:** `src/services/api.js:1242-1244`
**Severity:** Critical

The `searchBookings` function interpolates user input directly into a PostgREST `.or()` filter string without sanitization:

```js
dbQuery = dbQuery.or(
  `booking_number.ilike.%${searchTerm}%,customer_name.ilike.%${searchTerm}%,customer_phone.ilike.%${searchTerm}%`
);
```

A crafted `searchTerm` containing `,` or `.` could inject additional PostgREST filter clauses. While PostgREST is not raw SQL, this is still a filter injection risk that could leak data or bypass intended query scope.

**Business Impact:** An attacker could craft search queries that bypass branch scoping or return unintended data.

**Recommended Fix:** Sanitize the search term to strip or escape PostgREST-special characters (`,`, `.`, `(`), or use separate `.ilike()` calls combined with `.or()` using object syntax.

---

### 2. Booking Portal Cancel Allows Bypassing State Machine

**File:** `src/pages/booking-management-portal/index.jsx:59-71`
**Severity:** High

The `handleCancel` function calls `updateBookingStatus({ bookingId: booking.bookingId, newStatus: 'Cancelled' })` regardless of current status. The `BookingCard` UI only shows cancel for `confirmed` bookings, but the handler itself has no check. Per the state machine, `Pending → Cancelled` is not a valid transition, trapping pending bookings.

**Business Impact:** Customers with `Pending` bookings cannot cancel them from the portal UI.

**Recommended Fix:** Either add `Cancelled` as a valid transition from `Pending` in `VALID_TRANSITIONS`, or show a clear message.

---

### 3. Time Slot Availability Uses Random Mock Data

**File:** `src/pages/customer-booking-flow/components/DateTimeSelection.jsx:53-54`
**Severity:** Critical

```js
const maleAvailable = Math.random() > 0.3;
const femaleAvailable = Math.random() > 0.2;
```

Availability changes on every render and has no relationship to actual database state.

**Business Impact:** Customers see fake availability. They might select slots that are fully booked, or miss genuinely open slots.

**Recommended Fix:** Replace with real availability check against the database.

---

## HIGH Issues

### 4. No Show Bookings Still Block Rooms and Therapists

**File:** `supabase/schema.sql:151-161`
**Severity:** High

GIST exclusion constraints only exclude `Cancelled`:

```sql
WHERE (status != 'Cancelled')
```

`No Show` bookings still occupy rooms and therapist slots.

**Business Impact:** If a customer no-shows at 10 AM for a 60-minute slot, that room cannot be used for a walk-in at 10:30 AM.

**Recommended Fix:** Change to `WHERE (status NOT IN ('Cancelled', 'No Show'))`.

---

### 5. Discount Approval Flow is Incomplete

**File:** `src/services/api.js:360-453`
**Severity:** High

`applyDiscount` immediately sets `discount_status: 'approved'`. There is no mechanism for staff to request a discount (setting status to `pending`) for manager review. The `pending` enum value is dead code.

**Business Impact:** Staff can only apply discounts up to 5% (auto-approved). No way to request higher discounts from a manager.

**Recommended Fix:** Implement `requestDiscount` (sets `pending`), `approveDiscount`, and `rejectDiscount` (resets to `none`).

---

### 6. Payment Not Allowed for In-Progress Bookings

**File:** `src/services/api.js:204`
**Severity:** Medium

`recordPayment` only allows `Confirmed` and `Completed`. `In-Progress` is excluded.

**Business Impact:** Staff must wait until session is completed or collect payment before it starts.

**Recommended Fix:** Add `In-Progress` to allowed statuses: `['Confirmed', 'In-Progress', 'Completed']`.

---

### 7. Service Availability Uses Stale/Mock Branch Data

**File:** `src/pages/customer-booking-flow/components/ServiceSelection.jsx:43-51`
**Severity:** High

`getTherapistAvailability` reads from `selectedBranch.availableTherapists.male/female`, which comes from static/mock branch data.

**Business Impact:** Services may show as "Not Available" even when therapists exist.

**Recommended Fix:** Fetch actual therapist counts from the `therapists` table.

---

## MEDIUM Issues

### 8. `addMinutesToTime` Does Not Handle Midnight Overflow

**File:** `src/services/api.js:11-17`
**Severity:** Medium

If a booking starts at 23:00 with 90min service, it returns `24:30` (invalid time).

**Recommended Fix:** Use `newH % 24` or refuse bookings crossing midnight.

---

### 9. Daily Closing Race Condition

**File:** `src/services/api.js:609-620`
**Severity:** Medium

`closeDay` inserts the daily report first, then locks bookings. If lock fails, report exists but bookings remain unlocked.

**Recommended Fix:** Wrap in an RPC function with a transaction.

---

### 10. Booking Management Portal Cancel Updates State Locally

**File:** `src/pages/booking-management-portal/index.jsx:69`
**Severity:** Low

After cancellation, local state update without server re-fetch. May not reflect server-side side effects.

---

### 11. Date Generation Uses Browser Timezone, Not Nepal

**Files:** `DateTimeSelection.jsx:13-20`, `branch-staff-dashboard/index.jsx:38`, `branch-manager-dashboard/index.jsx:59`
**Severity:** Medium

`new Date().toISOString().split('T')[0]` uses UTC, not Nepal time (UTC+5:45).

**Recommended Fix:** Create `getNepalToday()`:
```js
new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' })
```

---

### 12. Booking Management Portal Accessible Only to Staff/Manager

**File:** `src/Routes.jsx:31-34`
**Severity:** Medium

Customer booking flow has "Find Existing Booking" link, but the portal requires authentication.

**Business Impact:** Customers clicking that link get redirected to login.

---

## LOW Issues

### 13. Therapist Status Always Shows "Available"

**File:** `src/pages/branch-staff-dashboard/index.jsx:82`
**Severity:** Low

All therapists mapped with `status: 'available'` — never reflects busy/break.

---

### 14. CSV Export Does Not Escape Commas

**File:** `src/services/api.js:882`
**Severity:** Low

Theoretical — current enum values don't contain commas.

---

## Things Done WELL

1. **GIST Exclusion Constraints** — Gold standard for room/therapist overlap prevention
2. **Financial CHECK Constraint** — `final_amount = base_amount - discount_amount` enforced at DB level
3. **Trigger-based Computed Fields** — End time, datetimes, final_amount always consistent
4. **Payment Immutability** — ON DELETE RESTRICT, no UPDATE RLS, UNIQUE booking_id
5. **Centralized State Machine** — `VALID_TRANSITIONS` as single source of truth
6. **Day Locking via DB Trigger** — Defense in depth beyond application checks
7. **Booking Number Auto-generation** — `BK-YYYYMMDD-XXXX` with collision handling
8. **Snapshot Fields** — Service/therapist/room names preserved at booking time
9. **Role-Based Discount Limits** — Clean per-role percentage limits
10. **Auth Race Condition Prevention** — `signInActiveRef` guard in AuthContext
11. **RLS Policy Design** — Branch-scoped, anonymous booking, payment immutability
12. **Nepal Timezone in DB Triggers** — `AT TIME ZONE 'Asia/Kathmandu'`
