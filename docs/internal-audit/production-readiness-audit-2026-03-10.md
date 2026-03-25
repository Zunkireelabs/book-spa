# BookSpa Production Readiness Audit Report

**Date:** 2026-03-10
**Purpose:** Pre-pilot production audit for Nuad Thai client
**Audited By:** Claude Code (PM + Domain + Code Review + API + DB audit)

---

## Executive Summary

The app **builds successfully** and the database layer is **production-ready**. However, there are **3 critical issues** and several moderate items that must be fixed before going live with the pilot client.

---

## CRITICAL ISSUES (Must Fix Before Production)

### 1. Customer Booking Flow Has Hardcoded Demo Branches

**File:** `src/pages/customer-booking-flow/components/BranchSelection.jsx` (lines 6-82)

5 fake branches hardcoded: `kathmandu-main`, `pokhara-lakeside`, `chitwan-sauraha`, `bhaktapur-durbar`, `lalitpur-patan` — with fake ratings, review counts, and therapist availability. **Customers will see fake branch data, not the real Lazimpat branch.**

**Fix:** Fetch branches from `fetchAllBranches()` API. Since there is only one branch now, it should show just Lazimpat, and auto-scale as new branches are added.

---

### 2. `rescheduleBooking()` Uses Wrong Column Name

**File:** `src/services/api.js` (lines 623, 643, 647)

Uses `booking_date` but the actual DB column is `date`. This function **will fail at runtime** — rescheduling bookings is completely broken.

**Fix:** Change `booking_date` → `date` on lines 623, 643, 647.

---

### 3. `rescheduleBooking()` Missing `branch_id` Filter

**File:** `src/services/api.js` (line 620)

Room conflict check doesn't filter by `branch_id`, so in multi-branch setups it would check room availability across ALL branches.

**Fix:** Add `.eq('branch_id', booking.branch_id)` to the conflict query.

---

## MODERATE ISSUES (Should Fix)

| # | Issue | File | Details |
|---|-------|------|---------|
| 4 | `fetchServices()` has no `branch_id` filter | `api.js:92` | Returns all services globally — inconsistent with `fetchRooms`/`fetchTherapists` which filter by branch |
| 5 | `closeDay()` lock failure is silent | `api.js:823` | If lock fails, bookings remain editable after daily closing |
| 6 | JS bundle too large (2,055 kB) | Build output | Exceeds Vite's 2,000 kB warning. Code-split with dynamic imports |
| 7 | Testing libraries in `dependencies` | `package.json` | `@testing-library/*` should be in `devDependencies` |
| 8 | `react-router-dom` pinned to old `6.0.2` | `package.json` | Consider updating |

---

## LOW PRIORITY (Nice to Have)

| # | Issue | Details |
|---|-------|---------|
| 9 | Hardcoded service UI images | `serviceEnrichment.js` — Unsplash/Pixabay URLs for service cards |
| 10 | `console.warn` in ProtectedRoute.jsx | Line 43 — should remove or convert |
| 11 | Commented-out code in ErrorBoundary.jsx | Line 17 — dead code |
| 12 | Deprecated Tailwind plugins | `@tailwindcss/line-clamp`, `@tailwindcss/aspect-ratio` — now built-in |
| 13 | Unused devDependency | `vite-tsconfig-paths` — no tsconfig.json exists |
| 14 | Stale browserslist data | Run `npx update-browserslist-db@latest` |

---

## PASSING CHECKS (All Good)

| Area | Status | Details |
|------|--------|---------|
| Build | **PASS** | `npm run build` succeeds, no errors |
| Database Schema | **PASS** | All 12 tables with RLS, proper FKs, CHECK constraints |
| Payment Immutability | **PASS** | ON DELETE RESTRICT, no UPDATE/DELETE RLS policies |
| GIST Constraints | **PASS** | Room + therapist double-booking prevention active |
| Booking State Machine | **PASS** | Valid transitions enforced, terminal states immutable |
| Financial Calculations | **PASS** | base_amount, discount_amount, final_amount correct |
| Discount Workflow | **PASS** | none → pending → approved; rejection resets to none |
| Cash Reconciliation | **PASS** | All revenue queries filter `payment_status = 'paid'` |
| Nepal Timezone | **PASS** | `Asia/Kathmandu` used for all datetime ops |
| Booking ID Usage | **PASS** | All API calls use `bookingId` (UUID), never `booking_number` |
| `toDbStatus()` Usage | **PASS** | Applied in all status transitions |
| Seed Data | **PASS** | No test bookings — only metadata (rooms, services, therapists) |
| Secrets | **PASS** | `.env` gitignored, only anon key exposed (RLS-protected) |
| Auth/RLS | **PASS** | All mutations check `getAuthenticatedUser()` |
| Triggers | **PASS** | 9 DB triggers for datetime, financial, audit, immutability |
| CRUD Coverage | **PASS** | Complete for bookings, payments, therapists, services, rooms |
| Soft Deletes | **PASS** | No hard deletes — `toggleActive()` pattern used |

---

## Detailed Audit Breakdown

### Frontend Audit

**Demo/Mock Data Found:**
- `BranchSelection.jsx` (lines 6-82): 5 hardcoded fake branches with mock addresses, phone numbers, ratings (4.6-4.9), review counts, therapist availability — **CRITICAL**
- `serviceEnrichment.js` (lines 1-75): Hardcoded UI metadata for 8 services with Unsplash/Pixabay image URLs — acceptable design decision
- `resolveBranchId()` in `api.js` (lines 4-9): Hardcoded fallback to MVP branch UUID `b0000000-0000-0000-0000-000000000001` — **CRITICAL**

**Console Statements:**
- 39 structured `console.error('[API]...')` statements in `api.js` — acceptable for production error logging
- 1 `console.warn` in `ProtectedRoute.jsx` (line 43) — should remove
- 1 commented-out `console.log` in `ErrorBoundary.jsx` (line 17) — dead code
- 5 unstructured `console.error` calls across components — should normalize with `[FEATURE]` prefix

**Branch Architecture:**
- Staff/Manager: BranchContext correctly binds to `profile.branch_id` — **PASS**
- Admin: BranchContext dynamically fetches branches via `fetchAllBranches()` — **PASS**
- Customer Flow: Uses hardcoded demo branches — **FAIL** (Critical #1)

**Charts/Dashboard:** All dynamic, fetching real data from Supabase — **PASS**

---

### API/Service Layer Audit

**CRUD Coverage — Complete:**
- Bookings: create, read (list/search/byId), update (status/assign/discount/reschedule), soft-delete via status
- Payments: create only (immutable by design)
- Therapists: create, read, update, soft-delete (toggleActive)
- Services: read, update pricing, soft-delete (toggleActive)
- Rooms: create, read, update, soft-delete (toggleActive)

**State Machine:**
```
Pending → Confirmed, Cancelled
Confirmed → In-Progress, Cancelled, No Show
In-Progress → Completed
Completed, Cancelled, No Show → (terminal)
```
Properly enforced in `updateBookingStatus()` with `validateStatusTransition()`.

**Error Handling:**
- All mutations call `getAuthenticatedUser()` before modifying data
- Structured error responses with error codes (BOOKING_NOT_FOUND, UNAUTHORIZED, etc.)
- 111 error handling blocks with proper try-catch
- Handles 23505 (UNIQUE constraint) and 23P01 (GIST exclusion) errors explicitly

**Bug Found:** `rescheduleBooking()` uses `booking_date` instead of `date` column — **CRITICAL** (see Critical #2, #3)

---

### Business Domain Logic Audit

| Rule | Status | Evidence |
|------|--------|----------|
| Booking workflow transitions | **PASS** | State machine enforced with VALID_TRANSITIONS map |
| Financial calculations | **PASS** | Correct discount formula (percentage & fixed), CHECK constraints in DB |
| Discount approval (enum) | **PASS** | none → pending → approved; rejection resets to none |
| Payment immutability | **PASS** | No UPDATE/DELETE on payments anywhere in codebase |
| Cash reconciliation | **PASS** | All revenue queries use `payment_status = 'paid'` |
| Nepal timezone | **PASS** | `Asia/Kathmandu` used in DateTimeSelection and DB triggers |
| Room/therapist double-booking | **PASS** | GIST constraints + error code 23P01 handling |
| Booking ID usage | **PASS** | Always uses UUID (`bookingId`), never `booking_number` |
| Status transformations | **PASS** | `toDbStatus()` used in all status API calls |
| Branch filtering | **PARTIAL** | Missing in `rescheduleBooking()` conflict check and `fetchServices()` |

---

### Database Schema Audit

**Tables with RLS:** 12/12 — all covered
**Foreign Keys:** 23 FKs with proper cardinality
**CHECK Constraints:** `final_amount = base_amount - discount_amount`, `discount_amount >= 0`, `base_amount > 0`
**Triggers:** 9 triggers (datetime, financial, audit, immutability, snapshots, day-locking)
**Seed Data:** Clean — only metadata (branch, rooms, services, therapists), no test bookings
**Discount Enum:** `none`, `pending`, `approved` — correct

---

### Build & Dependencies Audit

**Build:** Succeeds with 2 warnings (browserslist stale, bundle size)
**Bundle Size:** 2,055 kB (454 kB gzipped) — over 2,000 kB limit
**Secrets:** `.env` properly gitignored, only anon key exposed
**Dependencies Issues:** Testing libraries in `dependencies`, deprecated Tailwind plugins, unused `vite-tsconfig-paths`

---

## Recommended Fix Order

1. **Fix `rescheduleBooking()`** — wrong column name + missing branch filter (Critical #2, #3)
2. **Replace demo branches** in customer booking flow with real API call (Critical #1)
3. **Move test libs to devDependencies** + code-split bundle (Moderate #6, #7)
4. **Add branch filter to `fetchServices()`** if services are branch-specific (Moderate #4)
5. **Make lock failure non-silent** in `closeDay()` (Moderate #5)
6. Clean up console statements, dead code, deprecated plugins (Low priority)

---

*Report generated by Claude Code production readiness audit.*
