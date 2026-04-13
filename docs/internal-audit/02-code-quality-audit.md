# Code Quality Audit

**Date:** 2026-03-08

---

## CRITICAL Issues

### 1. Demo Credentials Exposed in Production UI

**File:** `src/pages/login/components/LoginForm.jsx:248-263`
**Severity:** Critical
**Category:** Security

Plaintext demo credentials (emails + passwords for staff, manager, admin roles) are hardcoded directly in the login form JSX. These ship in the production bundle and are visible to anyone.

**Recommended Fix:** Remove entirely or gate behind `VITE_SHOW_DEMO_CREDS=true` env var.

---

### 2. Sourcemaps Shipped in Production

**File:** `package.json:36`
**Severity:** Critical
**Category:** Security

Build script uses `vite build --sourcemap` which generates full sourcemaps in production, exposing all source code.

**Recommended Fix:** Remove `--sourcemap` or use `--sourcemap hidden`.

---

## HIGH Issues

### 3. `handleClose` Stale Closure in Escape Key Listener

**File:** `src/pages/booking-details-assignment-modal/index.jsx:152-158`
**Severity:** High
**Category:** Best Practice

The `useEffect` for Escape key has empty dependency array `[]`, but `handleClose` references `location.state` and `userRole` which can change.

**Recommended Fix:** Add `handleClose` to dependency array, wrap in `useCallback`.

---

### 4. Missing `loadData` in useEffect Dependencies

**File:** `src/pages/branch-staff-dashboard/index.jsx:92-94`
**Severity:** High
**Category:** Best Practice

Effect calls `loadData(filters.dateRange)` but deps are `[branchId, filters.dateRange]` instead of `[loadData]`.

**Recommended Fix:** Use `[loadData]` since it's already a `useCallback`.

---

### 5. `loadAdminBranches` Not Wrapped in useCallback

**File:** `src/contexts/BranchContext.jsx:48-50`
**Severity:** High
**Category:** Best Practice

Regular function inside component body used in useEffect without being in deps array.

**Recommended Fix:** Wrap in `useCallback`, include in deps.

---

### 6. Uncleared Timeouts on Unmount

**Files:**
- `src/pages/branch-staff-dashboard/index.jsx:152,157`
- `src/pages/booking-management-portal/index.jsx:85`
- `src/pages/booking-details-assignment-modal/index.jsx:95`

**Severity:** High
**Category:** Memory Leak

Multiple `setTimeout` calls for toast auto-dismiss without cleanup on unmount.

**Recommended Fix:** Store timeout IDs with `useRef`, clear in useEffect cleanup.

---

### 7. Missing Security Headers in Nginx

**File:** `nginx.conf`
**Severity:** High
**Category:** Security

Missing: `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`, `Referrer-Policy`, `Permissions-Policy`.

**Recommended Fix:** Add security headers to nginx `server` block.

---

## MEDIUM Issues

### 8. `console.log` Debug Statements in Production

**Files:**
- `src/pages/branch-manager-dashboard/index.jsx:120,124`
- `src/pages/booking-details-assignment-modal/index.jsx:131`

**Severity:** Medium
**Category:** Consistency

Debug `console.log` calls that should not ship in production.

---

### 9. `key={index}` on Dynamic Lists

**Files:** 15+ occurrences across codebase
**Severity:** Medium
**Category:** Best Practice

Array index as React key on lists that could be reordered/filtered.

**Recommended Fix:** Use stable unique identifiers.

---

### 10. Raw `z-10` Instead of Semantic Tokens

**Files:**
- `src/pages/customer-booking-flow/components/ProgressIndicator.jsx:14`
- `src/pages/branch-manager-dashboard/components/CRM/CustomerProfileModal.jsx:71`
- `src/pages/branch-manager-dashboard/index.jsx:235`

**Severity:** Medium
**Category:** Consistency

Violates established z-index convention (semantic tokens in tailwind.config.js).

---

### 11. Dead `AuthenticationModal.jsx`

**File:** `src/components/ui/AuthenticationModal.jsx`
**Severity:** Medium
**Category:** Dead Code

Simulates authentication with `setTimeout`. Does not use real auth. Appears to be from an earlier prototype.

**Recommended Fix:** Remove if unused.

---

### 12. Missing `React.StrictMode`

**File:** `src/index.jsx:10`
**Severity:** Medium
**Category:** Best Practice

App not wrapped in `<React.StrictMode>`.

---

### 13. Unused npm Dependencies

**File:** `package.json`
**Severity:** Medium
**Category:** Performance

Never imported: `axios`, `redux`, `@reduxjs/toolkit`, `d3`, `framer-motion`, `dotenv`, `react-hook-form`, `react-router-hash-link`. The `chunkSizeWarningLimit: 2000` masks this.

**Recommended Fix:** Run `npx depcheck` and remove unused deps.

---

### 14. Profile Dropdown Doesn't Close on Outside Click

**File:** `src/pages/branch-staff-dashboard/components/StaffHeader.jsx:117-169`
**Severity:** Medium
**Category:** UX

No click-outside handler to close the dropdown.

---

### 15. `Button` Missing `displayName` for `forwardRef`

**File:** `src/components/ui/Button.jsx:134`
**Severity:** Medium
**Category:** Best Practice

Shows as "ForwardRef" in React DevTools.

---

### 16. `user?.id` in useEffect Dependency

**File:** `src/contexts/AuthContext.jsx:168`
**Severity:** Medium
**Category:** Best Practice

Optional chaining in dependency array is flagged by exhaustive-deps rule.

---

## LOW Issues

### 17. No `aria-*` Attributes Anywhere

**Severity:** Low
**Category:** Accessibility

Zero ARIA attributes in the entire codebase. Screen readers cannot navigate the app.

**Recommended Fix:** Start with `role="dialog"` on modals, `aria-label` on icon buttons, `role="alert"` on toasts.

---

### 18. Simulated Delays in Booking Flow

**Files:**
- `src/pages/customer-booking-flow/index.jsx:85` (500ms)
- `src/pages/booking-management-portal/components/RescheduleModal.jsx:34` (1500ms)
- `src/pages/booking-management-portal/components/CancellationModal.jsx:45` (1500ms)

**Severity:** Low
**Category:** Performance

Artificial `setTimeout` delays from mock data era.

---

### 19. Vite Config Port Is a String

**File:** `vite.config.mjs:12`
**Severity:** Low
**Category:** Consistency

`port: "4028"` should be `port: 4028`.

---

### 20. Mobile Navigation Crowded

**File:** `src/components/ui/StaffSidebar.jsx:228-252`
**Severity:** Low
**Category:** UX

Mobile bottom nav renders ALL items (up to 10 for managers).

---

### 21. ErrorBoundary Doesn't Reset on Navigation

**File:** `src/components/ErrorBoundary.jsx`
**Severity:** Low
**Category:** Best Practice

Once caught, `hasError` stays `true` until full page reload.

---

### 22. AppIcon Imports Entire Lucide Library

**File:** `src/components/AppIcon.jsx:2`
**Severity:** Low
**Category:** Performance

`import * as LucideIcons from 'lucide-react'` — acceptable for dynamic pattern but monitor bundle size.

---

## Patterns Done WELL

1. **Consistent API service layer** — Every function returns `{ data, error }` tuples
2. **Auth context with race condition protection** — `signInActiveRef` guard
3. **Design system consistency** — Complete Tailwind token system
4. **Proper separation of concerns** — `bookingTransformers.js`, `serviceEnrichment.js`
5. **Z-index semantic tokens** — Used correctly in vast majority of codebase
6. **Protected route pattern** — Loading, auth, role checks all clean
7. **Financial immutability guards** — `is_locked`, terminal status checks, payment uniqueness
8. **Form validation in booking flow** — Step-by-step with localStorage recovery
9. **Supabase client configuration** — Simple, clean, env vars
