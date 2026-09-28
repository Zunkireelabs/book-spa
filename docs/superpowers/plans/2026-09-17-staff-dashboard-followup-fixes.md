# Staff Dashboard Follow-up Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 3 pre-existing bugs deferred out of PR #263's scope: (1) staff's "Total Sales" figure silently undercounts by excluding gift-voucher revenue with no indication why, (2) the bookings list computes "today" via UTC instead of Nepal-local time, which can show the wrong calendar day for ~5h45m after Nepal midnight, and (3) the bookings list never refreshes on its own when the calendar date rolls over — only a booking mutation or a manual filter change triggers a re-fetch.

**Architecture:** No new components or DB changes. Task 1 adds a caption to the existing `TodayInsightsPanel` (same file already touched by PR #263's `showVouchers` prop). Task 2 replaces ad hoc UTC date formatting with the existing Nepal-local `toISO`/`getTodayISO` helpers from `utils/periodPresets.js` (already used elsewhere in these same files) — a pure string-format swap, no behavior change beyond correctness. Task 3 adds a small calendar-date-rollover watcher to both `branch-staff-dashboard/index.jsx` and `BookingsViewPanel.jsx`, reusing the clock-tick pattern already present in `branch-staff-dashboard/index.jsx` (and adding an equivalent one to `BookingsViewPanel.jsx`, which currently has no timer at all).

**Tech Stack:** React 18 function components + hooks. No backend/RLS changes — the voucher-revenue exclusion for staff is an intentional, existing RLS policy (`vouchers`/`voucher_payments` restricted to manager/admin/admin_viewer, see `supabase/migration-072-vouchers.sql:30-31` and `migration-100-voucher-payments.sql`); Task 1 only makes the resulting number's meaning honest, it does not try to show staff the excluded money.

**Spec:** This plan is self-contained — findings below are the spec.

## Background (why these are bugs)

**Bug A — misleading "Total Sales" total for staff.** `getTodayInsights()` in `src/services/api.js:3307-3486` computes `totalSales` by summing two sources: `payments` (booking payments, lines 3338-3357, staff can read this fine) and `voucher_payments` (voucher sales, lines 3359-3389, gated behind a `vouchers` lookup at lines 3366-3373 that RLS restricts to manager/admin/admin_viewer). For a staff caller, the `vouchers` query at line 3372 returns an empty set under RLS, so `voucherIdsInRange.length === 0` and the entire `voucher_payments` block (lines 3376-3389) never runs — `totalSales` for staff is booking-payments only, silently missing any voucher revenue collected that day, with nothing on screen indicating the number is partial.

**Bug B — UTC instead of Nepal-local "today".** Both `src/pages/branch-staff-dashboard/index.jsx` and `src/pages/branch-manager-dashboard/components/BookingsViewPanel.jsx` format "today" using `d.toISOString().split('T')[0]`, which is UTC. The codebase already has a Nepal-local-safe helper for exactly this — `toISO(d)` / `getTodayISO()` in `src/utils/periodPresets.js:16-25` — already used elsewhere in `branch-staff-dashboard/index.jsx` (for `todayPeriod`, added in PR #263) and in `branch-manager-dashboard/index.jsx`. Nepal is UTC+5:45, so any UTC-based "today" calculation is wrong for the last ~5h45m of the Nepal calendar day (e.g. at 11pm Nepal time, UTC has already rolled to the next day) — bookings list and stat cards can disagree with the revenue panels sitting right next to them, which correctly use `getTodayISO()`.

**Bug C — no refresh on calendar-date rollover.** In `branch-staff-dashboard/index.jsx`, `loadData` only runs on mount, on `filters.dateRange` change, or on a realtime `bookings` table event (lines 187-238). If a staff user leaves the tab open past midnight with no booking activity happening, the "Today" bookings list keeps showing yesterday's date's data indefinitely — there's no timer forcing a re-fetch. The file already ticks a `currentTime` clock every 60s for the header display; nothing else consumes it. `BookingsViewPanel.jsx` (now also used as staff's "Bookings" nav page per PR #263) has the same gap and no clock timer at all to hook into.

## Global Constraints

- Don't touch RLS/migrations — the voucher-revenue restriction on staff is intentional and out of scope.
- Don't change manager/admin behavior for Bug A — the caption only applies when the panel is rendered with `showVouchers={false}` (currently only the staff dashboard).
- Reuse `toISO`/`getTodayISO` from `src/utils/periodPresets.js` for all "today" string formatting touched by this plan — don't introduce a second date-formatting convention.
- Run `npm run build` and `npm test -- --run` after each task; both must stay green (74 tests as of this writing).

---

### Task 1: Caption staff's "Total Sales" figure as excluding gift-voucher revenue

**Files:**
- Modify: `src/pages/branch-manager-dashboard/components/TodayInsightsPanel.jsx`

**Interfaces:**
- Consumes: the existing `showVouchers` prop (added in PR #263, default `true`) — no new prop needed, this task reuses it as the same signal.
- Produces: no new exports; purely a conditional caption in the existing JSX.

- [ ] **Step 1: Add the caption**

Find (Section 1, right under the Total Sales header):
```jsx
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Total Sales · {periodLabel(period)}
          </span>
        </div>
        <p className="text-2xl font-semibold text-gray-900">{formatNPR(totalSales)}</p>
```
Change to:
```jsx
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Total Sales · {periodLabel(period)}
          </span>
        </div>
        <p className="text-2xl font-semibold text-gray-900">{formatNPR(totalSales)}</p>
        {!showVouchers && (
          <p className="text-[11px] text-gray-400">Excludes gift voucher sales</p>
        )}
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: succeeds with no errors.

Run: `npm test -- --run`
Expected: 74 tests pass (no test covers this component; count unchanged).

Manual check: log in as `staff` on staging — confirm the small "Excludes gift voucher sales" line appears under the Total Sales figure. Log in as `manager`/`admin` — confirm it does NOT appear (they still see the full total including vouchers, unlabeled, exactly as before).

- [ ] **Step 3: Commit**

```bash
git add src/pages/branch-manager-dashboard/components/TodayInsightsPanel.jsx
git commit -m "fix(insights-panel): caption staff's Total Sales as excluding voucher revenue"
```

---

### Task 2: Use Nepal-local date instead of UTC in the bookings list

**Files:**
- Modify: `src/pages/branch-staff-dashboard/index.jsx` (`formatDate` at line 81, `fmt` inside `getDateFilter` at line 116)
- Modify: `src/pages/branch-manager-dashboard/components/BookingsViewPanel.jsx` (`fmt` inside `getDateFilter` at line 29)

**Interfaces:**
- Consumes: `toISO` from `src/utils/periodPresets.js` — signature `(d: Date) => string` (e.g. `'2026-09-17'`), Nepal-local (browser local time) instead of UTC. Already imported as `getTodayISO` in `branch-staff-dashboard/index.jsx`; this task adds `toISO` alongside it.
- Produces: no shape change — `formatDate`/`fmt` still return the same `YYYY-MM-DD` string type, just computed correctly.

- [ ] **Step 1: Import `toISO` in `branch-staff-dashboard/index.jsx`**

Find:
```js
import { getTodayISO } from '../../utils/periodPresets';
```
Change to:
```js
import { getTodayISO, toISO } from '../../utils/periodPresets';
```

- [ ] **Step 2: Fix `formatDate`**

Find (line 81):
```js
  // Helper to format date as YYYY-MM-DD
  const formatDate = useCallback((d) => d.toISOString().split('T')[0], []);
```
Change to:
```js
  // Helper to format date as YYYY-MM-DD (Nepal-local, not UTC)
  const formatDate = useCallback((d) => toISO(d), []);
```

- [ ] **Step 3: Fix `getDateFilter`'s `fmt`**

Find (inside `getDateFilter`, line 116):
```js
  const getDateFilter = useCallback((dateRange) => {
    const today = new Date();
    const fmt = (d) => d.toISOString().split('T')[0];
```
Change to:
```js
  const getDateFilter = useCallback((dateRange) => {
    const today = new Date();
    const fmt = (d) => toISO(d);
```

- [ ] **Step 4: Apply the same fix to `BookingsViewPanel.jsx`**

In `src/pages/branch-manager-dashboard/components/BookingsViewPanel.jsx`, add the import:
```js
import { toISO } from '../../../utils/periodPresets';
```
Find (inside `getDateFilter`, line 27-29):
```js
  const getDateFilter = useCallback((dateRange) => {
    const today = new Date();
    const fmt = (d) => d.toISOString().split('T')[0];
```
Change to:
```js
  const getDateFilter = useCallback((dateRange) => {
    const today = new Date();
    const fmt = (d) => toISO(d);
```

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: succeeds with no errors.

Run: `npm test -- --run`
Expected: 74 tests pass.

Manual check: no automated test covers timezone-dependent behavior directly. If possible, verify by temporarily setting the system clock/browser timezone to simulate ~11pm–11:59pm Nepal time and confirming the bookings list and stat cards still show "today" (not tomorrow) — otherwise, note in the PR description that this was verified by code inspection only (the fix is a direct swap to a helper already proven correct elsewhere in the same files).

- [ ] **Step 6: Commit**

```bash
git add src/pages/branch-staff-dashboard/index.jsx src/pages/branch-manager-dashboard/components/BookingsViewPanel.jsx
git commit -m "fix(bookings-list): compute today's date in Nepal-local time, not UTC"
```

---

### Task 3: Refresh the bookings list on calendar-date rollover

**Files:**
- Modify: `src/pages/branch-staff-dashboard/index.jsx`
- Modify: `src/pages/branch-manager-dashboard/components/BookingsViewPanel.jsx`

**Interfaces:**
- Consumes: `getTodayISO()` from `src/utils/periodPresets.js` (already imported in both files after Task 2's changes — `BookingsViewPanel.jsx` needs it added).
- Produces: no new exports; an internal `useEffect` in each component that calls the existing `loadData` when the Nepal-local calendar date changes while viewing `dateRange === 'today'`.

- [ ] **Step 1: Add a date-rollover effect in `branch-staff-dashboard/index.jsx`**

This file already ticks `currentTime` every 60s (existing code, unchanged):
```js
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
```
Add a new effect right after it that watches for the calendar date changing and re-fetches when the user is viewing "today":
```js
  // Re-fetch when the Nepal-local calendar date rolls over while viewing
  // "today" — otherwise the list can sit on yesterday's data indefinitely
  // if no booking mutation/realtime event happens to trigger a refresh.
  const currentDateStr = getTodayISO();
  const lastLoadedDateRef = useRef(currentDateStr);
  useEffect(() => {
    if (filters.dateRange === 'today' && currentDateStr !== lastLoadedDateRef.current) {
      lastLoadedDateRef.current = currentDateStr;
      loadData('today');
    }
  }, [currentDateStr, filters.dateRange, loadData]);
```
Note `currentDateStr` re-evaluates every render, and this component re-renders every 60s via the `currentTime` tick, so the effect's dependency check will catch the rollover within 60s of Nepal midnight without adding a second timer.

- [ ] **Step 2: Verify `useRef` is already imported**

`branch-staff-dashboard/index.jsx` already imports `useRef` (used for `profileDropdownRef`, `dateRangeRef`) — no import change needed for this file.

- [ ] **Step 3: Add the same pattern to `BookingsViewPanel.jsx`**

This file has no clock tick at all yet. Add one plus the same rollover effect. First, update the React import:
```js
import React, { useState, useEffect, useCallback, useRef } from 'react';
```
Add the import for `getTodayISO` (alongside the `toISO` import from Task 2):
```js
import { toISO, getTodayISO } from '../../../utils/periodPresets';
```
Then, inside the component, right after the `bookingCounts` state declaration:
```js
  const [bookingCounts, setBookingCounts] = useState({
    confirmed: 0, pending: 0, inProgress: 0, completed: 0
  });

  // Tick every 60s purely to detect a Nepal-local calendar-date rollover
  // (no header clock in this panel to piggyback on, unlike the staff
  // dashboard's own view) and re-fetch "today" data when it happens.
  const [, forceDateCheck] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => forceDateCheck((n) => n + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  const currentDateStr = getTodayISO();
  const lastLoadedDateRef = useRef(currentDateStr);
  useEffect(() => {
    if (filters.dateRange === 'today' && currentDateStr !== lastLoadedDateRef.current) {
      lastLoadedDateRef.current = currentDateStr;
      loadData('today');
    }
  }, [currentDateStr, filters.dateRange, loadData]);
```

- [ ] **Step 4: Build and verify**

Run: `npm run build`
Expected: succeeds with no errors.

Run: `npm test -- --run`
Expected: 74 tests pass.

Manual check: no automated test covers this timing behavior. Verify by code inspection (the effect's dependency array and guard condition are straightforward), and optionally by manually changing the system clock forward past midnight while the dashboard tab is open, confirming the list refreshes within ~60s without any manual action.

- [ ] **Step 5: Commit**

```bash
git add src/pages/branch-staff-dashboard/index.jsx src/pages/branch-manager-dashboard/components/BookingsViewPanel.jsx
git commit -m "fix(bookings-list): auto-refresh on calendar-date rollover, not just on mutation"
```

---

## Self-Review

- **Spec coverage:** Bug A (misleading total) → Task 1. Bug B (UTC vs Nepal-local) → Task 2, applied to both files that had the bug. Bug C (no rollover refresh) → Task 3, applied to both files, including adding a timer to `BookingsViewPanel.jsx` which had none.
- **Placeholder scan:** No TBD/TODO; every step has literal before/after code.
- **Type consistency:** `toISO`/`getTodayISO` return the same `string` (`YYYY-MM-DD`) type `formatDate`/`fmt`/`getDateFilter` already return — no signature mismatch. The new `currentDateStr`/`lastLoadedDateRef` pattern in Task 3 is duplicated identically across both files (staff dashboard reuses its own existing timer; `BookingsViewPanel.jsx` gets an equivalent new one) so both call `loadData('today')` the same way their existing `loadData` already accepts (`loadData(dateRange)` in both files, confirmed in Background section).
