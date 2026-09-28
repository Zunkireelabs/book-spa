# Dedupe Redundant getTodayISO() Call Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `branch-staff-dashboard/index.jsx` calls `getTodayISO()` twice per render (`todayDateStr` at line 46 for the revenue period, `currentDateStr` at line 454 for the bookings-list rollover watcher) — same value, computed redundantly. Reuse the single existing `todayDateStr` for both purposes.

**Architecture:** No new state, no behavior change. Delete the second `getTodayISO()` call and its local variable; rename its remaining usages to the existing `todayDateStr`.

**Tech Stack:** React 18 function component, no new dependencies.

**Spec:** This plan is self-contained — the finding is the spec.

## Global Constraints

- No behavior change — both watchers must keep working exactly as before (revenue period recompute + bookings-list rollover refresh), only the redundant computation is removed.
- Run `npm run build` and `npm test -- --run` after the change; both must stay green (74 tests as of this writing).

---

### Task 1: Reuse `todayDateStr` instead of a second `getTodayISO()` call

**Files:**
- Modify: `src/pages/branch-staff-dashboard/index.jsx`

**Interfaces:**
- Consumes: the existing `todayDateStr` (line 46, `const todayDateStr = getTodayISO();`) — already computed once near the top of the component, before this task's change.
- Produces: no new exports or props; `lastLoadedDateRef`'s `useEffect` dependency changes from `currentDateStr` to `todayDateStr`, same string value, same behavior.

- [ ] **Step 1: Remove the redundant `currentDateStr` computation**

Find (around line 451-455):
```js
  // Re-fetch when the Nepal-local calendar date rolls over while viewing
  // "today" — otherwise the list can sit on yesterday's data indefinitely
  // if no booking mutation/realtime event happens to trigger a refresh.
  const currentDateStr = getTodayISO();
  const lastLoadedDateRef = useRef(currentDateStr);
```
Change to:
```js
  // Re-fetch when the Nepal-local calendar date rolls over while viewing
  // "today" — otherwise the list can sit on yesterday's data indefinitely
  // if no booking mutation/realtime event happens to trigger a refresh.
  // Reuses todayDateStr (declared near the top of the component, also
  // used for todayPeriod) instead of a second getTodayISO() call.
  const lastLoadedDateRef = useRef(todayDateStr);
```

- [ ] **Step 2: Update the effect to reference `todayDateStr`**

Find (immediately after, around line 456-461):
```js
  useEffect(() => {
    if (filters.dateRange === 'today' && currentDateStr !== lastLoadedDateRef.current) {
      lastLoadedDateRef.current = currentDateStr;
      loadData('today');
    }
  }, [currentDateStr, filters.dateRange, loadData]);
```
Change to:
```js
  useEffect(() => {
    if (filters.dateRange === 'today' && todayDateStr !== lastLoadedDateRef.current) {
      lastLoadedDateRef.current = todayDateStr;
      loadData('today');
    }
  }, [todayDateStr, filters.dateRange, loadData]);
```

- [ ] **Step 3: Confirm no other reference to `currentDateStr` remains**

Run: `grep -n "currentDateStr" src/pages/branch-staff-dashboard/index.jsx`
Expected: no output (all occurrences removed by Steps 1-2).

- [ ] **Step 4: Build and verify**

Run: `npm run build`
Expected: succeeds with no errors.

Run: `npm test -- --run`
Expected: 74 tests pass (no test covers this component; count unchanged).

Manual check: log in as `staff` on staging — confirm the Today revenue card and the bookings list both still show correct data (no regression from the rename).

- [ ] **Step 5: Commit**

```bash
git add src/pages/branch-staff-dashboard/index.jsx
git commit -m "refactor(staff-dashboard): dedupe redundant getTodayISO() call"
```

---

## Self-Review

- **Spec coverage:** The single finding (duplicate `getTodayISO()` call) is fully addressed by Task 1.
- **Placeholder scan:** No TBD/TODO; literal before/after code given.
- **Type consistency:** `todayDateStr` and the removed `currentDateStr` were both `string` (`YYYY-MM-DD`) from the same `getTodayISO()` function — identical type and value, safe to alias.
