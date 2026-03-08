# 01 — Customer Booking Flow

> **Module:** Booking Engine (A)
> **Primary Screen:** `/customer-booking-flow`
> **Roles:** Customer (unauthenticated)

---

## US-CUS-001: Browse Available Services

**As a** customer,
**I want to** see a list of available spa services with prices and durations,
**so that** I can choose the treatment that suits me.

**Screen:** `/customer-booking-flow` — Service Selection step

**Acceptance Criteria:**
- [ ] All active services load from the database (not hardcoded)
- [ ] Each service displays: name, description, duration (minutes), price (NPR)
- [ ] Services can be filtered by category
- [ ] Inactive services are not shown
- [ ] Loading state shown while fetching

**Priority:** P0
**Phase:** 3 (API Layer)
**Status:** Implemented

---

## US-CUS-002: Select Date and Time

**As a** customer,
**I want to** choose a date and time slot for my booking,
**so that** I can schedule my visit at a convenient time.

**Screen:** `/customer-booking-flow` — Date/Time Selection step

**Acceptance Criteria:**
- [ ] Calendar shows available dates (today and future only)
- [ ] Time slots are displayed for the selected date
- [ ] Past time slots for today are disabled
- [ ] Time slot selection is clearly highlighted

**Priority:** P0
**Phase:** 3
**Status:** Implemented

---

## US-CUS-003: Provide Personal Details

**As a** customer,
**I want to** enter my name, phone, email, and preferences,
**so that** the spa can prepare for my visit.

**Screen:** `/customer-booking-flow` — Customer Details step

**Acceptance Criteria:**
- [ ] Required fields: customer name
- [ ] Optional fields: email, phone, gender preference, special requests
- [ ] Form validates before proceeding
- [ ] Gender preference options available (for therapist matching)

**Priority:** P0
**Phase:** 3
**Status:** Implemented

---

## US-CUS-004: Review and Confirm Booking

**As a** customer,
**I want to** review my booking details before confirming,
**so that** I can verify everything is correct.

**Screen:** `/customer-booking-flow` — Confirmation step

**Acceptance Criteria:**
- [ ] Displays: service name, date, time, duration, price, customer info
- [ ] "Confirm Booking" button submits to the database
- [ ] Room is auto-assigned (customer does not choose)
- [ ] On success: booking confirmation with booking number (BK-YYYYMMDD-XXXX)
- [ ] On ROOMS_FULL error: friendly message shown, no booking created
- [ ] Base amount is snapshotted from service price at booking time

**Priority:** P0
**Phase:** 3
**Status:** Implemented

---

## US-CUS-005: Receive Booking Confirmation

**As a** customer,
**I want to** see a confirmation screen with my booking number,
**so that** I know my appointment is secured.

**Screen:** `/customer-booking-flow` — Success state

**Acceptance Criteria:**
- [ ] Booking number displayed prominently (BK-YYYYMMDD-XXXX)
- [ ] Service, date, time, and branch details shown
- [ ] Option to return to home page

**Priority:** P0
**Phase:** 3
**Status:** Implemented

---

## US-CUS-006: Manage My Booking

**As a** customer,
**I want to** look up my booking and see its status,
**so that** I can track or modify my appointment.

**Screen:** `/booking-management-portal`

**Acceptance Criteria:**
- [ ] Search by booking number or phone number
- [ ] Display booking card with status badge (Pending, Confirmed, Completed, Cancelled)
- [ ] Show booking history for repeat customers
- [ ] Reschedule option for Confirmed bookings (before start time)
- [ ] Cancel option for Confirmed bookings (before start time)

**Priority:** P1
**Phase:** 3
**Status:** Partial — UI exists with mock data, search/lookup not wired to live DB
