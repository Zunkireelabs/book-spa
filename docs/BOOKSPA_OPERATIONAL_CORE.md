# BookSpa - Operational Core Specification v1.0

> **Status:** Production Blueprint
> **Owner:** Zunkiree Labs
> **Scope:** Branch Operations ERP (Customer Booking Included)

---

## 1. System Vision

BookSpa is a **Branch-Level Operational ERP** that replaces daily Excel-based booking, revenue, and reconciliation workflows — while supporting public booking and multi-branch scalability from Day One.

### Primary Objective (Phase 1)
- Replace daily Excel sales report within 30 days
- Provide operational dashboard approved by client
- Enable manager-level daily reconciliation
- Prevent revenue leakage

### Secondary Objective
- Support public booking engine integrated with branch operations

---

## 2. Core System Philosophy

1. **Booking is the source of truth.** No revenue exists outside bookings.
2. **Final price cannot be manually overridden.**
3. **All discounts must be structured and auditable.**
4. **Daily closing must be system-calculated.**
5. **All actions must be role-based and traceable.**
6. **Multi-branch support built into schema from day one.**

---

## 3. Operational Core Modules

| Module | Name |
|--------|------|
| A | Booking Engine |
| B | Pricing & Discount Engine |
| C | Room & Resource Allocation |
| D | Therapist Assignment Engine |
| E | Payment & Collection Engine |
| F | Daily Closing & Reconciliation |
| G | Reporting & Analytics |
| H | Role & Permission Control |
| I | Audit & Compliance Layer |

---

## 4. Booking Engine

### Booking States

```
Pending → Confirmed → In Progress → Completed
                  ↘ Cancelled
                  ↘ No Show
```

### State Transition Rules

| From | To | Trigger |
|------|----|---------|
| Pending | Confirmed | Manual confirm or auto-confirm rule |
| Confirmed | In Progress | At service start |
| In Progress | Completed | Service ends |
| Confirmed | Cancelled | Before start time |
| Confirmed | No Show | Not arrived within grace period |

**Once Completed:** booking becomes financially locked — price and discount are immutable.

### Booking Data Model (Core Fields)

| Field | Notes |
|-------|-------|
| `id` | UUID primary key |
| `booking_number` | Format: `BK-YYYY-XXX` |
| `branch_id` | FK to branches |
| `customer_name` | |
| `customer_phone` | |
| `customer_email` | |
| `service_id` | FK to services |
| `therapist_id` | Nullable — can be assigned later |
| `room_id` | FK to rooms |
| `date` | Booking date |
| `start_time` | |
| `end_time` | **Derived by trigger** |
| `status` | Booking state enum |
| `base_amount` | Snapshotted from service price |
| `discount_type` | percentage / fixed |
| `discount_value` | |
| `discount_reason` | Required when discount applied |
| `discount_applied_by` | FK to users |
| `final_amount` | **Derived by trigger** (`base - discount`) |
| `payment_status` | unpaid / paid |
| `payment_mode` | cash / card / fonepay / online |
| `collected_by` | FK to users |
| `collected_at` | Timestamp |
| `created_by` | FK to users |
| `created_at` | |
| `updated_at` | |

**Trigger-computed fields:** `end_time`, `final_amount`, `booking_number`, `start_datetime`, `end_datetime`

---

## 5. Pricing & Discount Engine

### Service Pricing Model

Service master defines: `price_npr`, `duration_minutes`, `is_active`

When a booking is created, the base price is **snapshotted**. Future price changes do not affect existing bookings.

### Discount Rules

**Allowed types:** Percentage, Fixed Amount

**Pricing formula:**
```
calculated_discount =
    if percentage → base_amount * (discount_value / 100)
    if fixed      → discount_value

final_amount = base_amount - calculated_discount
```

**Restrictions:**
- `final_amount` is NOT directly editable
- Discount requires a `discount_reason`
- Discount must log: `discount_reason`, `discount_applied_by`, timestamp

### Role-Based Discount Limits

| Role | Max Discount |
|------|-------------|
| Staff | 5% |
| Manager | 30% |
| Admin | Unlimited |

If discount exceeds role limit, the system blocks with an error.

---

## 6. Room Allocation Engine

### Logic
1. Service duration known
2. Start time chosen
3. Compute end time
4. Fetch all active rooms for the branch
5. Check overlapping bookings
6. Assign first available room

### Hard Protection
- **Postgres GIST exclusion constraint** prevents overlap at the database level
- If no rooms available: return `ROOMS_FULL` error

---

## 7. Therapist Assignment Engine

- **Room** is assigned at booking creation
- **Therapist** can be assigned later by staff

### Therapist Status
| Status | Condition |
|--------|-----------|
| Available | No active booking |
| Busy | Booking status = In Progress |
| On Break | Manually set |

---

## 8. Payment & Collection Engine

### Payment Modes
`cash`, `card`, `fonepay`, `online`

### Payment Status
`unpaid`, `paid` (partial payments deferred to Phase 2)

### Payment Logic
- Booking can exist without payment
- Payment recorded at counter
- `collected_by` must be recorded
- Completed bookings must have payment recorded before daily close

---

## 9. Daily Closing & Reconciliation

> This is the Excel replacement core.

Manager clicks **"Close Day"** and the system calculates:

### Revenue Summary

| Metric | Formula |
|--------|---------|
| **Gross Revenue** | `SUM(base_amount)` of completed bookings |
| **Total Discounts** | `SUM(base_amount - final_amount)` |
| **Net Revenue** | `SUM(final_amount)` |

### Payment Breakdown
- Cash collected
- Card collected
- Fonepay collected
- Online collected

### Additional Sections
- **Pending Payments** — bookings completed but unpaid
- **Booking Breakdown** — count by status (Confirmed, Completed, Cancelled, No Show)
- **Staff Discount Summary** — discounts grouped by staff and reason

Daily report snapshot stored in `daily_reports` table. Once day is closed, bookings become **locked from edits**.

---

## 10. Reporting & Analytics

### Phase 1 Reports (Minimum)
- Daily revenue
- Revenue by service
- Revenue by therapist
- Discount report
- Payment mode breakdown
- Booking volume per hour
- Cancellation rate

### Future Reports
- Retention, Cohort, LTV
- Multi-branch comparison

---

## 11. Role & Permission Control

### Staff Permissions
- Create booking
- Assign therapist
- Record payment
- Apply limited discount (max 5%)
- **Cannot** close day
- **Cannot** edit after completion

### Manager Permissions
- Everything staff can do, plus:
- Apply higher discount (max 30%)
- Close day
- Export reports

### Admin Permissions
- Multi-branch view
- Service price changes
- Unlimited discount
- View audit logs
- Override system locks

---

## 12. Audit & Compliance Layer

All critical changes logged with:

| Field | Description |
|-------|-------------|
| `booking_id` | FK to bookings |
| `action_type` | What happened |
| `old_value` | Previous state |
| `new_value` | New state |
| `changed_by` | FK to users |
| `changed_at` | Timestamp |

### Critical Audit Events
- Discount applied
- Booking cancelled
- Payment recorded
- Day closed
- Price changed

---

## 13. Multi-Branch Scalability

All major tables include `branch_id`. Future capabilities:
- Consolidated reports
- Branch comparison
- Central admin dashboard

---

## 14. Excel Replacement Mapping

| Client Excel Contains | System Replaces With |
|----------------------|---------------------|
| Booking count | Daily Closing module |
| Service | Auto-calculated revenue |
| Revenue | Export to CSV / Excel |
| Discount | Auto discount audit |
| Payment mode | Payment reconciliation |
| Staff performance | Staff discount summary |

---

## 15. Non-Negotiable Production Rules

1. No direct price editing
2. No deletion of completed bookings
3. All discounts must be logged
4. Room conflicts impossible (GIST constraint)
5. Daily close locks previous day
6. Revenue derived only from booking table

---

## 16. Current Build Status

### Already Built
- Auth system (Supabase Auth + RLS)
- Service read integration
- Booking creation with room auto-assign
- Dashboard UI (Staff + Manager)
- Booking detail modal

### Still Needed
- Discount engine implementation
- Payment recording UI
- Daily close logic
- Reconciliation report
- Permission enforcement (role-based discount limits)
- Audit table
- Booking status lifecycle UI
- Therapist status auto-sync
- Lock after completion

---

## 17. Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite SPA |
| Backend | Supabase (Postgres) |
| Auth | Supabase Auth + RLS |
| Business Logic | DB triggers + API layer |

**No business logic duplication in frontend.** All financial logic must live in the DB or API layer.

---

## 18. Phase Roadmap

| Phase | Scope |
|-------|-------|
| 1 | Database Schema |
| 2 | Supabase Client & Auth Context |
| 3 | Centralized API Layer |
| 4 | Discount + Payment Engine |
| 5 | Daily Closing & Reconciliation |
| 6 | Permission Enforcement |
| 7 | Audit & Lock System |
| 8 | Multi-branch Consolidation |
