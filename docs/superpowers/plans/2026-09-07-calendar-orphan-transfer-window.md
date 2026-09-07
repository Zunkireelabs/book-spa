# Calendar Orphan-Column Transfer Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Calendar's "orphan therapist" fallback column (added in PR #206/207 so a booking's assigned therapist always gets a column, even after a permanent transfer) shade its real temporary-transfer window in white instead of graying out the entire day whenever that therapist actually has a known, temporary `staff_transfers` window touching this branch.

**Architecture:** Add a small pure function, `resolveOrphanTransferWindow(transfers, branchId)`, alongside the existing pure transfer-window logic in `src/services/therapistBranchWindow.js` (same module that already reconstructs "what branch was this therapist at, at time X" from raw `staff_transfers` rows — this is the natural home, not a new file). `getCalendarBookings()` in `src/services/api.js` fetches each orphan therapist's `staff_transfers` rows and calls this function to decide the column's `transferredOut`/`transferredIn`/`returnsAt`/`transferStartAt` fields instead of always hardcoding `returnsAt: null`. No change to `CalendarGrid.jsx` or `calendar/index.jsx` — `isTransferBlockedSlot()` already handles a populated `returnsAt` correctly; it only mishandles the `null` case, which this plan stops feeding it when a real window exists.

**Tech Stack:** React 18 + Vite, Supabase JS client, Vitest (`npm test` = `vitest run`, added by the `feature/attendance` PRs — not yet in this session's older working branches, so Task 1 confirms it's installed before writing tests).

**Spec:** No separate spec doc — this plan is self-contained; the bug and root cause are documented in full in the Context section below (this session's own investigation, verified by reading `origin/main`'s live source directly).

## Global Constraints

- `npm run build` must pass with zero errors after every task.
- `npm test` (vitest) must pass after Task 1.
- Do not modify `CalendarGrid.jsx` or `calendar/index.jsx`'s `isTransferBlockedSlot()` — it is already correct for the case where `returnsAt` is populated; only the orphan-column construction in `api.js` needs to change.
- Keep `src/services/therapistBranchWindow.js`'s existing convention: functions take **raw Supabase row shape** (snake_case: `from_branch_id`, `to_branch_id`, `is_permanent`, `revert_at`, `effective_date`, `start_time`, `transferred_at`) — do not introduce a camelCase remapping layer.
- New Supabase query added to `getCalendarBookings()` must only run when `orphanTherapistIds.length > 0` (same guard the existing orphan-therapist query already uses) — no added query cost on the common case (no orphans).
- Do not change the behavior for a genuinely **permanent** transfer or a therapist with **no** matching `staff_transfers` row at all — those must keep blocking the whole column (`returnsAt: null`), which is the intentional conservative default for a truly unknown/permanent case.
- Follow this repo's git workflow (`CLAUDE.md`): new work happens on a feature branch cut from `stage`, PR targets `stage`, never `main` directly.

---

## Task 1: `resolveOrphanTransferWindow()` in `therapistBranchWindow.js`

**Files:**
- Modify: `src/services/therapistBranchWindow.js` (add new exported function; reuses the existing private `normalizeTime()` helper already in this file)
- Test: `src/services/therapistBranchWindow.test.js` (add new `describe` block)

**Interfaces:**
- Produces: `resolveOrphanTransferWindow(transfers: Array, branchId: string) => { transferredOut: true, returnsAt: string, transferStartAt: string|null } | { transferredIn: true, returnsAt: string, transferStartAt: string|null } | null`
  - `null` means "no matching temporary window found" — the caller (Task 2) must keep its existing `returnsAt: null` block-everything default in that case.
  - Each `transfers[i]` is a raw `staff_transfers` row: `{ from_branch_id, to_branch_id, is_permanent, is_return_leg, revert_at, effective_date, start_time, transferred_at }`.

- [ ] **Step 1: Write the failing tests**

Add to the end of `src/services/therapistBranchWindow.test.js` (this file already does `import { computeTherapistBranchAt, toKathmanduDate } from './therapistBranchWindow';` at the top and defines `BRANCH_A`/`BRANCH_B` constants and a `temp({...})` helper for building transfer rows — reuse both, and add `resolveOrphanTransferWindow` to the existing import line):

```js
describe('resolveOrphanTransferWindow', () => {
  it('returns a transferredIn window when branchId is the destination', () => {
    const transfers = [
      temp({ from: BRANCH_A, to: BRANCH_B, effective_date: '2026-09-06', start_time: '16:30:00', revert_at: '2026-09-06T18:30:00+05:45' }),
    ];
    expect(resolveOrphanTransferWindow(transfers, BRANCH_B)).toEqual({
      transferredIn: true,
      returnsAt: '2026-09-06T18:30:00+05:45',
      transferStartAt: '2026-09-06T16:30:00+05:45',
    });
  });

  it('returns a transferredOut window when branchId is the origin', () => {
    const transfers = [
      temp({ from: BRANCH_A, to: BRANCH_B, effective_date: '2026-09-06', start_time: '16:30:00', revert_at: '2026-09-06T18:30:00+05:45' }),
    ];
    expect(resolveOrphanTransferWindow(transfers, BRANCH_A)).toEqual({
      transferredOut: true,
      returnsAt: '2026-09-06T18:30:00+05:45',
      transferStartAt: '2026-09-06T16:30:00+05:45',
    });
  });

  it('returns null for a permanent transfer touching branchId (caller keeps its conservative block-everything default)', () => {
    const transfers = [
      { from_branch_id: BRANCH_A, to_branch_id: BRANCH_B, is_permanent: true, is_return_leg: false, revert_at: null, effective_date: '2026-09-06', start_time: '16:30:00', transferred_at: '2026-09-06T16:30:00+05:45' },
    ];
    expect(resolveOrphanTransferWindow(transfers, BRANCH_B)).toBeNull();
  });

  it('returns null when no transfer touches branchId at all', () => {
    const transfers = [
      temp({ from: BRANCH_A, to: BRANCH_B, effective_date: '2026-09-06', start_time: '16:30:00', revert_at: '2026-09-06T18:30:00+05:45' }),
    ];
    expect(resolveOrphanTransferWindow(transfers, 'some-other-branch-id')).toBeNull();
  });

  it('ignores synthesized return-leg rows and picks the real outbound transfer', () => {
    const transfers = [
      temp({ from: BRANCH_A, to: BRANCH_B, effective_date: '2026-09-06', start_time: '16:30:00', revert_at: '2026-09-06T18:30:00+05:45' }),
      { from_branch_id: BRANCH_B, to_branch_id: BRANCH_A, is_permanent: false, is_return_leg: true, revert_at: null, effective_date: '2026-09-06', start_time: '18:30:00', transferred_at: '2026-09-06T18:30:00+05:45' },
    ];
    expect(resolveOrphanTransferWindow(transfers, BRANCH_B)).toEqual({
      transferredIn: true,
      returnsAt: '2026-09-06T18:30:00+05:45',
      transferStartAt: '2026-09-06T16:30:00+05:45',
    });
  });

  it('picks the most recently transferred_at row when more than one matches', () => {
    const transfers = [
      { from_branch_id: BRANCH_A, to_branch_id: BRANCH_B, is_permanent: false, is_return_leg: false, revert_at: '2026-09-06T17:00:00+05:45', effective_date: '2026-09-06', start_time: '15:00:00', transferred_at: '2026-09-06T14:00:00+05:45' },
      { from_branch_id: BRANCH_A, to_branch_id: BRANCH_B, is_permanent: false, is_return_leg: false, revert_at: '2026-09-06T18:30:00+05:45', effective_date: '2026-09-06', start_time: '16:30:00', transferred_at: '2026-09-06T16:10:00+05:45' },
    ];
    expect(resolveOrphanTransferWindow(transfers, BRANCH_B)).toEqual({
      transferredIn: true,
      returnsAt: '2026-09-06T18:30:00+05:45',
      transferStartAt: '2026-09-06T16:30:00+05:45',
    });
  });
});
```

Also update this test file's existing import line from:
```js
import { computeTherapistBranchAt, toKathmanduDate } from './therapistBranchWindow';
```
to:
```js
import { computeTherapistBranchAt, toKathmanduDate, resolveOrphanTransferWindow } from './therapistBranchWindow';
```

- [ ] **Step 2: Install test deps if missing, then run the tests to verify they fail**

The `feature/attendance` work added `vitest` to `package.json` and `"test": "vitest run"` — if you're on an older branch checked out before that merged, run `npm install` first. Then:

Run: `npm test -- src/services/therapistBranchWindow.test.js`
Expected: FAIL — `resolveOrphanTransferWindow is not a function` (or a Vite/Node import error), since it doesn't exist yet.

- [ ] **Step 3: Implement `resolveOrphanTransferWindow`**

Add to `src/services/therapistBranchWindow.js`, after `computeTherapistBranchAt` (reuses the file's existing private `normalizeTime()` helper defined near the top):

```js
/**
 * Given a therapist's staff_transfers rows (raw DB shape, any applied/reverted status),
 * finds the one relevant to `branchId` and describes it the way the Calendar's orphan-column
 * fallback (getCalendarBookings, api.js) needs: which direction relative to branchId, and the
 * real [start, end] window — instead of the caller's default "unknown window, block the whole
 * column all day."
 *
 * Only considers non-permanent, non-return-leg rows with a real revert_at (the same "genuinely
 * a temporary window" signal already used by the transferredOut/transferredIn queries in
 * getCalendarBookings) that touch branchId on either side. When more than one matches, picks
 * the most recently created (transferred_at) — the transfer that caused the orphan booking in
 * the first place is the common case.
 *
 * @param {Array} transfers - raw staff_transfers rows for one therapist: each with
 *   from_branch_id, to_branch_id, is_permanent, is_return_leg, revert_at, effective_date,
 *   start_time, transferred_at.
 * @param {string} branchId - the branch whose calendar is being rendered.
 * @returns {{transferredOut: true, returnsAt: string, transferStartAt: string|null}
 *   | {transferredIn: true, returnsAt: string, transferStartAt: string|null}
 *   | null} null when no matching temporary window exists — caller keeps its
 *   block-everything default, which is correct for a truly permanent/unknown case.
 */
export function resolveOrphanTransferWindow(transfers, branchId) {
  const relevant = (transfers || [])
    .filter((t) => t && !t.is_permanent && !t.is_return_leg && t.revert_at
      && (t.from_branch_id === branchId || t.to_branch_id === branchId))
    .sort((a, b) => new Date(b.transferred_at) - new Date(a.transferred_at));

  const t = relevant[0];
  if (!t) return null;

  const transferStartAt = t.effective_date && t.start_time
    ? `${t.effective_date}T${normalizeTime(t.start_time)}+05:45`
    : null;

  if (t.to_branch_id === branchId) {
    return { transferredIn: true, returnsAt: t.revert_at, transferStartAt };
  }
  return { transferredOut: true, returnsAt: t.revert_at, transferStartAt };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/services/therapistBranchWindow.test.js`
Expected: PASS — all existing tests in this file plus the 6 new ones green.

- [ ] **Step 5: Commit**

```bash
git add src/services/therapistBranchWindow.js src/services/therapistBranchWindow.test.js
git commit -m "feat(calendar): add resolveOrphanTransferWindow for orphan-column shading"
```

---

## Task 2: Wire it into `getCalendarBookings()`

**Files:**
- Modify: `src/services/api.js` — the orphan-therapist block inside `getCalendarBookings()` (currently the `if (orphanTherapistIds.length > 0) { ... }` block right after the bookings fetch; grep `orphanTherapistIds` to find it — it's the same block Task-1-adjacent work in this session's PR #206/207 added)

**Interfaces:**
- Consumes: `resolveOrphanTransferWindow(transfers, branchId)` from Task 1 (`src/services/therapistBranchWindow.js`)
- Produces: no new exports — `getCalendarBookings()`'s return shape is unchanged (still `{ data: { therapists, rooms, bookings, ... }, error }`), only the *content* of orphan entries in `therapists` changes.

This integration talks to a live Supabase client, so it isn't unit-testable the way Task 1 is (no other function in `api.js` has direct unit tests either — this matches the existing codebase pattern). Verify via `npm run build` + a manual Calendar check instead (Step 4).

- [ ] **Step 1: Update the import line**

At the top of `src/services/api.js`, change:
```js
import { computeTherapistBranchAt, toKathmanduDate, isAfterCheckout } from './therapistBranchWindow';
```
to:
```js
import { computeTherapistBranchAt, toKathmanduDate, isAfterCheckout, resolveOrphanTransferWindow } from './therapistBranchWindow';
```

- [ ] **Step 2: Replace the orphan-therapist block**

Find this exact block inside `getCalendarBookings()` (right after the bookings fetch and its `orphanTherapistIds` computation, which stays unchanged):

```js
    let finalTherapists = mergedTherapists;
    if (orphanTherapistIds.length > 0) {
      const { data: orphanTherapists, error: orphanError } = await supabase
        .from('therapists')
        .select('id, name, gender, specialties, position, is_service_staff, display_order')
        .in('id', orphanTherapistIds);
      if (orphanError) throw orphanError;

      finalTherapists = [
        ...mergedTherapists,
        ...(orphanTherapists || []).map(t => ({
          ...t,
          transferredOut: true,
          returnsAt: null,
          transferStartAt: null,
        })),
      ].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.name.localeCompare(b.name));
    }
```

Replace it with:

```js
    let finalTherapists = mergedTherapists;
    if (orphanTherapistIds.length > 0) {
      // Also fetch each orphan therapist's real staff_transfers history so a booking left
      // behind by a TEMPORARY transfer (already ended, or permanent-looking only because the
      // normal/temp-transfer queries above don't cover it) can shade its real window instead
      // of blocking the whole column all day — see resolveOrphanTransferWindow.
      const [orphanTherapistsResult, orphanTransfersResult] = await Promise.all([
        supabase
          .from('therapists')
          .select('id, name, gender, specialties, position, is_service_staff, display_order')
          .in('id', orphanTherapistIds),
        supabase
          .from('staff_transfers')
          .select('therapist_id, from_branch_id, to_branch_id, is_permanent, is_return_leg, revert_at, effective_date, start_time, transferred_at')
          .in('therapist_id', orphanTherapistIds),
      ]);
      if (orphanTherapistsResult.error) throw orphanTherapistsResult.error;
      if (orphanTransfersResult.error) throw orphanTransfersResult.error;

      const orphanTransfersByTherapist = {};
      (orphanTransfersResult.data || []).forEach(t => {
        (orphanTransfersByTherapist[t.therapist_id] ??= []).push(t);
      });

      finalTherapists = [
        ...mergedTherapists,
        ...(orphanTherapistsResult.data || []).map(t => {
          const window = resolveOrphanTransferWindow(orphanTransfersByTherapist[t.id], resolvedBranchId);
          return {
            ...t,
            transferredOut: window ? !!window.transferredOut : true,
            transferredIn: window ? !!window.transferredIn : false,
            returnsAt: window ? window.returnsAt : null,
            transferStartAt: window ? window.transferStartAt : null,
          };
        }),
      ].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.name.localeCompare(b.name));
    }
```

Note the explicit `transferredIn: window ? !!window.transferredIn : false` — without it, a `transferredIn` window's entry would keep the default `transferredOut: true` AND gain `transferredIn: true` simultaneously (both spread onto the same object), which is contradictory and would confuse `isTransferBlockedSlot()`'s `if (therapist.transferredOut) return phase === 'during'; ...` branch. Building the object from scratch off `window ? ... : ...` (rather than spreading `...window` over a `transferredOut: true` default) avoids that.

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: succeeds with zero errors (same warning about chunk size as before is fine, that's pre-existing and unrelated).

- [ ] **Step 4: Manual verification against the real Aksa Rasaili Sunar case**

This is the exact real-world case that surfaced the bug this session — use it as the manual regression check:
1. Start the dev server (`npm start`), log in as admin, switch to the **Sanepa** branch, open Calendar, navigate to **6 September 2026**.
2. Confirm the "Aksa Rasaili..." column now shows **white** (bookable) background from **4:30pm–6:30pm** and **grey** (blocked) outside that window — not grey for the entire visible range like before.
3. Confirm the existing Sonam Darling booking card (5:25pm–6:25pm) still renders correctly inside that white window.
4. Switch to **Thamel** branch, same date — Aksa should not incorrectly show as blocked there either (she's back home per the corrected `staff_transfers` return-leg row from this session's earlier data fix).

- [ ] **Step 5: Commit**

```bash
git add src/services/api.js
git commit -m "fix(calendar): shade orphan-column transfer window from real staff_transfers data"
```

---

## Self-Review Notes

- **Spec coverage**: both halves of the bug (pure window-resolution logic, and its wiring into the live query) have a task each. The `CalendarGrid.jsx`/`calendar/index.jsx` blocking logic itself is intentionally untouched per Global Constraints — it was already correct.
- **Placeholder scan**: no TBD/TODO — every step has real, complete code.
- **Type consistency**: `resolveOrphanTransferWindow`'s return shape (`transferredOut`/`transferredIn`/`returnsAt`/`transferStartAt`) matches exactly what `mergedTherapists` entries already carry elsewhere in `getCalendarBookings()` (see `transferredOutTherapists`/`transferredInById` construction just above), and what `CalendarGrid.jsx`/`calendar/index.jsx` already read (`col.transferredOut`, `col.transferredIn`, `col.returnsAt`, `col.transferStartAt`) — no new field names introduced.
