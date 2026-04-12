# Web Audit Report: BooX — Nuad Thai Spa

**URL**: https://dev-nuad.zunkireelabs.com
**Date**: 2026-03-10
**Auditor**: Claude Web Auditor (automated via Playwright)
**Viewports Tested**: Desktop (1920x1080), Mobile (390x844)
**Roles Tested**: Public (unauthenticated), Staff, Manager, Admin

---

## Executive Summary

BooX is a well-built spa booking platform with a clean UI, solid multi-step booking flow, and comprehensive management dashboards. The app is mostly functional with good mobile responsiveness and proper auth/route protection. However, there is **one critical database issue** — the `discount_reason` column is missing from the live database, causing API errors on every manager/admin page load. Additionally, there are accessibility gaps (unlabeled form inputs) and a UX issue with the "Find Existing Booking" button routing customers to the staff login page.

**Overall Score**: 7.5/10

| Category | Score | Notes |
|----------|-------|-------|
| Functionality | 7/10 | Core flows work; discount API broken in production |
| UX/Design | 8/10 | Clean, professional design; good step-by-step flows |
| Performance | 9/10 | All pages under 2s; public pages under 1s |
| Content | 8/10 | Clear labels, good information density |
| Accessibility | 6/10 | Multiple unlabeled inputs, missing ARIA labels |
| Mobile | 8/10 | No overflow issues; manager dashboard very long scroll |
| Security | 9/10 | Route protection works; auth redirects properly |

---

## Site Map

```
/ (Customer Booking Flow — Branch Selection)
├── /customer-booking-flow (same as /)
├── /staff-login-authentication (Staff Portal Login)
├── /branch-staff-dashboard (Staff — Protected)
│   ├── Dashboard view (default)
│   ├── Bookings view
│   └── New Booking view (4-step form)
├── /branch-manager-dashboard (Manager/Admin — Protected)
│   ├── Dashboard (default — KPIs, charts, alerts)
│   ├── Bookings
│   ├── Calendar
│   ├── Reports
│   ├── Customers
│   ├── New Booking
│   ├── Attendance
│   ├── Performance
│   ├── Infrastructure
│   └── Audit Log
├── /booking-management-portal (Protected)
├── /booking-details-assignment-modal (Protected)
├── /booking-details/:bookingId (Protected)
└── /* (404 Page)
```

**Total routes**: 10+ (including parameterized)
**Total pages crawled**: 12 (across all roles)

---

## Feature Inventory

| # | Feature | Location | Status | Notes |
|---|---------|----------|--------|-------|
| 1 | Branch selection (5 branches) | `/` | Working | Cards with ratings, services, therapists, hours |
| 2 | Multi-step booking flow (5 steps) | `/` | Working | Branch → Service → Date/Time → Details → Confirm |
| 3 | Staff login with Supabase Auth | `/staff-login-authentication` | Working | Email/password, role-based redirect |
| 4 | Protected route enforcement | All dashboard routes | Working | Redirects to login |
| 5 | Staff dashboard — Today's appointments | `/branch-staff-dashboard` | Working | Filters, search, status legend |
| 6 | Staff — Therapist availability panel | `/branch-staff-dashboard` | Working | Real-time availability with specialties |
| 7 | Staff — Quick actions (Walk-in, Schedule) | `/branch-staff-dashboard` | Working | Add Walk-in, View Full Schedule |
| 8 | Staff — New Booking form (4 steps) | `/branch-staff-dashboard` (New Booking) | Working | Service → details flow within dashboard |
| 9 | Staff — Booking search & filters | `/branch-staff-dashboard` | Working | Search by ID/phone/email, date/service/status filters |
| 10 | Manager — Revenue KPI cards | `/branch-manager-dashboard` | Working | Today/Yesterday/Week/Month with Gross/Discount/Net |
| 11 | Manager — Room & Therapist utilization | `/branch-manager-dashboard` | Working | Bar charts per room and therapist |
| 12 | Manager — Hourly load chart | `/branch-manager-dashboard` | Working | Time-series chart 09:00-21:00 |
| 13 | Manager — Risk indicators | `/branch-manager-dashboard` | Working | Unpaid revenue, cancellation, discount usage, retention |
| 14 | Manager — Therapist utilization chart | `/branch-manager-dashboard` | Working | Workload distribution with Optimal/High Load/Overloaded |
| 15 | Manager — Booking pipeline | `/branch-manager-dashboard` | Working | Today's cumulative totals |
| 16 | Manager — Top performers | `/branch-manager-dashboard` | Working | Leaderboard with scores and revenue |
| 17 | Manager — Today's bookings list | `/branch-manager-dashboard` | Working | Filterable: All/Pending/Unassigned |
| 18 | Manager — Analytics period selector | `/branch-manager-dashboard` | Working | Today/Yesterday/Week/Month/Quarter/Custom + Export |
| 19 | Manager — Revenue analytics | `/branch-manager-dashboard` | Working | Revenue Trend / Service Popularity tabs |
| 20 | Manager — Alerts & Notifications | `/branch-manager-dashboard` | Working | Double booking, complaints, schedule changes |
| 21 | Manager — Discount approval | `/branch-manager-dashboard` | **BROKEN** | API 400 error: `discount_reason` column missing |
| 22 | Manager — Sidebar navigation (10 items) | `/branch-manager-dashboard` | Working | Dashboard, Bookings, Calendar, Reports, etc. |
| 23 | Manager — Quick Booking button | `/branch-manager-dashboard` | Working | Navigates to customer booking flow |
| 24 | Custom 404 page | `/*` | Working | "Go Back" and "Back to Home" buttons |
| 25 | Find Existing Booking | `/` header | **UX Issue** | Redirects customer to staff login page |

---

## Page-by-Page Analysis

### Homepage / Customer Booking Flow — `/`

**Load Time**: 943ms | **Status**: 200 | **Console Errors**: 0 | **Network Errors**: 0

**What's on this page**: Multi-step booking wizard starting with branch selection. Shows 5 branches (Kathmandu, Pokhara, Chitwan, Bhaktapur, Lalitpur) as cards with images, ratings, hours, available services, therapist counts, and phone numbers. Step progress indicator at top (Branch → Service → Date & Time → Details → Confirm).

**What works well**:
- Clean, professional design with consistent card layout
- Branch cards show rich information (ratings, hours, services, therapist gender breakdown)
- "Open Now" status indicators on each branch
- Clear progress stepper at top
- "Continue to Services" CTA clearly visible
- Footer with contact info and help section

**Issues found**:
- **[Major]** "Find Existing Booking" / "Manage Booking" header link navigates to `/staff-login-authentication` — a customer should not be sent to the staff login. This needs a customer-facing booking lookup page.
- **[Minor]** Header nav shows "(555) SPA-BOOK" — placeholder phone number instead of real Nepal number

**Mobile**: No horizontal overflow. Cards stack vertically. Fully responsive.

---

### Staff Login Page — `/staff-login-authentication`

**Load Time**: 553ms | **Status**: 200 | **Console Errors**: 0 | **Network Errors**: 0

**What's on this page**: Professional split-layout login page. Left side shows spa image with "Professional Spa Management" overlay plus security badges (SSL Secured, Nepal Certified, Data Protected). Right side has the login form.

**What works well**:
- SSL Secured badge and live timestamp in header
- Session timeout warning ("30 minutes of inactivity")
- "Customer Portal" link to navigate back
- Security trust indicators (SSL, Nepal Certified, GDPR)
- Clean footer with IT Support contact

**Issues found**:
- **[Major — Accessibility]** Email and password inputs are unlabeled — no `<label>` element or `aria-label` attribute. Screen readers cannot identify these fields.
- **[Minor]** "Forgot password?" link present but likely non-functional (no password reset flow observed)

---

### Staff Dashboard — `/branch-staff-dashboard`

**Load Time**: 1051ms | **Status**: 200 | **Console Errors**: 0 | **Network Errors**: 0

**What's on this page**: Three-column layout — Left: Quick Filters (search, date range, service type, booking status, today's overview counts). Center: Today's Appointments list. Right: Therapist Availability + Quick Actions.

**What works well**:
- Clean header with branch name (Lazimpat), date, time, and user info
- Top nav: Dashboard / Bookings / + New Booking
- Quick Filters with search, dropdowns, and status counters
- Therapist Availability panel shows real data with specialties and availability badges
- Quick Actions: "Add Walk-in Customer" and "View Full Schedule"
- Status legend with color coding (Pending/Confirmed/In Progress/Completed/Cancelled)

**Issues found**:
- **[Major — Accessibility]** 5 unlabeled form inputs: search field, date range select, service type select, booking status select, and 1 more
- **[Minor]** "No appointments today" shown — accurate for test data, but consider showing a sample/tutorial for first-time staff

**New Booking Sub-view**:
- 4-step flow: Select Service → (further steps)
- Shows all 8 services with duration and NPR pricing
- Clean card layout with descriptions
- Cancel and Next buttons properly placed

---

### Manager Dashboard — `/branch-manager-dashboard`

**Load Time**: 1759ms | **Status**: 200 | **Console Errors**: 2 | **Network Errors**: 1

**What's on this page**: Comprehensive management dashboard with sidebar navigation (10 items + Settings/Logout), and a dense main content area with KPIs, charts, tables, and alerts.

**What works well**:
- **Extremely feature-rich** — revenue cards, utilization charts, risk indicators, booking pipeline, top performers, analytics, alerts
- Sidebar with clear icon + label navigation
- Revenue KPI cards with period comparison (Today/Yesterday/Week/Month-to-Date)
- Room utilization (7 rooms) and Therapist utilization (5 therapists) with progress bars
- Hourly Load chart (09:00-21:00)
- Risk Indicators panel (Unpaid Revenue, Cancellation, Discount Usage, Retention)
- Therapist workload distribution chart with Optimal/High Load/Overloaded categories
- Top Performers leaderboard with scores
- Analytics period selector with Export options (PDF, Excel, CSV)
- Alerts & Notifications with categorized tabs (All/Unresolved/Urgent/Warnings)
- Alert actions: Resolve, Review, Approve buttons

**Issues found**:
- **[CRITICAL]** `fetchPendingDiscounts` API returns 400 error: **`column bookings.discount_reason does not exist`**. This error fires on EVERY manager/admin page load. The column is defined in `schema.sql:129` and `migration-002` but was never applied to the live database.
- **[Major — Accessibility]** 1 unlabeled select input (admin role shows this)
- **[Minor]** "Logout" text detected as a visible error element by audit (false positive — it's the sidebar logout button styled with a red/error-like class)

**Mobile**: The dashboard renders as a very long single-column scroll (~7500px height). While technically responsive with no overflow, the extreme length makes it hard to navigate on mobile. Consider collapsible sections or a mobile-specific simplified view.

---

### Booking Management Portal — `/booking-management-portal`

**Load Time**: 1016ms (staff) / 1682ms (manager) | **Status**: 200

**Staff role**: Loads correctly with search functionality and booking list.
**Manager/Admin role**: The route loads but redirects to the manager dashboard view. The search functionality is **not accessible** from the manager role because the portal shows the dashboard instead.

**Issues found**:
- **[Major]** Manager/Admin cannot access the Booking Management Portal separately — it shows the manager dashboard instead of the dedicated portal view. The search input is missing for manager role.

---

### Booking Details Assignment — `/booking-details-assignment-modal`

**Load Time**: 1092ms (staff) / 1694ms (manager) | **Status**: 200

Loads the respective dashboard for each role. This appears to be a page meant for displaying booking details, but without a specific booking ID parameter, it defaults to the dashboard view.

---

### 404 Page

**What works well**:
- Clean, minimal design with large "404" text
- Clear message: "The page you're looking for doesn't exist. Let's get you back!"
- Two action buttons: "Go Back" (with arrow) and "Back to Home"
- Consistent with app's design language

---

## User Flow Analysis

### Flow 1: Customer Booking (Public)

| Step | Result | Notes |
|------|--------|-------|
| Load homepage | PASS | 943ms, branch selection displayed |
| Branch cards visible | PASS | 5 branches with full details |
| Interactive elements | PASS | 7 visible buttons found |
| Click "Continue to Services" | PASS | Advances to service selection |
| Service selection | PASS | 8 services with NPR pricing |

**Verdict**: Core booking flow works well. The 5-step wizard (Branch → Service → Date/Time → Details → Confirm) is intuitive. One issue: "Find Existing Booking" sends customers to staff login instead of a customer-facing lookup.

### Flow 2: Staff Login & Dashboard

| Step | Result | Notes |
|------|--------|-------|
| Navigate to login | PASS | Professional login page loaded |
| Enter staff credentials | PASS | Fields filled successfully |
| Submit login | PASS | Redirected to `/branch-staff-dashboard` |
| Dashboard loads | PASS | Full dashboard with bookings, therapists |
| Navigate to New Booking | PASS | 4-step booking form accessible |
| Search functionality | PASS | Search input found and usable |
| Booking filters | PASS | Date range, service type, status filters |

**Verdict**: Staff flow is fully functional. Login, dashboard navigation, booking creation, and search all work correctly.

### Flow 3: Manager Login & Dashboard

| Step | Result | Notes |
|------|--------|-------|
| Navigate to login | PASS | Login page loaded |
| Enter manager credentials | PASS | Fields filled |
| Submit login | PASS | Redirected to `/branch-manager-dashboard` |
| KPIs visible | PASS | Revenue cards, utilization metrics |
| Charts present | PASS | 133+ SVG chart elements |
| Management features | PASS | Discount, alerts, analytics |
| Quick Booking | PASS | Navigates to customer booking flow |
| Discount approval area | PASS (UI) | Section visible, but API is broken |

**Verdict**: Manager dashboard is visually complete and feature-rich. The critical blocker is the broken `fetchPendingDiscounts` API call that fires on every page load.

### Flow 4: Protected Route Access Control

| Step | Result | Notes |
|------|--------|-------|
| `/branch-staff-dashboard` without auth | PASS | Redirected to login |
| `/branch-manager-dashboard` without auth | PASS | Redirected to login |
| `/booking-management-portal` without auth | PASS | Redirected to login |

**Verdict**: Route protection is working correctly. All protected routes redirect unauthenticated users to the login page.

### Flow 5: Mobile Responsiveness

| Step | Result | Notes |
|------|--------|-------|
| Homepage (390px) | PASS | No horizontal overflow |
| Login page (390px) | PASS | No horizontal overflow |
| Staff dashboard (390px) | PASS | Stacks vertically, all elements accessible |
| Manager dashboard (390px) | PASS | No overflow, but ~7500px tall |

**Verdict**: All pages are technically responsive with no horizontal overflow. The manager dashboard's extreme vertical length on mobile is a usability concern but not a functional issue.

---

## Error Log

### Critical Errors

| # | Page | Error | Type | Impact |
|---|------|-------|------|--------|
| 1 | Manager Dashboard | `column bookings.discount_reason does not exist` | API 400 | Discount approval broken; fires on every page load |
| 2 | Manager Booking Portal | Same as above | API 400 | Same error repeats |
| 3 | Manager Booking Details | Same as above | API 400 | Same error repeats |
| 4 | Admin Dashboard | Same as above | API 400 | Same error for admin role too |
| 5 | Admin Booking Portal | Same as above | API 400 | Same |
| 6 | Admin Booking Details | Same as above | API 400 | Same |

**Root Cause**: The `discount_reason` column is defined in `supabase/schema.sql:129` and `supabase/migration-002-missing-tables.sql:37`, but the migration was never applied to the live Supabase database. The `fetchPendingDiscounts` function in `src/services/api.js:466` queries this column, causing a 400 error.

**Fix Required**: Run `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discount_reason text;` on the live database, or apply migration-002.

### Warnings

| # | Page | Warning | Type |
|---|------|---------|------|
| 1 | All manager pages | 6 failed network requests (400) | Supabase REST API |

### Performance Notes

All pages load well within acceptable limits:

| Page | Load Time | Verdict |
|------|-----------|---------|
| Homepage | 943ms | Excellent |
| Customer Booking Flow | 542ms | Excellent |
| Staff Login | 553ms | Excellent |
| Staff Dashboard | 1051ms | Good |
| Manager Dashboard | 1759ms | Good (complex page) |
| Admin Dashboard | 1896ms | Good (complex page) |

---

## Accessibility Summary

| Check | Status | Details |
|-------|--------|---------|
| Images with alt text | PASS | No broken or alt-less images detected |
| Form labels — Login page | FAIL | 2 unlabeled inputs (email, password) |
| Form labels — Staff dashboard | FAIL | 5 unlabeled inputs (search + 4 selects) |
| Form labels — Manager dashboard | FAIL | 1 unlabeled select input |
| Color contrast | PASS | Good contrast throughout |
| Page language (`<html lang>`) | Not Set | Missing `lang` attribute |
| Keyboard navigation | Untested | |
| Screen reader compatibility | FAIL | Unlabeled inputs will be unreadable |

**Total unlabeled inputs found**: 8 across the application

---

## Recommendations

### Critical (Fix Immediately)

1. **Apply missing database migration** — Run `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discount_reason text;` on the live Supabase database. This fixes the `fetchPendingDiscounts` 400 error that fires on every manager/admin page load. Reference: `supabase/migration-002-missing-tables.sql:37`

### High Priority

2. **Fix "Find Existing Booking" routing** — The "Manage Booking" link in the customer header navigates to `/staff-login-authentication`. Customers should either see a booking lookup page (enter booking number + phone) or this link should be removed from the customer-facing header.

3. **Add ARIA labels to form inputs** — Add `aria-label` attributes to all unlabeled inputs:
   - Login page: email input, password input (`src/pages/staff-login-authentication/components/LoginForm.jsx`)
   - Staff dashboard: search input, 4 filter selects (`src/pages/branch-staff-dashboard/index.jsx`)
   - Manager dashboard: period select

4. **Fix Booking Management Portal routing for manager/admin** — Manager and admin roles are redirected to their dashboard instead of seeing the dedicated booking portal with search functionality.

### Medium Priority

5. **Add `<html lang="en">` attribute** — Set language attribute for screen readers and SEO.

6. **Manager dashboard mobile optimization** — Consider collapsible sections, tab navigation, or a simplified mobile view to reduce the ~7500px scroll height.

7. **Replace placeholder phone number** — Header shows "(555) SPA-BOOK" — replace with the actual Nepal contact number.

### Nice to Have

8. **Remove demo credentials from login page** — The production build shows staff/manager/admin credentials in a visible hint box. This should be removed or hidden behind a dev flag.

9. **Add loading skeletons** — Manager dashboard takes ~1.8s to load; skeleton loaders would improve perceived performance.

10. **Implement "Forgot Password" flow** — The link exists on the login page but appears non-functional.

---

## Screenshots Reference

All screenshots saved to `/tmp/web-audit/` with the following structure:

```
/tmp/web-audit/
├── pages/
│   ├── public/          — Homepage, login, 404 screenshots
│   ├── staff/           — Staff dashboard pages
│   ├── manager/         — Manager dashboard pages
│   └── admin/           — Admin dashboard pages
├── flows/
│   ├── public/          — Booking flow, protected route tests
│   ├── staff/           — Staff login, dashboard nav, new booking
│   ├── manager/         — Manager login, dashboard flow
│   ├── admin/           — Admin login, dashboard flow
│   └── mobile/          — Mobile viewport tests
└── full_audit_results.json  — Complete machine-readable results
```

---

## Technical Details

- **Browser**: Chromium (headless) via Playwright
- **Viewports tested**: 1920x1080 (desktop), 390x844 (mobile)
- **Pages crawled**: 12 (across 4 roles)
- **User flows tested**: 5
- **Total console errors**: 12 (all from same root cause)
- **Total network errors**: 6 (all from same root cause)
- **Total time**: ~2 minutes
