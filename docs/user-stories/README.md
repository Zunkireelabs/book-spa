# BookSpa User Stories Index

> **Version:** 1.0
> **Last Updated:** 2026-02-13
> **Owner:** Zunkiree Labs

---

## How to Read These Stories

Each story follows this format:

| Field | Description |
|-------|-------------|
| **ID** | `US-{MODULE}-{NNN}` — unique identifier |
| **Title** | Short summary |
| **Story** | As a [role], I want [action] so that [benefit] |
| **Screen** | Route path where the story is experienced |
| **Acceptance Criteria** | Testable conditions (checkbox format) |
| **Priority** | P0 = launch blocker, P1 = needed for Excel replacement, P2 = nice to have |
| **Phase** | Which implementation phase it belongs to |
| **Status** | Implemented / Partial / Not Started |

---

## Roles

| Role | Description | Login Required |
|------|-------------|----------------|
| **Customer** | Public user booking a spa service | No |
| **Staff** | Branch front-desk operator | Yes — `/staff-login-authentication` |
| **Manager** | Branch manager with oversight & closing authority | Yes — `/staff-login-authentication` |
| **Admin** | System administrator, multi-branch access | Yes — `/staff-login-authentication` |

---

## Screen Map

| Screen | Route | Access |
|--------|-------|--------|
| Customer Booking Flow | `/` or `/customer-booking-flow` | Public |
| Staff Login | `/staff-login-authentication` | Public |
| Staff Dashboard | `/branch-staff-dashboard` | Staff, Manager, Admin |
| Manager Dashboard | `/branch-manager-dashboard` | Manager, Admin |
| Booking Details Modal | `/booking-details-assignment-modal` | Staff, Manager, Admin |
| Booking Management Portal | `/booking-management-portal` | Staff, Manager, Admin |

---

## Story Files

| # | File | Module | Stories |
|---|------|--------|---------|
| 1 | [01-customer-booking.md](./01-customer-booking.md) | Customer Booking Flow | 6 stories |
| 2 | [02-authentication.md](./02-authentication.md) | Authentication & Access | 5 stories |
| 3 | [03-staff-booking-ops.md](./03-staff-booking-ops.md) | Staff Booking Operations | 8 stories |
| 4 | [04-therapist-assignment.md](./04-therapist-assignment.md) | Therapist Assignment | 4 stories |
| 5 | [05-payment-recording.md](./05-payment-recording.md) | Payment Recording (Phase 4) | 6 stories |
| 6 | [06-discount-engine.md](./06-discount-engine.md) | Pricing & Discount Engine | 6 stories |
| 7 | [07-daily-closing.md](./07-daily-closing.md) | Daily Closing & Reconciliation | 5 stories |
| 8 | [08-manager-dashboard.md](./08-manager-dashboard.md) | Manager Dashboard & Reporting | 6 stories |
| 9 | [09-audit-compliance.md](./09-audit-compliance.md) | Audit & Compliance | 4 stories |
| 10 | [10-admin-operations.md](./10-admin-operations.md) | Admin & Multi-Branch | 4 stories |

**Total: 54 user stories**

---

## Status Summary

| Status | Count | Notes |
|--------|-------|-------|
| Implemented | 14 | Auth, service display, booking creation, room auto-assign, payment recording |
| Partial | 8 | Dashboard views exist with mock data, booking details uses mock |
| Not Started | 32 | Discount engine, daily close, audit, admin, real-time dashboard data |

---

## Phase Mapping

| Phase | Description | Stories |
|-------|-------------|---------|
| 1 | Database Schema | Infrastructure — no direct user stories |
| 2 | Auth & Client | US-AUTH-001 through US-AUTH-005 |
| 3 | API Layer | US-SBO-001 through US-SBO-003 (fetch bookings, services) |
| 4 | Payment Recording | US-PAY-001 through US-PAY-006 |
| 5 | Daily Closing | US-DCR-001 through US-DCR-005 |
| 6 | Discount + Permissions | US-DSC-001 through US-DSC-006 |
| 7 | Audit & Lock | US-AUD-001 through US-AUD-004 |
| 8 | Multi-Branch | US-ADM-001 through US-ADM-004 |
