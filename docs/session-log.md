# BookSpa MVP – Session Log
# Last Updated: 2026-02-13 19:30 NPT

---

## PROJECT OVERVIEW

**Goal:** Replace Excel-based operational workflow with Supabase-backed MVP for Lazimpat branch.

**Existing App:** React 18 + Vite SPA with complete UI (customer booking flow, staff dashboard, manager dashboard, booking details modal). All data currently hardcoded/mocked. No backend, no database, no real auth.

**Target:** Real Supabase Auth, Postgres database, RLS policies, centralized API layer, room-based bookings with collision prevention, payment recording, daily reconciliation, attendance tracking.

**Deploy Target:** `dev-nuad.zunkireelabs.com` via Docker (nginx)

---

## ARCHITECTURE DECISIONS (LOCKED)

- Frontend: React 18 + Tailwind (existing, no redesign)
- Backend: Supabase (Auth + Postgres), no separate Node server
- No Redux, no TypeScript, no Stripe, no AI features
- Single branch: Lazimpat (architecture supports multi-branch later)
- Supabase MCP connected for direct DB access from Claude Code

---

## SUPABASE PROJECT DETAILS

- **Project Name:** bookspa-nuad-thai
- **Project ID:** pmbvogiphelmpjdalmtv
- **URL:** https://pmbvogiphelmpjdalmtv.supabase.co
- **Region:** Asia-Pacific
- **Plan:** Free (Nano)
- **Organization:** sthasadin's Org
- **MCP Server:** Added to local config at /root/.claude.json
  - URL: https://mcp.supabase.com/mcp?project_ref=pmbvogiphelmpjdalmtv

---

## CRITICAL SCHEMA DECISIONS

### Range-Based Overlap Prevention
- Uses Postgres GIST exclusion constraints (NOT simple UNIQUE)
- `btree_gist` extension required
- Room overlap: `EXCLUDE USING GIST (room_id WITH =, tstzrange(start_datetime, end_datetime) WITH &&)`
- Therapist overlap: Same pattern with `WHERE therapist_id IS NOT NULL`

### Financial Precision
- Bookings store `base_amount`, `discount_amount`, `final_amount` as persisted values
- `final_amount = base_amount - discount_amount` enforced by trigger + CHECK
- Service prices snapshotted at booking time (historical accuracy)

### Discount Flow
- Enum: `none`, `pending`, `approved` (NO `rejected` — rejection resets to `none`)
- Staff requests → `discount_status = 'pending'`
- Manager approves → `discount_status = 'approved'`, `discount_approved_by` set
- Manager rejects → `discount_amount = 0`, `discount_status = 'none'` (clean reset)
- CHECK: `discount_status = 'approved' → discount_approved_by IS NOT NULL`

### Reconciliation (Cash-Based)
- All revenue metrics use `WHERE payment_status = 'paid'`
- Gross Revenue = SUM(base_amount), Net Revenue = SUM(final_amount)
- Room Utilization = SUM(booked minutes) / (rooms_count x 720 min) x 100
- Operating hours: 09:00–21:00 (12 hours = 720 minutes)

### Payment Immutability
- No ON DELETE CASCADE (uses RESTRICT)
- No UPDATE/DELETE RLS policy
- Booking cancellation does NOT delete payment

### Computed DateTime Fields
- `start_datetime` and `end_datetime` auto-computed from `date + start_time/end_time`
- `end_time` auto-computed from `start_time + service.duration_minutes`
- Trigger recalculates on any change to date, start_time, or service_id

---

## EXECUTION PLAN — STATUS

### Phase 1: Database Schema, RLS, Seed Data — COMPLETE
- **Deployed:** 2026-02-12
- 8 tables, 5 enums, 2 GIST exclusion constraints, 4 triggers, 5 indexes
- RLS enabled on all 8 tables, 20 policies
- Seed: 1 branch, 9 rooms, 8 services, 6 therapists, 3 auth users

### Phase 2: Supabase Client & Auth Context — COMPLETE
- **Deployed:** 2026-02-12
- `src/lib/supabase.js`, `src/contexts/AuthContext.jsx`, `src/components/ProtectedRoute.jsx`
- Login flow wired to Supabase Auth, role-based route guards

### Phase 3: Centralized API Layer — COMPLETE
- **Deployed:** 2026-02-12
- `src/services/api.js` — All Supabase queries centralized
- Functions: fetchServices, fetchRooms, fetchTherapists, fetchBookings, createBooking, searchBookings, fetchBookingById

### Phase 4: Payment Engine — COMPLETE
- **Deployed:** 2026-02-12
- `recordPayment()` with duplicate prevention, lock checks, status validation
- `src/components/ui/PaymentModal.jsx` — Payment mode selector (Cash, Nabil, GlobalIME, NIC Asia, Fonepay)

### Phase 5: Daily Closing & Reconciliation — COMPLETE
- **Deployed:** 2026-02-12
- `getDailySummary()`, `closeDay()` — Snapshot-based daily reports
- `DailyClosingPanel.jsx` — Manager closes day, locks bookings

### Phase 6: Lifecycle Enforcement — COMPLETE
- **Deployed:** 2026-02-12
- State machine: Pending → Confirmed → In-Progress → Completed (+ Cancelled, No Show)
- `updateBookingStatus()`, `assignTherapist()`, `applyDiscount()` with full validation
- Lock checks, terminal status immutability, GIST conflict detection

### Phase 7: Operational Reporting — COMPLETE
- **Deployed:** 2026-02-12
- `getDailyOperationalReport()` — Live or snapshot-based report
- `exportDailyReportCSV()` — Excel-parity CSV export
- `DailyOperationalReportPanel.jsx` — Full report UI with export

### Phase 8: Frontend Wiring — COMPLETE
- **Deployed:** 2026-02-13
- All frontend pages wired to real Supabase APIs (replacing 100% mock data)
- See "2026-02-13 Session" below for full details

### Phase 8.1: Operational Calendar — COMPLETE
- **Deployed:** 2026-02-13
- Resource-timeline calendar (FullCalendar v6) with therapist rows
- Read-only, branch-hours-aware, in-page modal for booking actions
- See "2026-02-13 Session" below for full details

---

## 2026-02-13 SESSION — Frontend Wiring & Calendar

### Summary
Made the app operationally testable end-to-end: Customer books → Staff confirms/assigns/takes payment → Manager sees report/closes day. Then built a production-grade scheduling calendar.

### Phase 8: Frontend Wiring (all pages)

**Status casing bug fix:**
- `bookingTransformers.js` — Added `toDbStatus()` helper to convert lowercase UI statuses to Title-Case DB values
- Without this, every status update would fail silently

**Staff Dashboard (`src/pages/branch-staff-dashboard/`):**
- `index.jsx` — Wired `handleStatusUpdate`, `handleAssignTherapist`, `handleRecordPayment` to real APIs. Extracted `loadData()` for refresh after mutations. Added date range filter (today/tomorrow/week/month).
- `components/BookingsList.jsx` — Uses `booking.bookingId` (UUID) for API calls. Passes `therapists` prop to BookingActionModal. Dynamic header based on date range.
- `components/TherapistAvailability.jsx` — Removed hardcoded mock data, uses real pending/unassigned bookings from parent.
- `components/StaffHeader.jsx` — Removed hardcoded notification count "3".

**BookingActionModal (`src/components/ui/BookingActionModal.jsx`):**
- Completely rewritten. Removed all mock data, hardcoded fake therapists, setTimeout delays.
- Accepts `therapists` prop, `onRecordPayment` callback.
- Shows valid next-status transitions. Payment tab with PaymentModal integration.

**Manager Dashboard (`src/pages/branch-manager-dashboard/`):**
- `index.jsx` — Live metrics from `fetchBookings()`. Quick Booking navigates to `/customer-booking-flow`.
- `components/RealtimeBookingFeed.jsx` — Uses real bookings from parent props.

**StaffSidebar (`src/components/ui/StaffSidebar.jsx`):**
- Role-aware navigation: Dashboard (role-aware path), Bookings, New Booking.

**Booking Management Portal (`src/pages/booking-management-portal/`):**
- Real search via `searchBookings()` API. Cancel action wired to `updateBookingStatus()`.

**Booking Details Page (`src/pages/booking-details-assignment-modal/`):**
- Fetches real booking via `fetchBookingById()` using URL params. All actions wired.
- Role-aware close fallback: manager/admin → manager dashboard, staff → staff dashboard.

**Routes (`src/Routes.jsx`):**
- Added `/booking-details/:bookingId` route.

### Bugs Found & Fixed During Testing

**1. RLS policy violation on booking creation:**
- Error: `new row violates row-level security policy for table "bookings"`
- Root cause: `generate_booking_number()` and `compute_booking_datetimes()` triggers were `SECURITY INVOKER`, running as anon role which had no SELECT on bookings.
- Fix: Made both functions `SECURITY DEFINER` + pinned `search_path = public`. Added anon SELECT policy on bookings.
- Migrations: `fix_anon_booking_rls_and_trigger_security`, `fix_security_definer_search_path`

**2. Bookings not showing on staff dashboard (date filter):**
- Root cause: `loadData()` was hardcoded to always fetch today's date regardless of date range filter selection.
- Fix: Added `getDateFilter()` helper, made `loadData` accept dateRange parameter, useEffect re-fetches on `filters.dateRange` change.

**3. PaymentModal not opening (z-index conflict):**
- Root cause: BookingActionModal overlay = `z-modal` (1000), PaymentModal = `z-50` (50). Payment modal rendered behind the parent modal.
- Fix: Established centralized z-index hierarchy in `tailwind.config.js`:
  - `z-header: 100`, `z-sidebar: 200`, `z-dropdown: 300`, `z-toast: 900`
  - `z-modal: 1000`, `z-modal-overlay: 1100`, `z-notification: 1200`
- Replaced all raw `z-50` across 8 files with semantic tokens. Zero raw z-50 remaining.

### Phase 8.1: Operational Calendar

**Database:**
- Migration `add_branch_operating_hours`: Added `open_time`, `close_time`, `timezone` columns to branches table.

**API (`src/services/api.js`):**
- Added `getCalendarBookings(branchId, startDate, endDate)` — Single optimized function fetching branch hours + therapists + bookings (excluding Cancelled).

**Component (`src/pages/branch-manager-dashboard/components/OperationalCalendar.jsx`):**
- FullCalendar v6 resource-timeline with therapist rows
- 4 views: Day, 4-Day, Week, Month
- Read-only: `editable: false`, `eventStartEditable: false`, `eventDurationEditable: false`, `eventResourceEditable: false`, `selectable: false`
- Status color coding: Pending (amber), Confirmed (blue), In-Progress (indigo), Completed (green), No Show (dark red)
- Unpaid bookings: yellow border indicator
- Branch hours from DB (09:00-21:00 fallback)
- Now indicator line

**UX fix — In-page modal instead of navigation:**
- Event click opens `BookingActionModal` overlay on top of calendar (no page navigation)
- All actions wired: status update, therapist assignment, payment recording
- On modal close → calendar auto-refreshes to reflect changes
- Fixes the broken flow where clicking a calendar event navigated away and closing the modal landed on the wrong dashboard

**Styling (`src/styles/tailwind.css`):**
- Custom FullCalendar theme matching BookSpa design tokens (colors, fonts, borders, buttons, scrollbar)

**Dependencies installed:**
- `@fullcalendar/react`, `@fullcalendar/resource-timeline`, `@fullcalendar/daygrid`, `@fullcalendar/interaction`

---

## KEY PATTERNS & CONVENTIONS

### API Call Pattern
- All API functions return `{ data, error }` — never throw
- Booking mutations use `booking.bookingId` (UUID), not `booking.id` (booking_number)
- Status updates must use `toDbStatus(uiStatus)` before calling API
- After any mutation, call `loadData()` or refresh function

### Z-Index Hierarchy (centralized in tailwind.config.js)
| Token | Value | Usage |
|-------|-------|-------|
| `z-header` | 100 | Sticky headers |
| `z-sidebar` | 200 | Staff sidebar |
| `z-dropdown` | 300 | Dropdown menus |
| `z-toast` | 900 | Toast notifications |
| `z-modal` | 1000 | Primary modals |
| `z-modal-overlay` | 1100 | Modal-on-modal (PaymentModal) |
| `z-notification` | 1200 | Critical notifications |

### Status Casing
- DB stores Title-Case: `Pending`, `Confirmed`, `In-Progress`, `Completed`, `Cancelled`, `No Show`
- UI uses lowercase: `pending`, `confirmed`, `in-progress`, `completed`, `cancelled`, `no show`
- `toDbStatus()` converts UI → DB, `transformBooking()` converts DB → UI

---

## SEED DATA REFERENCE

**Branch:** Lazimpat (id: b0000000-0000-0000-0000-000000000001)

**Rooms:** Room 1-9 (ids: a0000000-0000-0000-0000-000000000001 through 009)

**Services:**
| Service | Duration | Price NPR |
|---------|----------|-----------|
| Deep Tissue Massage | 60 min | 2,500 |
| Swedish Massage | 60 min | 2,000 |
| Hot Stone Therapy | 90 min | 3,500 |
| Aromatherapy Massage | 75 min | 2,800 |
| Traditional Thai Massage | 90 min | 3,000 |
| Couples Massage | 60 min | 4,500 |
| Prenatal Massage | 60 min | 2,800 |
| Foot Reflexology | 45 min | 1,800 |

**Therapists:** Emma Wilson (F), David Kim (M), Lisa Rodriguez (F), Anjali Thapa (F), Michael Chen (M), Sita Gurung (F)

**Auth Users:**
| Email | Password | Role | Name |
|-------|----------|------|------|
| staff@bookspa.com.np | BookSpa@Staff123 | staff | Ramesh Thapa |
| manager@bookspa.com.np | BookSpa@Manager123 | manager | Rajesh Shrestha |
| admin@bookspa.com.np | BookSpa@Admin123 | admin | Sunil Maharjan |

---

## FILES CREATED/MODIFIED

### Created
- `supabase/schema.sql` — Database schema
- `supabase/rls.sql` — Row Level Security policies
- `supabase/seed.sql` — Seed data
- `src/lib/supabase.js` — Supabase client singleton
- `src/contexts/AuthContext.jsx` — Auth provider
- `src/components/ProtectedRoute.jsx` — Route guard
- `src/components/ui/PaymentModal.jsx` — Payment recording modal
- `src/services/api.js` — Centralized API layer (all Supabase queries)
- `src/services/bookingTransformers.js` — DB ↔ UI data transformation + toDbStatus()
- `src/pages/branch-manager-dashboard/components/DailyClosingPanel.jsx` — Daily close
- `src/pages/branch-manager-dashboard/components/DailyOperationalReportPanel.jsx` — Reports
- `src/pages/branch-manager-dashboard/components/OperationalCalendar.jsx` — Resource calendar
- `docs/session-log.md` — This file

### Heavily Modified (mock → real)
- `src/pages/branch-staff-dashboard/index.jsx`
- `src/pages/branch-staff-dashboard/components/BookingsList.jsx`
- `src/pages/branch-staff-dashboard/components/TherapistAvailability.jsx`
- `src/pages/branch-staff-dashboard/components/StaffHeader.jsx`
- `src/pages/branch-manager-dashboard/index.jsx`
- `src/pages/branch-manager-dashboard/components/RealtimeBookingFeed.jsx`
- `src/pages/booking-details-assignment-modal/index.jsx`
- `src/pages/booking-management-portal/index.jsx`
- `src/components/ui/BookingActionModal.jsx`
- `src/components/ui/StaffSidebar.jsx`
- `src/Routes.jsx`
- `src/styles/tailwind.css` — FullCalendar theme + z-index
- `tailwind.config.js` — z-index hierarchy

---

## SUPABASE MIGRATIONS APPLIED

| Migration | Description |
|-----------|-------------|
| Phase 1 schema | 8 tables, enums, constraints, triggers, indexes |
| Phase 1 RLS | 20 policies across 8 tables |
| Phase 1 seed | Branch, rooms, services, therapists |
| `fix_anon_booking_rls_and_trigger_security` | SECURITY DEFINER on triggers + anon SELECT on bookings |
| `fix_security_definer_search_path` | Pinned search_path on SECURITY DEFINER functions |
| `add_branch_operating_hours` | open_time, close_time, timezone on branches |

---

## RESUME INSTRUCTIONS

When starting a new Claude Code session:
1. Give this file as context: `docs/session-log.md`
2. Supabase MCP should be available (in /root/.claude.json)
3. All Phases 1-8.1 are COMPLETE and deployed
4. App is live at `dev-nuad.zunkireelabs.com`
5. Next: User testing feedback → bug fixes, or new feature phases
