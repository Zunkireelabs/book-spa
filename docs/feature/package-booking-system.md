# Generic Package (bundle-of-services) booking system

> **Status: planned, not implemented.** This was designed and approved on
> `feature/booking-locked` on 2026-07-27, then explicitly reverted (the draft
> migration file and PROMOTION.md manifest entry were both removed) so
> implementation could be picked up later as its own piece of work. Nothing
> in this document exists in the codebase yet — treat every file/function
> referenced below as "to be created," not "already there."

## Context

Zenly only supports booking one service at a time — `bookings.service_id` is a
single FK, and there is currently **zero package/bundle concept anywhere** in
the codebase (confirmed by grepping every migration and the entire `src/`
tree — the only "package" hits are unrelated UI label reuse). The business
wants to sell bundles (e.g. "Bridal Package" = Facial + Makeup + Hair Styling +
Nails), where each component service can have its own staff member, duration,
and price override, while the customer/staff still pick "the package" as one
action. This must be fully generic — no package/service names hardcoded
anywhere.

## Why this fits the existing architecture cleanly

`bookings` already supports "one action → multiple linked rows" via
`booking_group_id` (a nullable UUID with no parent table, added in
`migration-030-booking-group-id.sql`), used today for multi-person group
bookings: the calendar's group-booking flow (`calendar/index.jsx:1775-1809`)
generates one `crypto.randomUUID()` and calls the existing `createBooking()`
once per person, sequentially, tagging each row with the shared id.

A package is the same shape, one level down: **one package selection → one
shared `booking_group_id` → one `createBooking()` call per component
service** — each component becomes a completely normal `bookings` row with
its own `service_id`, `therapist_id`, `room_id`, pricing, and status. This
means:
- **No new availability system.** Every component goes through the exact
  existing per-service conflict checks in `createBooking()`
  (`src/services/api.js:2840-3155`), backstopped by the real, unbypassable
  guarantee: Postgres GIST exclusion constraints (`excl_room_overlap`,
  `excl_therapist_overlap`, `schema.sql:165-180`). If Staff B is busy for one
  component, that single `createBooking()` call fails with the existing
  `THERAPIST_CONFLICT` error — naming exactly which component failed, for free.
- **No new financial/status columns needed on bookings.** `base_amount`,
  `final_amount`, `status`, `therapist_id`, snapshots, etc. all already exist
  per-row.

## Database changes

Two new tables, plus two new nullable columns on `bookings` (additive,
backward compatible — existing single-service bookings are entirely
unaffected):

```sql
CREATE TABLE packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  description text,
  image_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE package_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id),
  sort_order integer NOT NULL DEFAULT 0,
  duration_override integer,        -- minutes; null = use services.duration_minutes
  price_override decimal(10,2),     -- null = use services.price_npr
  created_at timestamptz DEFAULT now()
);

ALTER TABLE bookings ADD COLUMN package_id uuid REFERENCES packages(id);
ALTER TABLE bookings ADD COLUMN package_service_id uuid REFERENCES package_services(id);
```

`package_id` marks "this row is one component of a package booking";
`package_service_id` disambiguates which specific package slot it fulfills
(handles the edge case of the same service appearing twice in one package).
Both null for every existing/ordinary booking. `booking_group_id` continues
to be the mechanism that links the sibling component rows together (query
`WHERE booking_group_id = X` to get every component of one package booking;
`package_id IS NOT NULL` distinguishes it from a plain multi-person group
booking, which never sets `package_id`).

RLS: mirror the existing `services`/`service_categories` policy pattern
(org-scoped read for authenticated org members, write restricted to admin
only — see role note below).

A full draft migration (`migration-053-packages.sql`) was written and then
deleted as part of the revert — the SQL above is the complete content that
needs recreating (RLS policies use the existing `get_user_org_id()`/
`get_user_role()` helpers from `migration-011`/`rls.sql`, following the exact
policy-naming pattern in `migration-012-org-rls-policies.sql` and
`migration-049-services-manager-write.sql`).

Note for promotion: per this repo's CLAUDE.md rule, whenever this migration
is (re)created it must be added to `supabase/PROMOTION.md`'s pending-migration
manifest (there's a commented placeholder there already:
`-- ,('053')  <-- add new versions here`), and — since this is a schema
change — production's database will need this migration run manually
before/alongside the frontend deploy when this branch eventually reaches
`main`.

## Backend changes (`src/services/api.js`)

Follow the exact existing convention (auth → role check → org_id-scoped
query → `{data, error}` shape) used by `createService`/`createCategory`.

**Package management (admin-only, mirrors `createCategory`/`updateCategory`/etc.):**
- `fetchPackagesForManagement()` — list packages + nested `package_services`
  (joined to `services` for name/duration/price), org-scoped.
- `createPackage({name, description, imageUrl})`
- `updatePackage({packageId, name, description, imageUrl})`
- `togglePackageActive({packageId, isActive})`
- `deletePackage({packageId})` — block with a `HAS_BOOKINGS`-style error if
  any booking references it (mirror `deleteService`'s `HAS_BOOKINGS` handling).
- `addPackageService({packageId, serviceId, sortOrder, durationOverride, priceOverride})`
- `removePackageService({packageServiceId})`
- `reorderPackageServices({packageId, orderedIds})`

**Package fetch for booking screens:**
- `fetchPackagesForBooking(branchId)` — active packages + their component
  services (name, duration, price, applying overrides), shaped for direct
  rendering — mirrors `fetchServices(branchId)`'s existing shape/exclusion
  logic so the booking UI can treat a package's components like a list of
  services.

**Package booking orchestration:**
- `createPackageBooking({ packageId, customerName, customerPhone, customerEmail, branchId, date, componentAssignments })`
  where `componentAssignments` is `[{ packageServiceId, therapistId, roomId, startTime }]`
  (one entry per component, in `sort_order`; `startTime` per component since
  each service has its own duration and they run sequentially unless the
  caller supplies overlapping times intentionally e.g. different staff same
  slot).
  - Generates one `bookingGroupId = crypto.randomUUID()`.
  - Loops the components **sequentially**, calling the existing
    `createBooking()` unmodified for each, passing through `serviceId`,
    `therapistId`, `roomId`, `date`, `startTime`, customer fields,
    `bookingGroupId`, plus the two new `packageId`/`packageServiceId` tags.
  - On any component's `createBooking()` returning an error: stop, delete
    the sibling component rows already inserted in this same attempt (best-
    effort compensating rollback — Supabase JS can't wrap cross-row inserts
    in one client transaction, same limitation the existing group-booking
    loop already has), and return an error identifying exactly which
    component/service failed (e.g. `{code: 'COMPONENT_UNAVAILABLE', message: 'Hair Styling — Staff C is unavailable at this time', failedComponentIndex}`).
  - On success, returns all created booking rows/ids.

## Frontend changes

### 1. Admin "Packages" management page (Setup section, admin-only)

New file: `src/pages/branch-manager-dashboard/components/MasterData/PackageManagementPanel.jsx`,
mirroring `CategoryManagementPanel.jsx`/`ServiceManagementPanel.jsx` exactly
(same table/modal/FilterBar conventions):
- List: package name, description, component count, status, actions
  (edit/delete/toggle).
- Edit modal: Name, Description, Image (reuse the existing image-upload
  widget from `ServiceManagementPanel.jsx`), then a **component list editor**:
  add a service (via `CustomSelect` sourced from `fetchServices`), each row
  showing service name/duration/price with optional override fields, drag-
  or-arrow reordering (`sort_order`), remove button.

Wiring (mirrors the existing Setup pages exactly):
- `src/components/ui/StaffSidebar.jsx` — add a `packages` child under the
  `infrastructure`/"Setup" group (~line 260), **`roles: ['admin']` only**
  (matching how "Payment Methods" is already admin-only — packages should be
  admin-controlled, not manager).
- `src/pages/branch-manager-dashboard/index.jsx` — add
  `{viewMode === 'packages' && !isOverall && <PackageManagementPanel />}`
  alongside the existing Services/Categories conditional renders (~line 638),
  plus the import.

### 2. Calendar's "New Booking" modal (`src/pages/branch-manager-dashboard/components/calendar/index.jsx`)

No new toggle/mode switch — the staff click-through flow stays exactly as it
is today. Packages are simply added as extra selectable options inside the
**same existing** service `CustomSelect` (same dropdown, same click
interaction), visually distinguished only by a small icon/badge and a
"(Package)" suffix so staff can tell what they're picking. Picking a package
option, in the same select, expands an inline breakdown below it — one row
per component, each with its own existing therapist `CustomSelect` + room
`CustomSelect` (reusing the exact widgets already used for single-service
therapist/room selection in this file) and a start-time field (default:
sequential back-to-back off the chosen start time, editable per component).
Submit calls `createPackageBooking(...)` instead of `createBooking(...)` only
when the selected option is a package; picking a plain service keeps using
the existing `createBooking(...)` path completely untouched — nothing about
today's click flow for a regular booking changes.

### 3. `StaffBookingForm.jsx`

Same principle: no separate section or new step, no change to the existing
click flow. Package options are added into the **same existing Step 1 card
grid** the individual services already render into (same click-a-card
interaction), distinguished only by a small badge showing component count.
Clicking a package card shows its component breakdown (service name,
duration, price) as read-only informational cards on the same step — **no
therapist picker here**, matching this form's existing behavior for regular
bookings (no therapist selection at creation time anywhere in this form
today). The rest of the wizard (date/time, customer info, confirm) proceeds
exactly as it does today. Submit calls `createPackageBooking(...)` with
`componentAssignments` carrying no `therapistId`/`roomId` (each component
booking is created unassigned, exactly like a regular booking from this
form) — staff then assign each resulting component booking's therapist
afterward via the existing "Assigned" tab in `BookingActionModal.jsx`, from
the calendar, same as today. Picking a plain service card keeps using the
existing single-`createBooking()` path, byte-for-byte unchanged.

### Not in scope this pass
Customer-facing `ServiceSelection.jsx` does not get package support in this
pass (staff/manager/admin booking surfaces only).

## Staff assignment resolution

- **Calendar New Booking modal**: manual per-component therapist selection,
  required at creation — matches this surface's existing single-service
  behavior (it already requires/allows picking a therapist inline).
- **StaffBookingForm**: no inline selection; components are created
  unassigned and staff assign each one afterward via the existing Assign tab
  — matches this surface's existing single-service behavior exactly (no new
  UI pattern introduced).
- No auto-assignment/"qualified staff" matching is implemented, since no
  service-to-therapist qualification table exists today (`therapists.specialties`
  is unenforced free text) — manual staff selection is required everywhere
  it's offered.

## Backward compatibility

- All new columns are nullable additions; the `chk_final_amount`/GIST/
  immutability constraints and every existing trigger apply unchanged to
  package-component rows since they're ordinary `bookings` rows.
- Existing single-service bookings, `booking_group_id`-based group bookings,
  services, categories, staff management, availability, pricing, and booking
  history are untouched — nothing existing is modified, only new tables/columns
  and new code paths added.
- `fetchServices`/`fetchServicesForManagement`/`fetchServicesByOrgId` (three
  near-duplicate service-fetch functions found during investigation) are left
  as-is — out of scope for this feature, not touched.

## Files to create/modify (none of this exists yet)

**New:**
- `supabase/migration-053-packages.sql` (or next free version number —
  `053` was reverted, so re-check the highest existing migration number
  before recreating) (tables + columns + RLS)
- `src/pages/branch-manager-dashboard/components/MasterData/PackageManagementPanel.jsx`

**Modified:**
- `src/services/api.js` — package CRUD + `fetchPackagesForBooking` +
  `createPackageBooking`
- `src/components/ui/StaffSidebar.jsx` — Setup menu entry
- `src/pages/branch-manager-dashboard/index.jsx` — viewMode wiring
- `src/pages/branch-manager-dashboard/components/calendar/index.jsx` —
  package selector + per-component assignment UI
- `src/pages/branch-staff-dashboard/components/StaffBookingForm.jsx` —
  package selector (no assignment UI)
- `supabase/PROMOTION.md` — add new migration version to the pending-check
  manifest

## Verification (once implemented)

1. `npm run build` passes.
2. Create a package via the new admin Setup → Packages page with 3+
   component services (reusing existing services), including one with a
   price/duration override.
3. From the manager calendar's New Booking modal: select the package,
   confirm all components appear with independent therapist/room pickers,
   book it — confirm N separate booking rows appear on the calendar, each
   correctly priced/timed, all sharing one `booking_group_id` and tagged
   with the same `package_id`.
4. Deliberately double-book one component's therapist elsewhere first, then
   attempt the package booking again — confirm it fails naming that specific
   component/service, and that no partial/orphaned component rows are left
   behind (rollback works).
5. From `StaffBookingForm`: book the same package — confirm N unassigned
   bookings are created, then confirm staff can assign each one individually
   via the existing Assign tab from the calendar.
6. Confirm a plain single-service booking (no package involved) still works
   exactly as before in both surfaces — no regression.
7. Confirm the customer-facing booking flow is completely unchanged (no
   package option appears there, by design this pass).
