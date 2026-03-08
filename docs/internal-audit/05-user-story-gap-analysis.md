# User Story Gap Analysis

**Date:** 2026-03-08
**Source:** `docs/user-stories/` (10 files, 54 stories)

---

## 01 — Customer Booking Flow (`01-customer-booking.md`)

| Story ID | Story Title | Status | Notes |
|----------|-------------|--------|-------|
| US-CUS-001 | Browse Available Services | ⚠️ PARTIAL | Services load from DB. No category filter — `services` table has no `category` column. Categories from hardcoded `serviceEnrichment.js`. |
| US-CUS-002 | Select Date and Time | ⚠️ PARTIAL | Calendar works (today + 30 days). **Past time slots for today not disabled**. Time slots not checked against actual DB availability. |
| US-CUS-003 | Provide Personal Details | 🔴 WRONG | **Story says**: only customer name required, email/phone/gender optional. **Implementation**: requires ALL of firstName, lastName, email (regex), phone (10 digits), gender. File: `customer-booking-flow/index.jsx:131-138`. |
| US-CUS-004 | Review and Confirm Booking | ✅ IMPLEMENTED | Confirmation page, `createBooking()` API, room auto-assigned, ROOMS_FULL error, booking number returned. |
| US-CUS-005 | Receive Booking Confirmation | ✅ IMPLEMENTED | Success page with booking number, details, "Book Another" option. |
| US-CUS-006 | Manage My Booking | ⚠️ PARTIAL | Search works via API. Cancel calls real API. **Reschedule is mock-only** — no API function. No repeat-customer booking history. |

---

## 02 — Authentication & Access Control (`02-authentication.md`)

| Story ID | Story Title | Status | Notes |
|----------|-------------|--------|-------|
| US-AUTH-001 | Staff Login | ✅ IMPLEMENTED | Email/password via Supabase, role-based redirect, error display, profile fetch. |
| US-AUTH-002 | Session Persistence | ✅ IMPLEMENTED | Session restored on mount, profile re-fetched, loading spinner. |
| US-AUTH-003 | Protected Route Access | ✅ IMPLEMENTED | `ProtectedRoute.jsx` handles auth, roles, loading states. |
| US-AUTH-004 | Staff Logout | ✅ IMPLEMENTED | `signOut()` clears state, calls Supabase signOut. |
| US-AUTH-005 | Role Display in UI | ✅ IMPLEMENTED | Name, role badge, branch name in headers. |

---

## 03 — Staff Booking Operations (`03-staff-booking-ops.md`)

| Story ID | Story Title | Status | Notes |
|----------|-------------|--------|-------|
| US-SBO-001 | View Today's Bookings | ✅ IMPLEMENTED | Real DB data, filtered by branch/date, sorted, loading/empty states. |
| US-SBO-002 | Filter and Search Bookings | ✅ IMPLEMENTED | Filter by status, service type, search by name/phone/booking number. |
| US-SBO-003 | Create Walk-in Booking | ⚠️ PARTIAL | `createBooking()` API works but **no staff-facing quick form**. "Add Walk-in" navigates to full 6-step public flow. No `created_by`. Walk-ins default to "Pending" instead of "Confirmed". |
| US-SBO-004 | View Booking Details | ✅ IMPLEMENTED | Real booking by ID, all fields displayed. |
| US-SBO-005 | Update Booking Status | ✅ IMPLEMENTED | Real API with lifecycle validation, client + server enforcement. |
| US-SBO-006 | View Therapist Availability | ⚠️ PARTIAL | Therapists load from DB. **Status always hardcoded "available"** (`index.jsx:82`). No busy/break detection. |
| US-SBO-007 | Room Auto-Assignment Feedback | ✅ IMPLEMENTED | Room in booking details, auto-assigned at creation, ROOMS_FULL error. |
| US-SBO-008 | Booking Number Display | ✅ IMPLEMENTED | `BK-YYYYMMDD-XXXX` format, displayed everywhere. |

---

## 04 — Therapist Assignment (`04-therapist-assignment.md`)

| Story ID | Story Title | Status | Notes |
|----------|-------------|--------|-------|
| US-THA-001 | Assign Therapist to Booking | ✅ IMPLEMENTED | Modal with therapist list, radio selection, GIST conflict handling. |
| US-THA-002 | View Therapist Match Score | ❌ NOT IMPLEMENTED | No scoring algorithm. Story requires weighted scoring (gender 30%, specialty 40%, experience 20%, rating 10%). |
| US-THA-003 | Reassign Therapist | ✅ IMPLEMENTED | `assignTherapist()` allows changing, lifecycle guards apply. |
| US-THA-004 | Unassign Therapist | ✅ IMPLEMENTED | `assignTherapist()` with `null` therapistId. |

---

## 05 — Payment Recording (`05-payment-recording.md`)

| Story ID | Story Title | Status | Notes |
|----------|-------------|--------|-------|
| US-PAY-001 | Record Payment for Confirmed | ✅ IMPLEMENTED | Modal with amounts, payment mode, notes, `recordPayment()`, trigger updates status. |
| US-PAY-002 | Record Payment for Completed | ✅ IMPLEMENTED | Same flow, allows "Completed" status. |
| US-PAY-003 | Block Payment for Invalid States | ✅ IMPLEMENTED | `canPay` check, API returns `INVALID_PAYMENT_STATE`. |
| US-PAY-004 | Block Duplicate Payment | ✅ IMPLEMENTED | Pre-check + UNIQUE constraint + `ALREADY_PAID` error. |
| US-PAY-005 | Payment Immutability | ✅ IMPLEMENTED | No UPDATE/DELETE RLS, RESTRICT FK, no edit UI. |
| US-PAY-006 | Payment Status Visibility | ✅ IMPLEMENTED | Badges, amounts, status updates after payment. |

---

## 06 — Pricing & Discount Engine (`06-discount-engine.md`)

| Story ID | Story Title | Status | Notes |
|----------|-------------|--------|-------|
| US-DSC-001 | Apply Small Discount (Staff) | ⚠️ PARTIAL | `applyDiscount()` API complete with 5% limit, reason, auto-approval. **No frontend UI anywhere.** |
| US-DSC-002 | Apply Higher Discount (Manager) | ⚠️ PARTIAL | API supports 30% manager limit. **Same gap: no UI.** |
| US-DSC-003 | Request Discount Above Limit | ❌ NOT IMPLEMENTED | API returns `DISCOUNT_LIMIT_EXCEEDED` but does NOT set `pending`. No routing to manager. |
| US-DSC-004 | Approve or Reject Discount Request | ❌ NOT IMPLEMENTED | No approval/rejection UI or API. No manager notification panel. |
| US-DSC-005 | Price Snapshot at Booking Time | ✅ IMPLEMENTED | `base_amount = service.price_npr`. CHECK constraint. Trigger computes. |
| US-DSC-006 | Prevent Direct Price Editing | ✅ IMPLEMENTED | No UI input for amounts. Trigger enforces formula. |

---

## 07 — Daily Closing & Reconciliation (`07-daily-closing.md`)

| Story ID | Story Title | Status | Notes |
|----------|-------------|--------|-------|
| US-DCR-001 | Close the Day | ✅ IMPLEMENTED | Role check, revenue from paid bookings, locks bookings, prevents re-close. |
| US-DCR-002 | View Payment Mode Breakdown | ✅ IMPLEMENTED | Cash/card/fonepay breakdown in reports. |
| US-DCR-003 | View Unpaid Bookings Report | ✅ IMPLEMENTED | Unpaid list, count, warning on close. |
| US-DCR-004 | View Booking Status Breakdown | ✅ IMPLEMENTED | Total, completed, cancelled, no-show counts. |
| US-DCR-005 | View Staff Discount Summary | ✅ IMPLEMENTED | Grouped by approver, names resolved, amounts shown. |

---

## 08 — Manager Dashboard & Reporting (`08-manager-dashboard.md`)

| Story ID | Story Title | Status | Notes |
|----------|-------------|--------|-------|
| US-MGR-001 | View Key Metrics | ✅ IMPLEMENTED | Live from real bookings: total, revenue, cancellation rate, unpaid count. |
| US-MGR-002 | View Revenue Analytics | ⚠️ PARTIAL | `RevenueCards` uses real API. **`RevenueAnalyticsChart` uses mock/hardcoded data.** No date range picker. |
| US-MGR-003 | View Therapist Utilization | ✅ IMPLEMENTED | `UtilizationPanel` with real data, per-therapist bars. |
| US-MGR-004 | View Booking Pipeline | ⚠️ PARTIAL | `BookingPipelineChart` uses **mock data**, not live bookings. |
| US-MGR-005 | View Real-time Booking Feed | ✅ IMPLEMENTED | Real bookings from parent. No Supabase Realtime subscriptions (refresh only). |
| US-MGR-006 | Export Daily Report | ✅ IMPLEMENTED | CSV with all sections, download button. |

---

## 09 — Audit & Compliance (`09-audit-compliance.md`)

| Story ID | Story Title | Status | Notes |
|----------|-------------|--------|-------|
| US-AUD-001 | Log Critical Booking Events | ⚠️ PARTIAL | `fetchAuditLogs()` API exists. **No `audit_logs` table in schema.sql. No automated triggers.** |
| US-AUD-002 | View Booking Audit Trail | ⚠️ PARTIAL | `AuditPanel.jsx` exists. Booking details timeline may use mock data. |
| US-AUD-003 | Lock Completed Bookings | ✅ IMPLEMENTED | DB trigger blocks status/amount changes on Completed bookings. |
| US-AUD-004 | View Admin Audit Dashboard | ⚠️ PARTIAL | Filters and pagination exist. **No export. No summary stats. Not admin-only route.** |

---

## 10 — Admin & Multi-Branch Operations (`10-admin-operations.md`)

| Story ID | Story Title | Status | Notes |
|----------|-------------|--------|-------|
| US-ADM-001 | Multi-Branch Overview | ⚠️ PARTIAL | BranchSwitcher works. **No consolidated comparison view.** One branch at a time. |
| US-ADM-002 | Manage Service Prices | ✅ IMPLEMENTED | Edit price/duration/description, admin-only, confirmation prompt. |
| US-ADM-003 | Unlimited Discount Authority | ⚠️ PARTIAL | `DISCOUNT_LIMITS.admin = Infinity` in API. **No discount UI.** |
| US-ADM-004 | Override System Locks | ❌ NOT IMPLEMENTED | No API or UI to reopen closed days, modify completed bookings, or override locks. |

---

## Summary

**Overall: 61% fully implemented (33/54 stories)**

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ Fully Implemented | 33 | 61% |
| ⚠️ Partially Implemented | 14 | 26% |
| ❌ Not Implemented | 4 | 7% |
| 🔴 Logic Contradiction | 1 | 2% |
| At least partial | 47 | 87% |

### The One Logic Contradiction

**US-CUS-003**: User story says customer name is the only required field. Implementation requires email, phone, and gender as mandatory. This directly contradicts the spec and blocks customers who don't want to share personal details.

**File:** `src/pages/customer-booking-flow/index.jsx:131-138`
