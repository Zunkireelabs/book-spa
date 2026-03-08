# 10 — Admin & Multi-Branch Operations

> **Module:** Role & Permission Control (H), Multi-Branch Scalability
> **Primary Screen:** Admin dashboard (planned, no route yet)
> **Roles:** Admin

---

## US-ADM-001: Multi-Branch Overview

**As an** admin,
**I want to** see a consolidated view across all branches,
**so that** I can compare performance and identify issues.

**Screen:** Admin dashboard (planned)

**Acceptance Criteria:**
- [ ] Branch selector or multi-branch view
- [ ] Key metrics per branch: bookings, revenue, cancellation rate
- [ ] Comparison table or chart across branches
- [ ] Admin can drill down into any branch's dashboard
- [ ] All tables include `branch_id` — already enforced in schema

**Priority:** P2
**Phase:** 8 (Multi-Branch)
**Status:** Not Started

---

## US-ADM-002: Manage Service Prices

**As an** admin,
**I want to** change service prices,
**so that** pricing stays competitive and reflects costs.

**Screen:** Admin settings (planned)

**Acceptance Criteria:**
- [ ] List all services with current prices
- [ ] Edit `price_npr` for a service
- [ ] Price change does NOT affect existing bookings (they snapshot `base_amount`)
- [ ] Price change logged in audit trail
- [ ] Only Admin role can change prices
- [ ] Confirmation prompt before saving

**Priority:** P1
**Phase:** 8
**Status:** Not Started

---

## US-ADM-003: Unlimited Discount Authority

**As an** admin,
**I want to** apply any discount amount without limit,
**so that** I can handle exceptional situations (VIPs, complaints, promotions).

**Screen:** `/booking-details-assignment-modal` — Discount section (planned)

**Acceptance Criteria:**
- [ ] No percentage or amount cap for admin role
- [ ] Same discount form as staff/manager
- [ ] Discount reason still required
- [ ] Logged in audit trail
- [ ] `discount_status` = `approved`, `discount_approved_by` = admin ID

**Priority:** P1
**Phase:** 6 (Discount + Permissions)
**Status:** Not Started

---

## US-ADM-004: Override System Locks

**As an** admin,
**I want to** override financial locks in exceptional cases,
**so that** corrections can be made when necessary.

**Screen:** Admin controls (planned)

**Acceptance Criteria:**
- [ ] Admin can reopen a closed day (with audit trail)
- [ ] Admin can modify a Completed booking's discount (with audit trail)
- [ ] Every override logged with reason
- [ ] Confirmation prompt with warning message
- [ ] These actions should be rare — system tracks override frequency

**Priority:** P2
**Phase:** 8
**Status:** Not Started
