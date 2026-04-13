---
name: booking-domain
description: Zenly business domain knowledge — booking workflow, financial rules, discount approval, room/therapist scheduling, Nepal timezone handling, reconciliation formulas, and spa operational logic.
user-invocable: false
---

# Zenly Domain Knowledge

This skill provides background business logic knowledge for the Zenly spa management system. Claude loads this automatically when working on booking, payment, scheduling, or financial features.

## Business Context

Zenly is a spa booking management system for a massage parlor in Lazimpat, Kathmandu, Nepal. It replaces an Excel-based workflow with a Supabase-backed web application.

- **Single branch:** Lazimpat (multi-branch architecture ready for future)
- **Operating hours:** 09:00 — 21:00 (12 hours = 720 minutes)
- **Timezone:** Asia/Kathmandu (UTC+5:45) — always use this for datetime conversions
- **Currency:** NPR (Nepalese Rupee) — no decimals in display, but stored as decimal(10,2)
- **Language:** English UI (customer-facing and staff-facing)

## Booking Status Workflow

```
                 ┌──────────────────────────┐
                 │                          │
                 ▼                          │
  ┌─────────┐  assign   ┌───────────┐      │
  │ Pending  │ ────────► │ Confirmed │      │
  └─────────┘  therapist └───────────┘      │
       │                      │             │
       │                      │ start       │
       │ cancel               ▼             │
       │               ┌─────────────┐      │
       │               │ In-Progress │      │ cancel
       │               └─────────────┘      │
       │                      │             │
       │                      │ complete    │
       │                      ▼             │
       │               ┌───────────┐        │
       │               │ Completed │        │
       │               └───────────┘        │
       │                                    │
       ▼                                    │
  ┌───────────┐                             │
  │ Cancelled │ ◄───────────────────────────┘
  └───────────┘
```

### Status Values (exact, case-sensitive)
- `Pending` — booking created, no therapist assigned yet
- `Confirmed` — therapist assigned, ready for service
- `In-Progress` — service currently being performed
- `Completed` — service finished
- `Cancelled` — booking cancelled (can happen from Pending or Confirmed)

### Status Transition Rules
| From | To | Who Can Do It | Conditions |
|------|----|---------------|------------|
| Pending | Confirmed | staff, manager, admin | Must assign therapist_id |
| Pending | Cancelled | staff, manager, admin | Can cancel anytime |
| Confirmed | In-Progress | staff, manager, admin | When service begins |
| Confirmed | Cancelled | staff, manager, admin | Before service begins |
| In-Progress | Completed | staff, manager, admin | When service ends |
| Completed | — | — | Terminal state |
| Cancelled | — | — | Terminal state |

## Room & Therapist Scheduling

### Overlap Prevention
The database uses GIST exclusion constraints to prevent double-booking:

- **Room overlap:** Two non-cancelled bookings cannot occupy the same room during overlapping time ranges
- **Therapist overlap:** A therapist cannot be assigned to two non-cancelled bookings during overlapping time ranges

### Time Slot Logic
1. Staff selects `date` and `start_time`
2. `end_time` is auto-computed: `start_time + service.duration_minutes`
3. `start_datetime` and `end_datetime` are auto-computed using Nepal timezone
4. The GIST constraint checks for conflicts in `tstzrange(start_datetime, end_datetime)`

### Available Rooms/Therapists
When creating a booking, check availability by querying existing bookings for the same date/time range and excluding rooms/therapists that are already booked.

## Financial Rules

### Price Snapshot
- `base_amount` = service.price_npr at booking time (snapshotted, not dynamic)
- If service price changes later, existing bookings are NOT affected

### Discount Workflow
```
Staff requests discount:
  → discount_amount = X, discount_status = 'pending'

Manager approves:
  → discount_status = 'approved', discount_approved_by = manager's user_id

Manager rejects:
  → discount_amount = 0, discount_status = 'none' (clean reset, no 'rejected' state)
```

- There is NO `rejected` enum value — rejection resets to `none`
- `discount_status = 'approved'` requires `discount_approved_by IS NOT NULL` (CHECK constraint)
- Only managers and admins can approve discounts

### Final Amount
- `final_amount = base_amount - discount_amount` (trigger-computed)
- Always >= 0 (discount_amount cannot exceed base_amount practically)

### Payment Rules
- One payment per booking (payments.booking_id is UNIQUE)
- Payments are **immutable** — once recorded, cannot be edited or deleted
- Payment modes: Cash, Nabil, GlobalIME, NICAsia, Fonepay
- Booking cancellation does NOT delete the payment record

## Reconciliation Formulas

All reconciliation metrics use `WHERE payment_status = 'paid'`:

| Metric | Formula |
|--------|---------|
| Gross Revenue | SUM(base_amount) WHERE payment_status = 'paid' |
| Total Discounts | SUM(discount_amount) WHERE payment_status = 'paid' |
| Net Revenue | SUM(final_amount) WHERE payment_status = 'paid' |
| Room Utilization | SUM(booked minutes) / (active_rooms x 720) x 100 |
| Therapist Utilization | SUM(therapist booked minutes) / (active_therapists x 720) x 100 |
| Average Booking Value | Net Revenue / booking count |
| Bookings Per Day | COUNT(*) WHERE date = target_date |

## Booking Number Format

Auto-generated by trigger: `BK-YYYYMMDD-XXXX`
- Example: `BK-20260212-0001`
- Sequential per day, zero-padded to 4 digits
- Collision-safe (trigger handles duplicates)

## User Roles

| Role | Can Do |
|------|--------|
| staff | Create/view/update bookings in own branch, record payments, check in/out |
| manager | Everything staff can do + approve discounts, view analytics, view branch attendance |
| admin | Everything manager can do + access all branches |

## Seed Data (for Development)

### Services
| Name | Duration | Price (NPR) |
|------|----------|-------------|
| Deep Tissue Massage | 60 min | 2,500 |
| Swedish Massage | 60 min | 2,000 |
| Hot Stone Therapy | 90 min | 3,500 |
| Aromatherapy Massage | 75 min | 2,800 |
| Traditional Thai Massage | 90 min | 3,000 |
| Couples Massage | 60 min | 4,500 |
| Prenatal Massage | 60 min | 2,800 |
| Foot Reflexology | 45 min | 1,800 |

### Currency Display Rules
- Always show `NPR` prefix: "NPR 2,500"
- Use comma for thousands separator
- No decimal places in display (even though stored as decimal(10,2))
- Right-align amounts in tables
