# 03 — Staff Booking Operations

> **Module:** Booking Engine (A), Room Allocation (C)
> **Primary Screen:** `/branch-staff-dashboard`
> **Roles:** Staff, Manager, Admin

---

## US-SBO-001: View Today's Bookings

**As a** staff member,
**I want to** see all of today's bookings for my branch,
**so that** I can manage the day's schedule.

**Screen:** `/branch-staff-dashboard` — Bookings List (center column)

**Acceptance Criteria:**
- [ ] Bookings load from database filtered by branch_id and today's date
- [ ] Each booking card shows: booking number, customer name, service, time, status badge
- [ ] Bookings sorted by start time
- [ ] Loading spinner while fetching
- [ ] Empty state when no bookings exist
- [ ] Status counts displayed (Pending, Confirmed, In-Progress, Completed)

**Priority:** P0
**Phase:** 3 (API Layer)
**Status:** Implemented

---

## US-SBO-002: Filter and Search Bookings

**As a** staff member,
**I want to** filter bookings by status, service type, or search by name/phone,
**so that** I can quickly find a specific booking.

**Screen:** `/branch-staff-dashboard` — Quick Filters (left sidebar)

**Acceptance Criteria:**
- [ ] Filter by status: All, Pending, Confirmed, In-Progress, Completed
- [ ] Filter by service type category
- [ ] Search by customer name, phone, email, or booking number
- [ ] Filters apply immediately (no submit button needed)
- [ ] Booking count badges update with filter results

**Priority:** P1
**Phase:** 3
**Status:** Implemented

---

## US-SBO-003: Create Walk-in Booking

**As a** staff member,
**I want to** create a booking for a walk-in customer,
**so that** all revenue goes through the booking system.

**Screen:** `/branch-staff-dashboard` — Quick Booking action (planned)

**Acceptance Criteria:**
- [ ] Select service from dropdown (active services only)
- [ ] Enter customer name (required), phone (optional)
- [ ] Select start time
- [ ] Room auto-assigned — staff does not choose room
- [ ] Base amount snapshotted from service price
- [ ] Booking created with status "Confirmed" (skip Pending for walk-ins)
- [ ] `created_by` set to authenticated user's ID
- [ ] On ROOMS_FULL: structured error displayed
- [ ] Success: booking appears in today's list immediately

**Priority:** P0
**Phase:** 3
**Status:** Not Started — `createBooking()` API exists but no staff-facing creation form

---

## US-SBO-004: View Booking Details

**As a** staff member,
**I want to** open a booking and see all its details,
**so that** I can review customer info, service details, and take action.

**Screen:** `/booking-details-assignment-modal` — Details tab

**Acceptance Criteria:**
- [ ] Opens from booking card click on staff dashboard
- [ ] Displays: booking number, status, customer info, service details, price, date/time
- [ ] Shows special requests if present
- [ ] Shows assigned therapist if any
- [ ] Shows payment status (Paid / Unpaid)
- [ ] Quick action buttons (Call, Email, SMS, Reschedule)

**Priority:** P0
**Phase:** 3
**Status:** Partial — UI exists with mock data, not wired to live booking

---

## US-SBO-005: Update Booking Status

**As a** staff member,
**I want to** change a booking's status through its lifecycle,
**so that** the operational flow is tracked accurately.

**Screen:** `/booking-details-assignment-modal` — Details tab, status buttons

**Acceptance Criteria:**
- [ ] Status buttons: Confirmed, Pending, Cancelled, Completed
- [ ] Valid transitions enforced:
  - Pending → Confirmed
  - Confirmed → In-Progress
  - In-Progress → Completed
  - Confirmed → Cancelled (before start time)
  - Confirmed → No Show (after grace period)
- [ ] Status update persists to database
- [ ] Cannot change status of Completed bookings (financially locked)
- [ ] Cannot change status of Cancelled bookings
- [ ] UI reflects new status immediately

**Priority:** P0
**Phase:** 3
**Status:** Not Started — buttons exist but call mock handler, no DB persistence

---

## US-SBO-006: View Therapist Availability

**As a** staff member,
**I want to** see which therapists are available right now,
**so that** I can assign them to bookings.

**Screen:** `/branch-staff-dashboard` — Therapist Availability (right sidebar)

**Acceptance Criteria:**
- [ ] Lists all active therapists for the branch
- [ ] Shows status: Available, Busy, On Break
- [ ] Therapist gender and specialties visible
- [ ] Busy therapists show current booking info
- [ ] Data loads from database

**Priority:** P1
**Phase:** 3
**Status:** Partial — therapist list loads from DB, status logic is mock

---

## US-SBO-007: Room Auto-Assignment Feedback

**As a** staff member,
**I want to** see which room was assigned to a booking,
**so that** I can direct the customer to the right room.

**Screen:** `/booking-details-assignment-modal` — Details tab

**Acceptance Criteria:**
- [ ] Room name displayed on booking details
- [ ] Room assigned automatically at booking creation (GIST exclusion prevents overlap)
- [ ] If no rooms available: ROOMS_FULL error shown at booking creation time
- [ ] Staff cannot manually change room assignment (system-managed)

**Priority:** P1
**Phase:** 3
**Status:** Partial — room data included in booking fetch, display exists in mock UI

---

## US-SBO-008: Booking Number Display

**As a** staff member,
**I want to** see a human-readable booking number (BK-YYYYMMDD-XXXX),
**so that** I can reference bookings easily with customers.

**Screen:** `/branch-staff-dashboard` — Booking cards, `/booking-details-assignment-modal`

**Acceptance Criteria:**
- [ ] Booking number auto-generated by DB trigger
- [ ] Format: BK-YYYYMMDD-XXXX (e.g., BK-20260213-0001)
- [ ] Sequential per day
- [ ] Displayed as primary identifier in all booking views
- [ ] Unique across all bookings

**Priority:** P0
**Phase:** 1 (Schema)
**Status:** Implemented — trigger generates, transformer maps to `id` field
