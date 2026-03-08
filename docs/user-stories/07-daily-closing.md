# 07 — Daily Closing & Reconciliation

> **Module:** Daily Closing & Reconciliation (F)
> **Primary Screen:** `/branch-manager-dashboard` — Reports view (planned)
> **Roles:** Manager, Admin

---

## US-DCR-001: Close the Day

**As a** manager,
**I want to** close the day and generate a reconciliation report,
**so that** the day's financials are locked and summarized — replacing the daily Excel report.

**Screen:** `/branch-manager-dashboard` — "Close Day" action (planned)

**Acceptance Criteria:**
- [ ] "Close Day" button available to Manager and Admin only
- [ ] Staff CANNOT close the day
- [ ] System calculates from bookings where `date = closing_date`:
  - **Gross Revenue:** `SUM(base_amount)` of Completed bookings
  - **Total Discounts:** `SUM(discount_amount)` of Completed bookings
  - **Net Revenue:** `SUM(final_amount)` of Completed bookings
- [ ] All revenue derived from `payment_status = 'paid'` bookings only
- [ ] Snapshot stored in `daily_reports` table (to be created)
- [ ] After close: previous day's bookings become locked from edits
- [ ] Confirmation prompt before closing
- [ ] Cannot close a day that is already closed

**Priority:** P0 — This IS the Excel replacement
**Phase:** 5 (Daily Closing)
**Status:** Not Started

---

## US-DCR-002: View Payment Mode Breakdown

**As a** manager,
**I want to** see revenue broken down by payment mode (Cash, Card, Fonepay),
**so that** I can reconcile cash drawer and digital payments.

**Screen:** `/branch-manager-dashboard` — Daily Close report (planned)

**Acceptance Criteria:**
- [ ] Breakdown shows for the closing day:
  - Cash total
  - Nabil (Card) total
  - GlobalIME (Card) total
  - NIC Asia (Card) total
  - Fonepay total
- [ ] Sum of all modes = Net Revenue
- [ ] Data sourced from `payments` table joined with `bookings`

**Priority:** P0
**Phase:** 5
**Status:** Not Started

---

## US-DCR-003: View Unpaid Bookings Report

**As a** manager,
**I want to** see all Completed bookings that are still unpaid,
**so that** I can follow up before closing the day.

**Screen:** `/branch-manager-dashboard` — Pending Payments section (planned)

**Acceptance Criteria:**
- [ ] List of bookings where `status = 'Completed'` AND `payment_status = 'unpaid'`
- [ ] Each shows: booking number, customer, service, final amount
- [ ] Action: navigate to booking details to record payment
- [ ] Count of unpaid bookings displayed prominently
- [ ] Warning shown if attempting to close day with unpaid Completed bookings

**Priority:** P0
**Phase:** 5
**Status:** Not Started

---

## US-DCR-004: View Booking Status Breakdown

**As a** manager,
**I want to** see how many bookings are in each status for the day,
**so that** I have a complete operational picture.

**Screen:** `/branch-manager-dashboard` — Daily Close report (planned)

**Acceptance Criteria:**
- [ ] Breakdown by status:
  - Confirmed (still pending service)
  - Completed
  - Cancelled
  - No Show
- [ ] Total booking count
- [ ] Cancellation rate = Cancelled / Total
- [ ] No Show rate = No Show / Total

**Priority:** P1
**Phase:** 5
**Status:** Not Started

---

## US-DCR-005: View Staff Discount Summary

**As a** manager,
**I want to** see a summary of all discounts applied today, grouped by staff member,
**so that** I can monitor discount patterns and prevent abuse.

**Screen:** `/branch-manager-dashboard` — Daily Close report (planned)

**Acceptance Criteria:**
- [ ] Table showing: staff name, discount count, total discount amount, average discount %
- [ ] Each discount shows: booking number, discount type, value, reason
- [ ] Only bookings for the closing day
- [ ] Data sourced from `bookings` where `discount_amount > 0`

**Priority:** P1
**Phase:** 5
**Status:** Not Started
