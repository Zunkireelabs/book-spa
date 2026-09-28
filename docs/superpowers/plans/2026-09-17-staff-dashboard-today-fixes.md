# Staff Dashboard Today-Only Panels — Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two gaps found in PR #263 (`feat/staff-dashboard-today-revenue`): the staff dashboard's "today" date can go stale while the tab stays open, and its Total Sales insights panel silently shows `0` for gift-voucher figures a staff user's role isn't allowed to read, instead of hiding those rows.

**Architecture:** No new components. Task 1 replaces a module-level constant with a `useMemo` derived from state the staff dashboard already ticks every 60s, mirroring the "recompute on date change" behavior the manager dashboard gets for free from its `PeriodFilter` re-selection. Task 2 adds an opt-out prop to the shared `TodayInsightsPanel` so the staff dashboard can hide voucher rows it knows will always read zero for that role, while leaving the manager/admin dashboard's default behavior untouched.

**Tech Stack:** React 18 function components + hooks, Tailwind CSS. No backend/RLS changes — role restriction on `vouchers`/`voucher_claims`/`voucher_payments` (staff excluded) is an existing, intentional product decision (see `supabase/migration-072-vouchers.sql:30-31`) and stays as-is.

**Spec:** This plan is self-contained — findings below are the spec.

## Background (why these are bugs)

**Bug 1 — stale date.** `branch-staff-dashboard/index.jsx` currently has:
```js
const TODAY_PERIOD = { key: 'daily', from: getTodayISO(), to: getTodayISO() };
```
declared at module scope, outside the component. It is evaluated exactly once per JS bundle load, not per render. The staff dashboard has no period picker (unlike the manager dashboard, where re-selecting "Today" from `PeriodFilter` recomputes the date), so once midnight passes with the tab still open, `RevenueCards`/`TodayInsightsPanel` keep querying yesterday's date under a "Today" label until a hard reload.

**Bug 2 — misleading zeroed voucher rows.** `getTodayInsights()` (consumed by `TodayInsightsPanel`) queries `vouchers`, `voucher_claims`, and `voucher_payments` directly (no RPC, no `SECURITY DEFINER`). RLS policies in `migration-072-vouchers.sql` and `migration-100-voucher-payments.sql` restrict `SELECT` on those three tables to `manager`/`admin`/`admin_viewer` only — staff is deliberately excluded ("vouchers are not part of the staff workflow for now"). Under RLS, a staff query against those tables returns an empty set rather than an error, so `data.voucherDistributed`/`data.voucherClaimed` compute as `{ count: 0, value: 0 }` for a staff caller even when real voucher activity happened today. `TodayInsightsPanel.jsx` renders "Gift Vouchers 0 · NPR 0" in both the Sold and Redeemed columns regardless — a staff user reading the panel has no way to know that `0` means "not visible to my role" rather than "nothing happened."

## Global Constraints

- Don't touch RLS/migrations — the staff exclusion on vouchers is intentional and out of scope.
- Don't change manager/admin dashboard behavior — `TodayInsightsPanel`'s existing callers must keep seeing voucher rows exactly as today.
- Follow existing code conventions in this repo: Tailwind utility classes, no new UI library, `useMemo`/`useState`/`useEffect` patterns already used in these two files.
- Run `npm run build` and `npm test` (vitest) after each task; both must stay green.

---

### Task 1: Fix stale "today" date in the staff dashboard

**Files:**
- Modify: `src/pages/branch-staff-dashboard/index.jsx:25-28` (the `TODAY_PERIOD` constant and its import block) and the render call site around line 596-597.

**Interfaces:**
- Consumes: `getTodayISO()` from `src/utils/periodPresets.js` (unchanged signature: `() => string`, e.g. `'2026-09-17'`).
- Produces: a `todayPeriod` value of shape `{ key: 'daily', from: string, to: string }`, passed to `<RevenueCards period={...} todayOnly />` and `<TodayInsightsPanel period={...} />` exactly as today — no prop-shape change for those two components in this task.

The component already ticks a clock every 60s:
```js
const [currentTime, setCurrentTime] = useState(new Date());
...
useEffect(() => {
  const timer = setInterval(() => setCurrentTime(new Date()), 60000);
  return () => clearInterval(timer);
}, []);
```
Reuse that tick to detect a calendar-date rollover and recompute the period only when the date string actually changes (not on every 60s tick, to avoid needless re-fetches in `RevenueCards`/`TodayInsightsPanel`, whose `useEffect` deps include `period.from`/`period.to`).

- [ ] **Step 1: Remove the module-level constant**

In `src/pages/branch-staff-dashboard/index.jsx`, delete:
```js
import { getTodayISO } from '../../utils/periodPresets';

// Staff dashboard always shows today's figures only — no period picker.
const TODAY_PERIOD = { key: 'daily', from: getTodayISO(), to: getTodayISO() };
```
Replace the import line with:
```js
import { getTodayISO } from '../../utils/periodPresets';
```
(keep the import — it's used inside the component now — just drop the two comment/constant lines below it).

- [ ] **Step 2: Add a `useMemo` derived from `currentTime` inside the component**

Find this existing block inside `BranchStaffDashboard`:
```js
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
```
Immediately after the `currentTime` state declaration (still above the `filters` state block), add:
```js
  // Recomputes only when the calendar date actually rolls over (via the
  // 60s currentTime tick below), not on every tick — avoids re-fetching
  // RevenueCards/TodayInsightsPanel every minute for no reason.
  const todayDateStr = getTodayISO();
  const todayPeriod = useMemo(
    () => ({ key: 'daily', from: todayDateStr, to: todayDateStr }),
    [todayDateStr]
  );
```
Note `todayDateStr` is recomputed on every render (cheap — it's a `new Date()` + string format), but `todayPeriod` (the object identity that matters for downstream `useEffect` deps) only changes when the *value* of `todayDateStr` changes, thanks to `useMemo`'s dependency check. Since `currentTime` updates every 60s and this component re-renders on that state change, `todayDateStr` gets re-evaluated every 60s too — the calendar-date rollover will be picked up within 60s of midnight, not just on reload.

Add `useMemo` to the React import at the top of the file:
```js
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
```

- [ ] **Step 3: Update the two render call sites**

Change:
```js
              <RevenueCards branchId={branchId} period={TODAY_PERIOD} todayOnly />
              <TodayInsightsPanel branchId={branchId} period={TODAY_PERIOD} />
```
to:
```js
              <RevenueCards branchId={branchId} period={todayPeriod} todayOnly />
              <TodayInsightsPanel branchId={branchId} period={todayPeriod} />
```

- [ ] **Step 4: Build and manually verify**

Run: `npm run build`
Expected: succeeds with no errors (same warning about chunk size as before is fine, unrelated).

Run: `npm test -- --run`
Expected: all existing tests still pass (this change touches no tested logic — there are no existing unit tests for this component — so the count should stay the same as before this task).

Manual check (no automated test exists for this — it's a timing behavior): log in as a `staff` user on staging, open the dashboard, confirm the Today card and insights panel still render with correct data (no regression from the refactor).

- [ ] **Step 5: Commit**

```bash
git add src/pages/branch-staff-dashboard/index.jsx
git commit -m "fix(staff-dashboard): recompute today's date on rollover, not just on page load"
```

---

### Task 2: Hide gift-voucher rows in `TodayInsightsPanel` for roles that can't read them

**Files:**
- Modify: `src/pages/branch-manager-dashboard/components/TodayInsightsPanel.jsx` (add an opt-out prop, default `true`, matching the `todayOnly` opt-in pattern already used on `RevenueCards`).
- Modify: `src/pages/branch-staff-dashboard/index.jsx` (pass the new prop as `false` at its `<TodayInsightsPanel />` call site).

**Interfaces:**
- Consumes: nothing new from Task 1 beyond the `todayPeriod` value already produced there.
- Produces: `TodayInsightsPanel` gains a new prop `showVouchers` (boolean, default `true`). When `false`, the "Gift Vouchers" row is omitted from both the Sold and Redeemed columns in Section 2. No other prop or export changes.

- [ ] **Step 1: Add the `showVouchers` prop to `TodayInsightsPanel`**

In `src/pages/branch-manager-dashboard/components/TodayInsightsPanel.jsx`, change the component signature:
```js
const TodayInsightsPanel = ({ branchId, period }) => {
```
to:
```js
const TodayInsightsPanel = ({ branchId, period, showVouchers = true }) => {
```

- [ ] **Step 2: Guard the "Gift Vouchers" row in the Sold column**

Find (Section 2, Sold column):
```jsx
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Gift Vouchers</span>
            <span className="text-sm font-semibold text-gray-900">
              {data.voucherDistributed.count} · {formatNPR(data.voucherDistributed.value)}
            </span>
          </div>
```
Wrap it:
```jsx
          {showVouchers && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Gift Vouchers</span>
              <span className="text-sm font-semibold text-gray-900">
                {data.voucherDistributed.count} · {formatNPR(data.voucherDistributed.value)}
              </span>
            </div>
          )}
```

- [ ] **Step 3: Guard the "Gift Vouchers" row in the Redeemed column**

Find (Section 2, Redeemed column):
```jsx
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Gift Vouchers</span>
            <span className="text-sm font-semibold text-gray-900">
              {data.voucherClaimed.count} · {formatNPR(data.voucherClaimed.value)}
            </span>
          </div>
```
Wrap it the same way:
```jsx
          {showVouchers && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Gift Vouchers</span>
              <span className="text-sm font-semibold text-gray-900">
                {data.voucherClaimed.count} · {formatNPR(data.voucherClaimed.value)}
              </span>
            </div>
          )}
```

- [ ] **Step 4: Pass `showVouchers={false}` from the staff dashboard**

In `src/pages/branch-staff-dashboard/index.jsx`, change:
```js
              <TodayInsightsPanel branchId={branchId} period={todayPeriod} />
```
to:
```js
              <TodayInsightsPanel branchId={branchId} period={todayPeriod} showVouchers={false} />
```
(Leave the manager dashboard's own call site in `src/pages/branch-manager-dashboard/index.jsx` untouched — it doesn't pass `showVouchers`, so it keeps the `true` default and is unaffected.)

- [ ] **Step 5: Build and manually verify**

Run: `npm run build`
Expected: succeeds with no errors.

Run: `npm test -- --run`
Expected: all existing tests still pass.

Manual check: log in as `staff` on staging — confirm the "Sold" and "Redeemed" columns no longer show a "Gift Vouchers" row at all (not even a `0`). Log in as `manager` or `admin` — confirm the "Gift Vouchers" row still appears exactly as before, including whatever nonzero values are real for that branch/day.

- [ ] **Step 6: Commit**

```bash
git add src/pages/branch-manager-dashboard/components/TodayInsightsPanel.jsx src/pages/branch-staff-dashboard/index.jsx
git commit -m "fix(staff-dashboard): hide gift-voucher rows staff role can't actually see data for"
```

---

## Self-Review

- **Spec coverage:** Bug 1 (stale date) → Task 1. Bug 2 (misleading zeroed vouchers) → Task 2. Both findings from the background research are addressed; no third gap was found.
- **Placeholder scan:** No TBD/TODO markers; every step has literal code to paste, not a description of intent.
- **Type consistency:** `todayPeriod` (Task 1) has the same `{ key, from, to }` shape `RevenueCards`/`TodayInsightsPanel` already expect — no signature mismatch introduced. `showVouchers` (Task 2) is a plain boolean prop with a safe default, so every existing caller of `TodayInsightsPanel` (currently only the manager dashboard) keeps compiling and behaving identically without modification.
