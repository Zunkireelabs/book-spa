# Phase 9: Platform Governance & Multi-Branch Enablement

## Approach
Stabilize the operational ERP first. No SaaS subscription logic, no plan limits, no edge functions (until 9C). Work strictly phase-by-phase.

---

## Phase 9A — Snapshot Architecture (Financial Integrity)

**Objective:** Protect historical financial data permanently by snapshotting display fields at booking time.

### 1. DB Migration — Add snapshot columns to bookings
- `service_name_snapshot` text NOT NULL
- `service_duration_snapshot` integer NOT NULL
- `service_price_snapshot` numeric(10,2) NOT NULL
- `therapist_name_snapshot` text
- `room_name_snapshot` text

Rules: Written only at creation/assignment time. Completed bookings remain immutable.

### 2. Update `createBooking()`
- Copy `service.name` → `service_name_snapshot`
- Copy `service.duration_minutes` → `service_duration_snapshot`
- Copy `service.price_npr` → `service_price_snapshot`

### 3. Update `assignTherapist()`
- Copy `therapist.name` → `therapist_name_snapshot`
- Copy `room.name` → `room_name_snapshot`

### 4. CSV + Reporting
- Update `getDailyOperationalReport()` and `exportDailyReportCSV()` to use snapshot fields instead of joined live data

### 5. Verification
- Create booking → change service price → verify old booking retains original price
- Export CSV and confirm consistency

---

## Phase 9B — Master Data Management (Branch Level)

**Objective:** Allow operational control of Rooms, Therapists, Services. No SaaS plan logic.

### 1. Room Management Panel (Manager + Admin)
- List, add, edit name, activate/deactivate
- Prevent delete if historical bookings exist

### 2. Therapist Management Panel (Manager + Admin)
- Add, edit, activate/deactivate
- Prevent delete if historical bookings exist

### 3. Service Management Panel (Admin only)
- View, edit price, edit duration, activate/deactivate
- No delete. Must not affect historical bookings (snapshot protects this)

---

## Phase 9C — User Management

**Objective:** Operational user creation without breaking auth.

- Manager: can create staff for own branch
- Admin: can create manager or staff, assign branch
- Use secure server-side pattern (Edge Function allowed here)
- No plan limits or branch subscription logic

---

## Phase 9D — Admin Branch Context Switching

**Objective:** Admin can view any branch's data.

- Admin sees branch selector in header
- Selection stored in localStorage
- API calls use `contextBranchId` (admin) or `profile.branch_id` (manager/staff)
- Manager and Staff have no selector

---

## Critical Constraints (DO NOT TOUCH)
- Booking immutability triggers
- Payment immutability
- Daily closing system
- GIST exclusion constraints
- Financial calculation triggers
- Discount limits

## Pre-Implementation Checklist (Each Phase)
1. State affected tables
2. Confirm immutability compliance
3. Confirm branch isolation
4. Confirm audit safety
5. Identify financial risk
