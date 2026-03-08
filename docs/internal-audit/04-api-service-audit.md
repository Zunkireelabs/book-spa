# API Service Layer Audit

**Date:** 2026-03-08

---

## Positive Findings

### Consistent `{ data, error }` Return Shape
All service functions consistently return `{ data, error }` objects. Well-designed contract.

### `toDbStatus()` Consistently Used
Every consumer correctly applies `toDbStatus(newStatus)` before API calls. Verified in all dashboards and modals.

### `booking.bookingId` (UUID) Correctly Used
All mutation handlers use the real UUID, never `booking.id` (booking_number). Verified across all components.

### Auth Token Handling Delegated to Supabase Client
Automatic token refresh via `createClient`. AuthContext properly uses `onAuthStateChange`.

### `loadData()` Called After All Mutations
All mutation handlers refresh from server after success. No stale data from mutations.

---

## HIGH Issues

### 1. No Supabase Real-time Subscriptions Exist

**Severity:** High

Despite `RealtimeBookingFeed` component name, there are ZERO Supabase real-time subscriptions in the codebase. The "realtime" feed is just a static list refreshed only on manual `loadData()`.

**Business Impact:** Staff and managers don't see new bookings or status changes without manual refresh.

**Recommended Fix:**
```js
useEffect(() => {
  const sub = supabase.channel('bookings-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings',
      filter: `branch_id=eq.${branchId}` }, () => loadData())
    .subscribe();
  return () => { sub.unsubscribe(); };
}, [branchId]);
```

---

### 2. Missing Reschedule API — Feature is Mock-Only

**Severity:** High

`RescheduleModal` component exists and is rendered, but there is NO `rescheduleBooking` API function. The handler only does a client-side state update, never hitting the database.

**Business Impact:** Users see "Reschedule" button but rescheduling doesn't persist. Broken feature.

**Recommended Fix:** Implement `rescheduleBooking({ bookingId, newDate, newStartTime })` with lifecycle validation and room availability check.

---

### 3. PostgREST Filter Injection in Search

**File:** `src/services/api.js:1242-1243`
**Severity:** High

Search term interpolated directly into `.or()` filter string.

**Recommended Fix:** Sanitize special characters or use individual `.ilike()` calls.

---

## MEDIUM Issues

### 4. Inconsistent Error Shapes

**Severity:** Medium

Business errors return `{ code, message }`. Caught exceptions return raw Supabase error `{ message, code, details, hint }`.

**Recommended Fix:** Wrap all caught errors in standardized shape.

---

### 5. `In-Progress` Payment Gap

**File:** `src/services/api.js:204`
**Severity:** Medium

`recordPayment` only allows `Confirmed` and `Completed`. Staff can't record payment during active session.

---

### 6. No Auth on Read-Only Public Queries

**File:** `src/services/api.js:92-170`
**Severity:** Medium

`fetchServices()`, `fetchRooms()`, `fetchTherapists()`, `fetchBookings()` don't check auth. Rely on RLS.

**Recommended Fix:** Verify RLS restricts `anon` role appropriately on bookings.

---

### 7. `createBooking` Sets `created_by: null`

**File:** `src/services/api.js:1420`
**Severity:** Medium

Even staff-created bookings have no creator attribution.

**Recommended Fix:** Set `created_by: user?.id || null`.

---

### 8. `applyDiscount` Not Called by Any UI Component

**File:** `src/services/api.js:360`
**Severity:** Medium

Fully implemented API with zero frontend. Discount feature is backend-complete but unusable.

---

### 9. No Retry Logic

**Severity:** Medium

No retry for transient network errors. On flaky Nepal connections, single failure = error message.

**Recommended Fix:** 1-2 retries with exponential backoff for reads, or a "Retry" button in error states.

---

### 10. Booking Management Portal Cancel Doesn't Refresh

**File:** `src/pages/booking-management-portal/index.jsx:63-70`
**Severity:** Medium

Optimistic UI update after cancel without server re-fetch. Could show false "cancelled" if API failed.

---

### 11. Week/Month Filters Fetch ALL Bookings

**File:** `src/pages/branch-staff-dashboard/index.jsx:50-52`
**Severity:** Medium

When `dateRange` is `week` or `month`, date filter returns `{}` — loads ALL bookings for branch.

**Recommended Fix:** Compute actual start/end dates for week/month.

---

### 12. Stale Branch Data After Admin Switch

**File:** `src/contexts/BranchContext.jsx:79-88`
**Severity:** Medium

No cancellation for in-flight requests from previous branch during rapid switching.

**Recommended Fix:** Use AbortController or request ID pattern.

---

### 13. `fetchAuditLogs` Returns Non-Standard Shape

**File:** `src/services/api.js:2021`
**Severity:** Low

Returns `{ data, count, error }` unlike all other functions.

**Recommended Fix:** Nest count: `{ data: { rows, count }, error }`.

---

### 14. `closeDay` Duplicates Auth Logic

**File:** `src/services/api.js:547-558`
**Severity:** Low

Manually calls `supabase.auth.getUser()` instead of centralized `getAuthenticatedUser()`.

---

## CRUD Coverage Summary

| Entity | Create | Read | Update | Delete | Notes |
|--------|--------|------|--------|--------|-------|
| Bookings | ✅ | ✅ | ✅ (status) | ❌ (by design) | Missing: reschedule |
| Services | ✅ | ✅ | ✅ (pricing) | ❌ | |
| Rooms | ✅ | ✅ | ✅ | ✅ | |
| Therapists | ✅ | ✅ | ✅ | ✅ (deactivate) | |
| Payments | ✅ | ❌ (via reports only) | ❌ (immutable) | ❌ (immutable) | |
| Branches | ❌ | ✅ | ❌ | ❌ | Single branch MVP |
| Daily Reports | ✅ (closeDay) | ✅ | ❌ | ❌ | |
| Customers | ✅ | ✅ | ✅ | ❌ | Table may not exist in schema |
| Audit Logs | ❌ | ✅ | ❌ | ❌ | No automated logging triggers |
| Attendance | ✅ | ✅ | ✅ | ❌ | Table may not exist in schema |
