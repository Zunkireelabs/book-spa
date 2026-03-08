# 06 — Pricing & Discount Engine

> **Module:** Pricing & Discount Engine (B)
> **Primary Screen:** `/booking-details-assignment-modal` — Details tab
> **Roles:** Staff, Manager, Admin

---

## US-DSC-001: Apply Small Discount (Staff)

**As a** staff member,
**I want to** apply a discount of up to 5% on a booking,
**so that** I can handle minor price adjustments within my authority.

**Screen:** `/booking-details-assignment-modal` — Discount section (planned)

**Acceptance Criteria:**
- [ ] Discount form accessible on unpaid, non-completed bookings
- [ ] Discount type selection: Percentage or Fixed Amount
- [ ] Staff limited to max 5% (or equivalent fixed amount)
- [ ] If exceeded: system blocks with structured error
- [ ] Discount reason required (text field)
- [ ] `discount_applied_by` set to authenticated user
- [ ] `discount_status` set to `approved` (within-limit auto-approval)
- [ ] `final_amount` recomputed by DB trigger (`base_amount - discount_amount`)
- [ ] `final_amount` is NEVER directly editable

**Priority:** P1
**Phase:** 6 (Discount + Permissions)
**Status:** Not Started

---

## US-DSC-002: Apply Higher Discount (Manager)

**As a** manager,
**I want to** apply a discount of up to 30% on a booking,
**so that** I can handle special situations within my authority.

**Screen:** `/booking-details-assignment-modal` — Discount section (planned)

**Acceptance Criteria:**
- [ ] Same form as US-DSC-001
- [ ] Manager can apply up to 30%
- [ ] Role check against `users.role` — not a frontend-only check
- [ ] Discount reason required
- [ ] `discount_approved_by` set to authenticated user
- [ ] `discount_status` = `approved`

**Priority:** P1
**Phase:** 6
**Status:** Not Started

---

## US-DSC-003: Request Discount Above Limit

**As a** staff member,
**I want to** request a discount above my 5% limit,
**so that** a manager can review and approve it.

**Screen:** `/booking-details-assignment-modal` — Discount section (planned)

**Acceptance Criteria:**
- [ ] If discount exceeds staff limit: `discount_status` set to `pending`
- [ ] Discount not applied to `final_amount` until approved
- [ ] Booking flagged as "Discount Pending" in manager view
- [ ] Notification or visual indicator for manager
- [ ] `discount_approved_by` remains null until approved

**Priority:** P1
**Phase:** 6
**Status:** Not Started

---

## US-DSC-004: Approve or Reject Discount Request

**As a** manager,
**I want to** approve or reject pending discount requests,
**so that** pricing integrity is maintained.

**Screen:** `/branch-manager-dashboard` — Alerts/Notifications panel (planned)

**Acceptance Criteria:**
- [ ] List of bookings with `discount_status = 'pending'`
- [ ] Each shows: booking number, customer, service, requested discount %, reason
- [ ] Approve: sets `discount_status = 'approved'`, `discount_approved_by` = manager ID, `discount_amount` applied, `final_amount` recomputed
- [ ] Reject: resets `discount_status = 'none'`, `discount_amount = 0` (clean state, no "rejected" status)
- [ ] CHECK constraint: `discount_status = 'approved'` requires `discount_approved_by IS NOT NULL`

**Priority:** P1
**Phase:** 6
**Status:** Not Started

---

## US-DSC-005: Price Snapshot at Booking Time

**As the** system,
**I want to** capture the service price at the time of booking,
**so that** future price changes don't affect existing bookings.

**Screen:** N/A — database enforcement

**Acceptance Criteria:**
- [ ] `base_amount` on booking = `services.price_npr` at insert time
- [ ] Subsequent changes to `services.price_npr` do NOT affect existing bookings
- [ ] `base_amount` CHECK constraint: must be > 0
- [ ] `final_amount` = `base_amount - discount_amount` (enforced by trigger + CHECK)

**Priority:** P0
**Phase:** 1 (Schema)
**Status:** Implemented

---

## US-DSC-006: Prevent Direct Price Editing

**As the** system,
**I want to** prevent anyone from directly editing `final_amount`,
**so that** all pricing changes go through the structured discount system.

**Screen:** N/A — database enforcement

**Acceptance Criteria:**
- [ ] No UI input for `final_amount` — always displayed read-only
- [ ] `final_amount` computed by `compute_final_amount()` trigger on INSERT/UPDATE of `base_amount` or `discount_amount`
- [ ] CHECK constraint: `final_amount = base_amount - discount_amount`
- [ ] If check fails: insert/update rejected at DB level

**Priority:** P0
**Phase:** 1 (Schema)
**Status:** Implemented
