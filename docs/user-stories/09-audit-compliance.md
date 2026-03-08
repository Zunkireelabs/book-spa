# 09 — Audit & Compliance

> **Module:** Audit & Compliance Layer (I)
> **Primary Screen:** `/branch-manager-dashboard` — Audit section (planned)
> **Roles:** Manager (view branch), Admin (view all)

---

## US-AUD-001: Log Critical Booking Events

**As the** system,
**I want to** automatically log critical events on bookings,
**so that** all financial and operational changes are traceable.

**Screen:** N/A — database enforcement (audit_logs table, planned)

**Acceptance Criteria:**
- [ ] Audit table created: `audit_logs` with fields:
  - `id` (UUID)
  - `booking_id` (FK to bookings)
  - `action_type` (enum: discount_applied, payment_recorded, booking_cancelled, day_closed, price_changed)
  - `old_value` (JSONB)
  - `new_value` (JSONB)
  - `changed_by` (FK to users)
  - `changed_at` (timestamptz, default now())
- [ ] Events logged automatically via triggers:
  - Discount applied or changed
  - Payment recorded
  - Booking cancelled
  - Day closed
  - Service price changed
- [ ] Audit records are immutable (INSERT only, no UPDATE/DELETE)

**Priority:** P1
**Phase:** 7 (Audit & Lock)
**Status:** Not Started

---

## US-AUD-002: View Booking Audit Trail

**As a** manager,
**I want to** see the full audit trail for a specific booking,
**so that** I can investigate discrepancies or customer complaints.

**Screen:** `/booking-details-assignment-modal` — Timeline tab

**Acceptance Criteria:**
- [ ] Timeline tab shows all audit events for the booking
- [ ] Each event shows: timestamp, action type, who made the change, old → new values
- [ ] Events in chronological order (newest first)
- [ ] Data sourced from `audit_logs` table
- [ ] Currently shows mock timeline data — replace with live data

**Priority:** P1
**Phase:** 7
**Status:** Partial — Timeline UI exists with mock data, no audit_logs table yet

---

## US-AUD-003: Lock Completed Bookings

**As the** system,
**I want to** prevent financial changes to Completed bookings,
**so that** revenue records are immutable.

**Screen:** N/A — database enforcement

**Acceptance Criteria:**
- [ ] Once `status = 'Completed'`:
  - `base_amount` cannot be changed
  - `discount_amount` cannot be changed
  - `final_amount` cannot be changed (it's trigger-computed anyway)
  - Status cannot revert to Pending or Confirmed
- [ ] Booking can still receive payment (Completed + Unpaid → Completed + Paid)
- [ ] Enforced at DB level (trigger or RLS check on UPDATE)
- [ ] UI disables financial edit controls for Completed bookings

**Priority:** P0
**Phase:** 7
**Status:** Not Started

---

## US-AUD-004: View Admin Audit Dashboard

**As an** admin,
**I want to** view audit logs across all branches,
**so that** I can monitor system-wide financial integrity.

**Screen:** Admin dashboard (planned, no route yet)

**Acceptance Criteria:**
- [ ] Admin-only accessible
- [ ] Filterable by: date range, branch, action type, user
- [ ] Sortable by timestamp
- [ ] Export capability (CSV)
- [ ] Summary statistics: total events, events by type, events by user

**Priority:** P2
**Phase:** 7
**Status:** Not Started
