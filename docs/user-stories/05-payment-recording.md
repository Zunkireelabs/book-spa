# 05 — Payment Recording (Phase 4)

> **Module:** Payment & Collection Engine (E)
> **Primary Screen:** `/booking-details-assignment-modal` — Details tab
> **Roles:** Staff, Manager, Admin

---

## US-PAY-001: Record Payment for Confirmed Booking

**As a** staff member,
**I want to** record a payment for a Confirmed booking,
**so that** revenue is captured when the customer pays at the counter.

**Screen:** `/booking-details-assignment-modal` — Details tab → Payment Modal

**Acceptance Criteria:**
- [ ] "Record Payment" button visible on booking with `payment_status = 'unpaid'` AND `status = 'Confirmed'`
- [ ] Clicking opens Payment Modal
- [ ] Modal shows read-only: base amount, discount, final amount (NPR)
- [ ] Payment mode dropdown: Cash, Nabil (Card), GlobalIME (Card), NIC Asia (Card), Fonepay
- [ ] Optional notes field
- [ ] On confirm: payment inserted into `payments` table
- [ ] `amount` = `booking.final_amount` (from DB, not editable)
- [ ] `recorded_by` = authenticated user ID
- [ ] DB trigger auto-updates `booking.payment_status` to `paid`
- [ ] Success toast shown
- [ ] Button disabled/hidden after successful payment
- [ ] Page refresh: payment persists, booking shows as paid

**Priority:** P0
**Phase:** 4
**Status:** Implemented

---

## US-PAY-002: Record Payment for Completed Booking

**As a** staff member,
**I want to** record a payment for a Completed booking,
**so that** late payments are captured before daily close.

**Screen:** `/booking-details-assignment-modal` — Details tab → Payment Modal

**Acceptance Criteria:**
- [ ] "Record Payment" button visible on booking with `payment_status = 'unpaid'` AND `status = 'Completed'`
- [ ] Same payment flow as US-PAY-001
- [ ] Completed bookings that are unpaid appear in "unpaid" reports

**Priority:** P0
**Phase:** 4
**Status:** Implemented

---

## US-PAY-003: Block Payment for Invalid Booking States

**As the** system,
**I want to** prevent payment recording for Pending, Cancelled, or No Show bookings,
**so that** revenue integrity is maintained.

**Screen:** `/booking-details-assignment-modal` — Details tab

**Acceptance Criteria:**
- [ ] "Record Payment" button NOT visible when `status = 'Pending'`
- [ ] "Record Payment" button NOT visible when `status = 'Cancelled'`
- [ ] "Record Payment" button NOT visible when `status = 'No Show'` (future)
- [ ] API returns structured error `INVALID_PAYMENT_STATE` if attempted programmatically
- [ ] Error message: "Payment can only be recorded for Confirmed or Completed bookings."

**Priority:** P0
**Phase:** 4
**Status:** Implemented

---

## US-PAY-004: Block Duplicate Payment

**As the** system,
**I want to** prevent recording a second payment for the same booking,
**so that** financial records remain accurate.

**Screen:** `/booking-details-assignment-modal` — Details tab → Payment Modal

**Acceptance Criteria:**
- [ ] `payments.booking_id` has UNIQUE constraint — DB-level enforcement
- [ ] API pre-checks `booking.payment_status` before insert
- [ ] If duplicate attempted via API: returns `ALREADY_PAID` error
- [ ] If unique constraint violated (race condition): catches Postgres error `23505`, returns `ALREADY_PAID`
- [ ] Error message: "Payment has already been recorded for this booking."
- [ ] "Record Payment" button not shown when `payment_status = 'paid'`

**Priority:** P0
**Phase:** 4
**Status:** Implemented

---

## US-PAY-005: Payment Immutability

**As the** system,
**I want to** prevent editing or deleting payment records,
**so that** financial audit trail is preserved.

**Screen:** N/A — database enforcement, no UI needed

**Acceptance Criteria:**
- [ ] No UPDATE RLS policy on `payments` table
- [ ] No DELETE RLS policy on `payments` table
- [ ] `booking_id` FK has `ON DELETE RESTRICT` — booking cannot be deleted if payment exists
- [ ] No "edit payment" or "delete payment" UI anywhere in the application
- [ ] Payment amount is set from `booking.final_amount` at recording time — not user-editable

**Priority:** P0
**Phase:** 4
**Status:** Implemented

---

## US-PAY-006: Payment Status Visibility

**As a** staff member,
**I want to** see whether a booking is paid or unpaid at a glance,
**so that** I can identify outstanding payments.

**Screen:** `/booking-details-assignment-modal` — Details tab (Payment section)

**Acceptance Criteria:**
- [ ] Payment section in booking details shows status badge:
  - Paid: green badge with checkmark
  - Unpaid: orange/warning badge with clock icon
- [ ] Amount due displayed
- [ ] After payment recorded: badge updates to "Paid" without page refresh
- [ ] Payment status included in booking data transformer (`paymentStatus` field)

**Priority:** P0
**Phase:** 4
**Status:** Implemented
