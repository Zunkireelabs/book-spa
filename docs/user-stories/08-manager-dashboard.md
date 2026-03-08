# 08 — Manager Dashboard & Reporting

> **Module:** Reporting & Analytics (G)
> **Primary Screen:** `/branch-manager-dashboard`
> **Roles:** Manager, Admin

---

## US-MGR-001: View Key Metrics

**As a** manager,
**I want to** see today's key metrics at a glance (bookings, revenue, cancellation rate),
**so that** I can assess branch performance immediately.

**Screen:** `/branch-manager-dashboard` — Metrics cards (top row)

**Acceptance Criteria:**
- [ ] Today's Bookings: count of all bookings for today
- [ ] Daily Revenue: `SUM(final_amount)` where `payment_status = 'paid'` and `date = today`
- [ ] Cancellation Rate: Cancelled / Total bookings today
- [ ] Each metric shows % change vs. previous day (or week)
- [ ] Data sourced from live database — NOT hardcoded
- [ ] Currency displayed as NPR

**Priority:** P0
**Phase:** 5 (requires live revenue data)
**Status:** Partial — UI cards exist with mock data, not wired to live queries

---

## US-MGR-002: View Revenue Analytics

**As a** manager,
**I want to** see revenue trends and breakdowns,
**so that** I can identify performance patterns.

**Screen:** `/branch-manager-dashboard` — Revenue Analytics Chart

**Acceptance Criteria:**
- [ ] Revenue trend chart (hourly accumulation for today, or daily for date range)
- [ ] Revenue by service breakdown (which services generate most revenue)
- [ ] Peak hours chart (booking volume by hour)
- [ ] All revenue calculated from `bookings` where `payment_status = 'paid'` ONLY
- [ ] Unpaid bookings excluded from revenue totals
- [ ] Date range picker to adjust reporting period

**Priority:** P1
**Phase:** 5
**Status:** Partial — charts exist with mock data, not wired to live queries

---

## US-MGR-003: View Therapist Utilization

**As a** manager,
**I want to** see how utilized each therapist is today,
**so that** I can optimize scheduling and identify underutilized staff.

**Screen:** `/branch-manager-dashboard` — Therapist Utilization Chart

**Acceptance Criteria:**
- [ ] Each therapist shows: bookings assigned, hours booked, utilization %
- [ ] Utilization = booked hours / available hours
- [ ] Visual chart (bar or radial)
- [ ] Data sourced from `bookings` joined with `therapists`

**Priority:** P1
**Phase:** 5
**Status:** Partial — chart component exists with mock data

---

## US-MGR-004: View Booking Pipeline

**As a** manager,
**I want to** see the booking pipeline (upcoming, in-progress, completed),
**so that** I can monitor operational flow in real time.

**Screen:** `/branch-manager-dashboard` — Booking Pipeline Chart

**Acceptance Criteria:**
- [ ] Visual pipeline showing count per status stage
- [ ] Pending → Confirmed → In-Progress → Completed
- [ ] Cancelled and No Show shown separately
- [ ] Updates when bookings change status
- [ ] Data from today's bookings for the branch

**Priority:** P1
**Phase:** 5
**Status:** Partial — chart component exists with mock data

---

## US-MGR-005: View Real-time Booking Feed

**As a** manager,
**I want to** see a live feed of booking activity,
**so that** I can react to new bookings and status changes immediately.

**Screen:** `/branch-manager-dashboard` — Realtime Booking Feed

**Acceptance Criteria:**
- [ ] Shows recent booking events: created, confirmed, started, completed, cancelled
- [ ] Most recent events at top
- [ ] Each event shows: time, booking number, customer name, action
- [ ] Quick actions: assign therapist, update status directly from feed
- [ ] Consider Supabase Realtime subscriptions for live updates

**Priority:** P2
**Phase:** 5+
**Status:** Partial — feed component exists with mock data

---

## US-MGR-006: Export Daily Report

**As a** manager,
**I want to** export the daily report as CSV or printable format,
**so that** I can share it with ownership and keep physical records.

**Screen:** `/branch-manager-dashboard` — Export button

**Acceptance Criteria:**
- [ ] Export button in date range picker or daily close report
- [ ] CSV format with columns matching current Excel template
- [ ] Print-friendly layout option
- [ ] Includes: date, gross revenue, discounts, net revenue, payment mode breakdown, booking count

**Priority:** P1
**Phase:** 5
**Status:** Not Started
