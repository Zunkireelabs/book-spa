# BooX Schema Reference

> This file is a quick-reference for the database engineer skill. Keep it updated when schema changes are applied.

## Tables (8)

### branches
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, default gen_random_uuid() |
| name | text | NOT NULL |
| address | text | |
| phone | text | |
| is_active | boolean | DEFAULT true |
| created_at | timestamptz | DEFAULT now() |

### rooms
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK |
| branch_id | uuid | NOT NULL, FK → branches(id) |
| name | text | NOT NULL |
| is_active | boolean | DEFAULT true |
| created_at | timestamptz | DEFAULT now() |

### services
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK |
| name | text | NOT NULL |
| duration_minutes | integer | NOT NULL |
| price_npr | decimal(10,2) | NOT NULL |
| description | text | |
| is_active | boolean | DEFAULT true |
| created_at | timestamptz | DEFAULT now() |

### therapists
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK |
| branch_id | uuid | NOT NULL, FK → branches(id) |
| name | text | NOT NULL |
| gender | text | NOT NULL, CHECK ('Male','Female') |
| specialties | text[] | DEFAULT '{}' |
| is_active | boolean | DEFAULT true |
| created_at | timestamptz | DEFAULT now() |

### users
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, FK → auth.users(id) |
| email | text | NOT NULL, UNIQUE |
| full_name | text | NOT NULL |
| role | user_role | NOT NULL, DEFAULT 'staff' |
| branch_id | uuid | FK → branches(id) |
| is_active | boolean | DEFAULT true |
| created_at | timestamptz | DEFAULT now() |

### bookings
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK |
| booking_number | text | UNIQUE (auto-generated trigger) |
| branch_id | uuid | NOT NULL, FK → branches(id) |
| room_id | uuid | NOT NULL, FK → rooms(id) |
| service_id | uuid | NOT NULL, FK → services(id) |
| therapist_id | uuid | FK → therapists(id) |
| customer_name | text | NOT NULL |
| customer_email | text | |
| customer_phone | text | |
| customer_gender | text | |
| date | date | NOT NULL |
| start_time | time | NOT NULL |
| end_time | time | NOT NULL (trigger-computed) |
| start_datetime | timestamptz | NOT NULL (trigger-computed) |
| end_datetime | timestamptz | NOT NULL (trigger-computed) |
| status | booking_status | NOT NULL, DEFAULT 'Pending' |
| special_requests | text | |
| payment_status | payment_status_enum | NOT NULL, DEFAULT 'unpaid' |
| base_amount | decimal(10,2) | NOT NULL, CHECK > 0 |
| discount_amount | decimal(10,2) | NOT NULL, DEFAULT 0, CHECK >= 0 |
| final_amount | decimal(10,2) | NOT NULL (trigger-computed) |
| discount_status | discount_status_enum | NOT NULL, DEFAULT 'none' |
| discount_approved_by | uuid | FK → users(id) |
| created_by | uuid | FK → users(id) |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now() (trigger-updated) |

**Constraints:**
- `chk_final_amount`: final_amount = base_amount - discount_amount
- `chk_discount_positive`: discount_amount >= 0
- `chk_base_positive`: base_amount > 0
- `chk_discount_approval`: approved discount requires discount_approved_by
- `excl_room_overlap`: GIST exclusion on room_id + tstzrange WHERE status != 'Cancelled'
- `excl_therapist_overlap`: GIST exclusion on therapist_id + tstzrange WHERE therapist_id IS NOT NULL AND status != 'Cancelled'

### payments
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK |
| booking_id | uuid | NOT NULL, UNIQUE, FK → bookings(id) ON DELETE RESTRICT |
| amount | decimal(10,2) | NOT NULL |
| payment_mode | payment_mode | NOT NULL |
| recorded_by | uuid | NOT NULL, FK → users(id) |
| notes | text | |
| created_at | timestamptz | DEFAULT now() |

**Immutable:** No UPDATE or DELETE RLS policies.

### attendance
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK |
| user_id | uuid | NOT NULL, FK → users(id) |
| branch_id | uuid | NOT NULL, FK → branches(id) |
| date | date | NOT NULL |
| check_in | timestamptz | NOT NULL, DEFAULT now() |
| check_out | timestamptz | |
| created_at | timestamptz | DEFAULT now() |

**Constraint:** UNIQUE(user_id, date)

## Enums (5)

- `user_role`: staff, manager, admin
- `booking_status`: Pending, Confirmed, In-Progress, Completed, Cancelled
- `payment_mode`: Cash, Nabil, GlobalIME, NICAsia, Fonepay
- `payment_status_enum`: unpaid, paid
- `discount_status_enum`: none, pending, approved

## Indexes (5)

- `idx_bookings_date` ON bookings(date)
- `idx_bookings_branch_date` ON bookings(branch_id, date)
- `idx_bookings_status` ON bookings(status)
- `idx_payments_created_at` ON payments(created_at)
- `idx_attendance_date` ON attendance(date)

## Triggers (4)

1. `trg_booking_number` — auto-generate BK-YYYYMMDD-XXXX on INSERT
2. `trg_compute_datetimes` — compute end_time, start_datetime, end_datetime on INSERT/UPDATE
3. `trg_compute_final_amount` — compute final_amount on INSERT/UPDATE of base/discount
4. `trg_updated_at` — set updated_at on UPDATE

## Helper Functions (2)

- `get_user_role()` — SECURITY DEFINER, returns current user's role
- `get_user_branch_id()` — SECURITY DEFINER, returns current user's branch_id

## Seed Data UUIDs

- Branch Lazimpat: `b0000000-0000-0000-0000-000000000001`
- Rooms: `a0000000-0000-0000-0000-000000000001` through `009`
- Services: `c0000000-0000-0000-0000-000000000001` through `008`
- Therapists: `d0000000-0000-0000-0000-000000000001` through `006`
