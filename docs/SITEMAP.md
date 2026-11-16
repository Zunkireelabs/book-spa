# Zennly sitemap

**Status:** draft v1, 2026-11-16, for owner approval (ZNLY-198 gate). Written by the lead session (bookx-eb).
**Scope:** the whole product, for every tenant and every industry. This is not a Sami's-only map: the 19 Nov
release goes to all production tenants (Nuad Thai and others) at once, and Sami's Brows and Lashes is the first
new tenant onboarded on top of it.
**Evidence:** everything here is **code-read** from `feature/ZNLY-198-ui-integration` (our UI branch, "ours") and
`origin/stage` / `origin/main` as of 2026-11-16. Nothing in this file has been run. See "Not verified" at the end.

Sources of truth in code (keep this file in sync with them):
- Routes: `src/Routes.jsx`
- Sidebar and module registry: `src/navigation/navRegistry.js`
- Area tabs: `src/pages/branch-manager-dashboard/components/Area/areaTabsRegistry.js`
- Reports: `.../components/Reports/reportRegistry.js`
- Settings: `.../components/Settings/settingsRegistry.js`
- Feature flags: `.env.staging`, `.env.production` (via `src/lib/featureFlags`)
- Industry labels: `src/hooks/useIndustry.js` (`staffLabel`, `sessionLabel`, `locationLabel`, `productLabel`, `enableRooms`)

---

## 0. Legend

| Mark | Meaning |
|---|---|
| **CP** | On the critical path for 19 Nov (see section 8) |
| **[stage]** | Exists on stage (Anish's work) but **not** on our UI branch yet; must be carried in by the integration |
| **[main ⚠]** | Already **live on production** but **missing from our UI branch**. If the integration drops it, existing tenants lose a feature. Must be carried in |
| **[flag X]** | Only shown when feature flag `VITE_ENABLE_X` is on |
| **{staff}** / **{session}** / **{location}** / **{product}** | Text that comes from the tenant's industry labels, never hard-coded (Nuad Thai: Therapist / Session; Sami's: Team member / Appointment) |
| **Overall-hidden** | Hidden when a multi-branch user is in "All branches" (Overall) mode |

Roles: `staff`, `manager`, `admin`, `admin_viewer` (read-only admin), **platform admin** (Zunkiree, separate login),
**client** (anonymous visitor or signed-in customer). Anish's staff access (PR #462, migrations 318–322) adds
**per-account restrictions** on top of the role: whether a login exists, whether it sees customer details, prices,
and only its own bookings ("own bookings only" is enforced in RLS, migration 322).

Feature flags today:

| Flag | Staging | Production |
|---|---|---|
| MEMBERSHIP, VOUCHERS, PRODUCTS, CAMPAIGNS, OUTREACH, PLATFORM_ADMIN | on | on |
| CUSTOMER_REFERRALS | on | **off** |

---

## 1. Surfaces

| Surface | Base URL | Who | Shell |
|---|---|---|---|
| A. Public entry | `/`, `/login`, `/customer-booking-flow`, `/booking-management-portal` | Anyone | None |
| B. Client booking site | `/:orgSlug`, `/:orgSlug/book` | Client | Tenant-branded (`TenantWrapper`) |
| C. Client account | `/:orgSlug/customer-login`, `/signup`, `/account` | Client | Tenant-branded |
| D. Staff app | `/:orgSlug/dashboard?view=…` plus a few full routes | staff / manager / admin / admin_viewer | `AppShell` + sidebar from `navRegistry` |
| E. Platform admin | `/platform/*` [flag PLATFORM_ADMIN] | Zunkiree | Own shell |

---

## 2. A. Public entry

| Route | Screen | Notes |
|---|---|---|
| `/` | External redirect to zunkireelabs.com product page | |
| `/login` | **Org finder** (`OrgFinder`): type a business name, go to `/:orgSlug/login` | CP (every staff login starts here or at the org URL) |
| `/customer-booking-flow`, `/booking-management-portal` | **Client org finder** (`CustomerOrgFinder`): "which business?" picker, then `/:orgSlug/book` | Legacy URLs from before multi-tenancy |
| `/branch-staff-dashboard`, `/branch-manager-dashboard`, `/booking-details-assignment-modal`, `/booking-details/:id` | Legacy redirects to the signed-in user's org | |
| `*` | Not found | |

## 3. B. Client booking site (CP)

Entry: `/:orgSlug` and `/:orgSlug/book` both render `CustomerBookingFlowV2`, which hosts `ProviderProfileFlow`.

| Step | Screen / component | What the client does |
|---|---|---|
| B1 | **Branch gate** (`BranchGate` / `BranchSelection`) | Picks a {location} when the tenant has more than one. Uses `branch_working_hours` |
| B2 | **Provider profile** (`ProfileHero`, `OverviewSection`, `ServicesSection`, `TeamSection`, `AmenitiesSection`, `PoliciesSection`) | Browses services and the team. Service prices follow price type: fixed / free / tiered range "NPR 1,200 – 8,600"; `calendar_only` and `no_default` are hidden from clients [stage] |
| B3 | **Professional step** (`ProfessionalStep`) | Picks a {staff} or "any" |
| B4 | **Date & time step** (`DateTimeStep`) | Picks a slot. Availability = branch hours, roster, existing bookings, room capacity, online-capacity limits, closed dates, 10am–6pm online window [main] |
| B5 | **Confirm step** (`ConfirmStep`, `CustomerForm`, `BookingConfirmation`) | Enters name / phone (E.164) / email, reviews, confirms |
| B6 | **Success** (`BookingSuccess`) | Sees the booking reference |
| B7 | **Group booking** (`GroupBookingView`: group confirm, summary card) **[main ⚠]** | Books several people in one go. Live on main and stage; **not on our UI branch** |
| — | `DiscardDialog`, `MobileBookingBar`, `SummaryCard` | Leave-without-saving guard; mobile summary |
| — | `/:orgSlug/manage` | Redirects to `/book` (self-service booking search was removed; staff use "Check booking") |

## 4. C. Client account

| Route | Screen | Contents |
|---|---|---|
| `/:orgSlug/customer-login` | Client login | Email OTP / password (`CustomerAuthContext`) |
| `/:orgSlug/signup` | Client sign-up | |
| `/:orgSlug/account` | **Client account** | Upcoming / Past bookings; Membership section and wallet card [flag MEMBERSHIP]; Packages section; Vouchers section [flag VOUCHERS]; Referral stats and reward card [flag CUSTOMER_REFERRALS]; profile self-edit (migration 176) |

## 5. D. Staff app

Login: `/:orgSlug/login` (`StaffLoginAuthentication`): email + password, or PIN via the `pin-login` Edge Function
(the function's source is not in this repo). **[stage]** PIN lock screen for an idle staff session
(`LockScreenOverlay`, `LockContext`, `pinAuth.js`).

Shell: `AppShell` + `StaffSidebar`. The sidebar is generated from `navRegistry.js`; on mobile it becomes pills plus a
"More" sheet. ⌘K search palette. `BranchSwitcher` (multi-branch users, includes "All branches" = Overall).
`NotificationBell` + toasts (Realtime). `ProfileMenu`.

### 5.1 Main

| Item | URL | Roles | Screens |
|---|---|---|---|
| **Dashboard** (CP) | `?view=dashboard` | all | `dashboard-home`, role-dispatched: **Business** (admin, Overall), **Branch** (manager/admin, one branch), **Front desk**, **My day** (staff: own bookings, commission, tips via `users.therapist_id`). Prep / Live / Close phases, insight cards, setup checklist |
| **Inbox** | `/:orgSlug/inbox` | all | Notifications by category, booking panel, notification preferences (ZNLY-135) |
| **Calendar** (CP) | `?view=calendar` | all | Day / 4-day / month grid (`OperationalCalendar`, `CalendarGrid`, `MonthGridView`), drag and drop, blocks (`AddBlockModal`), full-day view, booking cards. **[stage]** Waitlist panel beside the calendar (`WaitlistPanel`, migration 327). **[stage]** Quick booking time field uses `TimeBoxInput`. Restricted staff see only their own bookings (migration 322) [stage] |
| **Reports** | `?view=all-reports` | manager, admin, admin_viewer | Reports hub (section 5.6) |

### 5.2 Operations

| Item | URL | Roles | Tabs / screens |
|---|---|---|---|
| **Bookings** (CP) | `?view=bookings` | all | Tabs: **All bookings** (all); **New booking** (staff/manager/admin, Overall-hidden); **Check booking** (all, Overall-hidden); **Collect payment** (front desk, Overall-hidden); **New membership** [flag MEMBERSHIP]; **New voucher** [flag VOUCHERS] |
| Booking detail (CP) | `/:orgSlug/bookings/:bookingId` | all | `BookingDetailsAssignmentModal`: status state machine (Pending → Confirmed → In-Progress → Completed; Cancelled / No Show), {staff} and room assignment, transfer, discount request / approve (`BookingActionModal`), checkout (`PaymentModal`, `PaymentMethodSelector`, split payments, products at checkout `CheckoutProducts`, member discount, voucher / wallet / package redemption), payment-mode correction, refunds on cancel (migration 099). **[stage]** Issue / print **VAT invoice** (`InvoicePrintModal`, A4 or 80mm; migrations 328–334, off by default per org) |
| **Customers** | `?view=customers` | manager, admin, admin_viewer | List, duplicate merge |
| Customer detail | `/:orgSlug/customers/:id` | all | Tabs: Summary, Packages, Membership, Photos, Documents, Gift Vouchers, Log. Sales tab [stage changes]. Restricted staff see masked names / numbers [stage] |
| Customer messages | `/:orgSlug/customers/:id/messages` | all | Messages sent to that customer (outreach) |

### 5.3 Sales

| Item | URL | Roles | Tabs |
|---|---|---|---|
| **Packages** | `?view=packages` | manager, admin, admin_viewer (read-only) | Guest packages; Package types |
| **Memberships** [flag MEMBERSHIP] | `?view=memberships` | manager, admin, admin_viewer (read-only) | Members; Tiers; Wallet activity |
| **Vouchers** [flag VOUCHERS] | `?view=vouchers` | manager, admin, admin_viewer (read-only) | Vouchers; Voucher types; Activity |
| **{product}** [flag PRODUCTS] | `?view=products` | all | {product}s; Stock history; Suppliers; Categories |

### 5.4 People

| Item | URL | Roles | Tabs / screens |
|---|---|---|---|
| **{staff}s** | `?view=therapists` | manager, admin, admin_viewer | Tabs: Active; Inactive; Positions (mgr/admin, Overall-hidden); Transfer log; Roster (mgr/admin, weekly roster plus day overrides) |
| {staff} detail | `/:orgSlug/staff/:staffId`, `/staff/new` | view: mgr/admin/viewer; create: mgr/admin | Tabs: Overview, Profile, Services, Working hours, Pay, History. Inner page (V37): Services / Customers / Attendance tabs. Transfer / Return in the header menu |
| **Attendance** | `?view=attendance` | manager, admin, admin_viewer (Overall-hidden) | Payroll-grade attendance (ZNLY-123), leave types and paid caps |
| Attendance calendar | `/:orgSlug/attendance-calendar` | manager, admin, admin_viewer | Full-page calendar of attendance |
| **Payroll** | `?view=payroll` | admin, admin_viewer | Payroll runs, commission |

### 5.5 Marketing

| Item | URL | Roles | Tabs |
|---|---|---|---|
| **Campaigns** [flag CAMPAIGNS] | `?view=campaigns` | manager, admin | Campaigns panel |
| **Outreach** [flag OUTREACH] | `?view=outreach-rules` | admin | Rules; Templates; Review queue; Message log; Settings |

### 5.6 Reports hub (`reportRegistry.js`)

Groups: Overview · Sales & money · Customers · Team · Products & prepaid. Status: **live** = new design,
**legacy** = old panel still in use, **soon** = registered but hidden.

| Report | Status | Notes |
|---|---|---|
| Business health | live | Earned, money in, busy %, vs the previous period |
| Day close | legacy | Printable close sheet |
| Revenue by service / by category | legacy | |
| Discounts | legacy | |
| Money owed (outstanding / due report) | live | Unpaid and part-paid |
| Sources & referrals; Customer referrals; Referral wallet | legacy | The last two only with [flag CUSTOMER_REFERRALS] (**off in prod**) |
| {staff} performance | live | ZNLY-159 |
| Attendance (table / calendar) | legacy | |
| Transfers | legacy | |
| Payments & tips, Customers & retention, No-shows, Campaigns & messages, Utilization, Commission & payroll, Prepaid, Products & stock | soon | Hidden |

### 5.7 Settings (footer item, `settingsRegistry.js`)

| Group | Setting | Roles | Notes |
|---|---|---|---|
| Business ("Spa" today, see gap G-2) | Rooms | mgr, admin (Overall-hidden) | Only if the industry has `enableRooms` |
| | Services, Service detail (`/services/:id`, `/services/new`) | mgr, admin (Overall-hidden) | **[stage]** price types incl. tiered; **[stage]** price tiers panel (`PriceTiersPanel`); per-branch service scope (ZNLY-186, migration 313) [main ⚠] |
| | Categories | mgr, admin (Overall-hidden) | |
| Payments | Payment methods | admin | Custom methods (migration 052) |
| | Reward catalog [flag CUSTOMER_REFERRALS] | mgr, admin | |
| | **[stage]** Billing (VAT invoices: legal name, PAN, tax mode, on / off) | admin | `BillingSettingsPanel`; issuing fails closed until it is configured |
| Booking & profile | Booking settings | admin | Online booking rules, online capacity |
| | Calendar settings | admin (Overall-hidden) | Hours, full-day view |
| | Closed dates | admin | |
| | Provider profile | admin | Public profile and images |
| | Attendance settings | mgr, admin (Overall-hidden) | |
| Account | Notifications | mgr, admin, viewer | Per-user pop-up / sound / desktop |
| | Audit log | mgr, admin, viewer | Every change, and who made it |
| | **[stage]** Staff access | admin | `StaffAccessPanel`: link a login to a {staff}, set email / password / PIN, visibility flags |
| **Locations** (branches) | `/:orgSlug/locations/new`, `/locations/:branchId` **[main ⚠]** | admin | `location-detail` page: add / edit a branch. **Not on our UI branch** (it came with PR #413) |

## 6. E. Platform admin [flag PLATFORM_ADMIN]

| Route | Screen |
|---|---|
| `/platform/login` | Platform login (platform_admins, migration 113) |
| `/platform/dashboard` | All organisations: revenue roll-up, commission owed, churned orgs |
| `/platform/dashboard/:orgId` | Org detail: paid bookings / memberships / vouchers by branch, commission rate history, collect-commission wizard |

Tenant onboarding is **not a screen**: `scripts/onboard-tenant.sql` plus per-tenant seed SQL, run by hand, and the
in-app setup checklist (`SetupChecklist`) after first login.

## 7. Standard states (every list and form screen)

Every screen must have: first use (empty), no results, loading, error, no access (role or staff-access
restriction), and the add / edit / delete patterns. Money screens also need "part-paid" and "refunded".
These are not drawn per screen; the QC harness checks them on the critical path.

## 8. Critical path for 19 Nov (proposed; owner approves)

This is the product core, for **all tenants**. It is checked for two reference tenants:
**Nuad Thai** (spa, existing, live data and history) and **Sami's** (beauty, new, empty). A screen passes only if
it is right for both: labels, features on or off, and no spa-only wording.

| # | Flow | Screens |
|---|---|---|
| CP1 | Staff sign-in | `/login` org finder, `/:orgSlug/login` (password and PIN), [stage] lock screen |
| CP2 | Client books online | B1–B6, and B7 group booking [main ⚠] |
| CP3 | Front desk books, checks and edits a booking | Calendar, Bookings → New / Check, booking detail, [stage] waitlist |
| CP4 | Checkout and money | Booking detail checkout: payment methods, split, discount within role limits, member discount, voucher / wallet / package, products; refunds; [stage] VAT invoice when billing is on |
| CP5 | Owner's day | Dashboard (Business / Branch / Front desk), Money owed, Day close |
| CP6 | Staff's day | Dashboard My day, own bookings only when restricted [stage] |
| CP7 | Setup for a new tenant | Services (price types, tiers [stage]), {staff}s plus staff access [stage], roster, booking settings, provider profile, locations [main ⚠], labels |
| CP8 | Existing tenant after the update | Nuad Thai's existing bookings, balances, memberships, vouchers, packages and history show correctly; nobody is locked out; prices unchanged |

## 9. Gaps found while mapping (to become tickets; the journeys doc adds more)

| Id | Gap | Severity | Why |
|---|---|---|---|
| G-1 | **Our UI branch lacks three things that are live on main:** group booking (B7), Locations pages, per-branch service scope UI (ZNLY-186). Plus everything only on stage: staff access, price tiers, waitlist, VAT invoices, PIN lock screen | **P0** | If the integration drops any of them, production tenants lose features on 19 Nov. The conflict merge must carry each one; the QC checklist must list each by name |
| G-2 | Settings group is labelled **"Spa"**, and the provider profile and audit log copy say "your spa" / "this spa" | P1 | Wrong for Sami's (beauty) and any non-spa tenant. Should come from the industry or say "Business" |
| G-3 | The PIN lock screen (863820d, 13 Nov) is **not in PR #462's description** and has no ticket | P2 | Unreviewed scope. It needs a ticket and acceptance checks, because a lock screen can lock staff out |
| G-5 | `CUSTOMER_REFERRALS` is on in staging and off in production | P2 | Staging QA would test screens production never shows. QA must run with prod flags |

## Not verified

- Every route, role and tab above comes from reading registries and route files; none was clicked through.
- I didn't check whether each [stage] or [main ⚠] item merges cleanly. The 31-file conflict list is in ZNLY-198.
- The client account sections, group booking and the lock screen were read at component-name level only.
- The old `branch-staff-dashboard` page is still imported in a few places (Routes, AuthContext, the dashboard). Whether any user still reaches it was not traced.
- The `pin-login` Edge Function isn't in the repo, so I didn't read it.
