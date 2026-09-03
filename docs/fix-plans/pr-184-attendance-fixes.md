# Fix Plan: PR #184 (`feature/attendance`) — Code Review Follow-ups

**Target repo/branch:** `Zunkireelabs/book-spa`, branch `feature/attendance`, PR #184
("fix(attendance): close staff-transfer concurrency race + validate visiting
windows server-side").

This plan was generated from an automated code review (`/code-review`, high effort)
run against `origin/feature/attendance`. It contains 2 required (blocking) tasks and
6 optional follow-ups. Both required tasks should land as **new commits on
`feature/attendance`** before this PR merges to `stage`.

This document is self-contained — you do not need any other conversation context to
execute it.

---

## Goal

Close two verified defects on `feature/attendance` before merge:

1. A data-consistency bug: the single-therapist Overview tab (`getTherapistOverview`)
   can report different utilization/performance numbers than the bulk Performance
   table (`getTherapistPerformance`) for the same therapist and period, because one
   call site silently drops an argument.
2. A commit-attribution policy violation: all 8 commits on this branch carry Claude
   Code's default `Co-Authored-By` trailer instead of this repo's required
   `@sthasadin` attribution (see `CLAUDE.md` → "Git Attribution").

## Architecture / Tech Stack

- React 18 + Vite SPA, Supabase backend (see repo root `CLAUDE.md` for full context).
- All mutations/queries for this feature live in `src/services/api.js` (monolithic
  service module — do not split it out as part of this fix).
- Tests: `vitest` (`npm test` → `vitest run`). Existing precedent for testing a pure
  helper out of `api.js`/sibling files is `src/services/therapistBranchWindow.js` +
  `src/services/therapistBranchWindow.test.js` (pure functions exported specifically
  so they're unit-testable without mocking Supabase).

## Spec

- `computeTherapistMetrics(bookings, attendanceRows, dayWindowMinutes, periodDays)`
  (`src/services/api.js:7104`) is a **shared pure function** used by both
  `getTherapistPerformance` (bulk table, `api.js:7183`) and `getTherapistOverview`
  (single-therapist drill-down, `api.js:7344`) specifically so the two views can
  never drift apart for the same therapist + period (see the comment block at
  `api.js:7088-7090` and `7341-7343` — that invariant is the whole point of the
  shared helper).
- Its 4th parameter, `periodDays`, is used **only** as a fallback: when a therapist
  has zero `therapist_attendance` rows for the period at all (`attendedDaysTotal ===
  0`), `workedMinutes` falls back to `periodDays * dayWindowMinutes` instead of 0 —
  see the comment at `api.js:7100-7103` ("branches that don't mark attendance
  rigorously would otherwise show 0% utilization for everyone").
- `getTherapistPerformance` calls it correctly:
  ```js
  // api.js:7285-7290
  const metrics = computeTherapistMetrics(
    bookingsByTherapist[t.id],
    attendanceByTherapist[t.id],
    dayWindowFor(t.branch_id),
    daysInPeriodInclusive(startDate, endDate)
  );
  ```
- `getTherapistOverview` calls it **without the 4th argument**:
  ```js
  // api.js:7391 (current, buggy)
  const metrics = computeTherapistMetrics(bookings, attendanceRows, dayWindowMinutes);
  ```
  `periodDays` is `undefined` there, so for any therapist with zero attendance rows
  in the period, `getTherapistOverview`'s utilization/performance numbers silently
  disagree with `getTherapistPerformance`'s numbers for the same therapist/period —
  defeating the exact invariant the shared-helper design was built to guarantee.
  `getTherapistOverview` already computes `startDate`/`endDate` in scope
  (`api.js:7354-7355`), and `daysInPeriodInclusive` is defined at module scope
  (`api.js:7096-7098`), so the fix is a one-line call-site change — no new data
  needed.

## Global Constraints

- `npm run build` must pass (repo-wide quality gate, per `CLAUDE.md`).
- `npm test` (vitest) must pass.
- Do not modify `computeTherapistMetrics`'s signature or behavior — only the
  `getTherapistOverview` call site.
- Follow this repo's commit-attribution rule for **every** commit you make while
  executing this plan (not just Task 2): trailer must be
  `Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>`, no Claude
  branding, no `Claude-Session:` trailer.
- Do not touch unrelated code. Tasks 3-8 below are explicitly out of scope for this
  pass — see "Follow-ups" section.

---

## Task 1 (required, blocking): fix `getTherapistOverview`'s dropped `periodDays` arg

### Files

- `src/services/api.js` — the fix (1 line changed) and, if it doesn't already exist,
  a minimal export of `computeTherapistMetrics` so it can be unit-tested directly
  (see step 2).
- `src/services/computeTherapistMetrics.test.js` — new test file (or add to an
  existing colocated test file if one already covers `computeTherapistMetrics` by
  the time you read this — check first, per step 1).

### Interfaces touched

- `computeTherapistMetrics(bookings, attendanceRows, dayWindowMinutes, periodDays)` —
  no signature change; only needs an `export` keyword added if it isn't already
  exported (check step 1).
- `getTherapistOverview({ branchId, therapistId, fromDate, toDate })` — no signature
  change, only its internal call to `computeTherapistMetrics` changes.

### Steps

1. **Check current state first** — things may have moved since this plan was
   written. Run:
   ```bash
   grep -n "computeTherapistMetrics" src/services/api.js
   ```
   Confirm `computeTherapistMetrics` is still defined around line 7104 with
   signature `(bookings, attendanceRows, dayWindowMinutes, periodDays)`, and that
   the `getTherapistOverview` call (around line 7391) still omits the 4th argument.
   If the code has already changed (e.g. someone already fixed this), stop and
   report that instead of re-applying the fix.

2. **Export `computeTherapistMetrics` for direct testing.** It is currently a
   module-private function (`function computeTherapistMetrics(...)`, not
   `export function`). Change the declaration at `api.js:7104` from:
   ```js
   function computeTherapistMetrics(bookings, attendanceRows, dayWindowMinutes, periodDays) {
   ```
   to:
   ```js
   export function computeTherapistMetrics(bookings, attendanceRows, dayWindowMinutes, periodDays) {
   ```
   This mirrors the existing pattern in `src/services/therapistBranchWindow.js`,
   where pure helper functions are exported specifically so they can be unit-tested
   without mocking Supabase.

3. **Write the regression test first (TDD — it must fail before the fix).** Create
   `src/services/computeTherapistMetrics.test.js`:
   ```js
   import { describe, it, expect } from 'vitest';
   import { computeTherapistMetrics } from './api';

   describe('computeTherapistMetrics', () => {
     it('applies the periodDays fallback when a therapist has zero attendance rows', () => {
       const bookings = [];
       const attendanceRows = [];
       const dayWindowMinutes = 480; // 8-hour branch window
       const periodDays = 7;

       const metrics = computeTherapistMetrics(bookings, attendanceRows, dayWindowMinutes, periodDays);

       // Zero attendance rows -> workedMinutes falls back to periodDays * dayWindowMinutes,
       // per the comment at api.js:7100-7103.
       expect(metrics.workedMinutes).toBe(periodDays * dayWindowMinutes);
     });

     it('getTherapistOverview and getTherapistPerformance must pass the same periodDays for the same period', () => {
       // Regression guard for the PR #184 review finding: getTherapistOverview
       // (api.js) must pass daysInPeriodInclusive(startDate, endDate) as the 4th
       // arg to computeTherapistMetrics, exactly like getTherapistPerformance does,
       // or the two views silently disagree for any therapist with zero attendance
       // rows in the period.
       const dayWindowMinutes = 480;
       const zeroAttendanceBookings = [];
       const zeroAttendanceRows = [];

       const withoutPeriodDays = computeTherapistMetrics(zeroAttendanceBookings, zeroAttendanceRows, dayWindowMinutes, undefined);
       const withPeriodDays = computeTherapistMetrics(zeroAttendanceBookings, zeroAttendanceRows, dayWindowMinutes, 7);

       expect(withoutPeriodDays.workedMinutes).not.toBe(withPeriodDays.workedMinutes);
     });
   });
   ```
   Run `npm test -- computeTherapistMetrics` and confirm both tests currently pass
   at this stage (they test the shared helper directly, not the buggy call site —
   they're expected to pass already; they exist to lock in the helper's contract
   before you touch the call site in step 4).

4. **Apply the one-line fix.** In `getTherapistOverview` (`api.js`, currently around
   line 7391), change:
   ```js
   const metrics = computeTherapistMetrics(bookings, attendanceRows, dayWindowMinutes);
   ```
   to:
   ```js
   const metrics = computeTherapistMetrics(bookings, attendanceRows, dayWindowMinutes, daysInPeriodInclusive(startDate, endDate));
   ```

5. **Verify.**
   ```bash
   npm test
   npm run build
   ```
   Both must pass with no errors.

6. **Manual smoke test (optional but recommended given this is a numbers-correctness
   bug):** in the running app, pick a therapist with zero `therapist_attendance`
   rows in some period, and confirm the Overview tab's utilization/performance
   numbers now match the same therapist's row in the bulk Performance table for that
   same period.

7. **Commit** with the required attribution trailer (see Global Constraints), e.g.:
   ```
   fix(attendance): pass periodDays to computeTherapistMetrics in getTherapistOverview

   getTherapistOverview dropped the 4th argument to the shared computeTherapistMetrics
   helper, so its numbers could silently disagree with getTherapistPerformance's for
   any therapist with zero therapist_attendance rows in the period.

   Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>
   ```

---

## Task 2 (required, blocking): re-attribute all 8 commits on `feature/attendance`

### Context

`CLAUDE.md`'s Git Attribution section requires:
- No "Generated with Claude Code" or Claude branding in commits/PRs.
- Commit co-author trailer: `Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>`.

All 8 non-merge commits currently on `feature/attendance` (ahead of `origin/stage`)
instead carry:
```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_...
```

Affected commits (verify this list is still current with `git log --oneline
origin/stage..feature/attendance` before starting — merge commits are excluded,
only rewrite non-merge commits):
```
0b3807d fix: regenerate package-lock.json with all rollup platform binaries
8edaf28 fix: regenerate package-lock.json corrupted by the stage merge
3705bc9 fix(attendance): close remaining permanent-transfer race gap
c36de7c fix(attendance): close transfer race + validate visiting windows server-side
75fa2e0 fix(performance,attendance): address formal code-review findings
1156862 fix(supabase): renumber this branch's migrations to 145-152 (stage collision)
868257a feat(attendance,payroll,performance): permanent transfers, split leave types, leave-pay caps, therapist performance drill-down
432f100 feat(attendance): required-duration staff transfers with auto-revert + calendar legibility fixes
```
(There are also merge commits, e.g. `e7c27a1 Merge branch 'stage' into
feature/attendance` — leave merge commits alone; only rewrite the trailer text
on non-merge commits.)

### ⚠️ Important — run this in your own local checkout, not a shared/CI environment

This rewrites `feature/attendance`'s history (new commit SHAs) and requires a
force-push to `origin/feature/attendance`. Do this in Yukta's own local clone, on
this exact branch, with a clean working tree. Do **not** run this against a shared
CI checkout or anyone else's clone.

### Steps

1. **Confirm a clean working tree and the right branch:**
   ```bash
   git status
   git branch --show-current   # must print: feature/attendance
   ```
   If there are uncommitted changes, stop — commit or stash them first.

2. **Rebase interactively against `stage`**, rewriting every commit's trailer:
   ```bash
   git fetch origin
   git rebase -i origin/stage
   ```
   In the editor, mark every commit `reword` (`r`) instead of `pick`. Git will then
   stop at each commit in turn.

3. **At each stop**, edit the commit message: delete the two lines
   ```
   Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_...
   ```
   and replace them with:
   ```
   Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>
   ```
   Leave the rest of each commit's message (subject + body) unchanged. Save and
   close the editor to continue to the next commit (`git rebase --continue` if your
   editor doesn't auto-continue).

4. **After the rebase completes**, verify no trace of the old attribution remains:
   ```bash
   git log origin/stage..HEAD --format="%H %s" | while read sha rest; do
     git log -1 --format="%B" "$sha" | grep -i "claude" && echo "  ^ still has Claude branding: $sha"
   done
   ```
   This should print nothing after the `while` loop (no matches). If anything
   prints, re-run `git rebase -i origin/stage` and fix the remaining commit(s).

5. **Confirm the code itself is unchanged** (this should only touch commit
   messages, not file contents):
   ```bash
   git diff origin/feature/attendance HEAD
   ```
   Expect **no output**. If there is a diff, something went wrong in the rebase —
   stop and investigate before force-pushing.

6. **Force-push the rewritten branch** (this is expected and required — you're
   rewriting your own open, not-yet-merged PR branch, which is standard practice
   before merge):
   ```bash
   git push --force-with-lease origin feature/attendance
   ```
   Use `--force-with-lease`, not plain `--force` — it aborts instead of overwriting
   if `origin/feature/attendance` moved unexpectedly since your last fetch (e.g.
   someone else pushed to it in the meantime).

7. **Verify on GitHub:** reload PR #184 and spot-check a couple of commits in the
   "Commits" tab to confirm they now show the `sthasadin` co-author, not Claude
   branding.

---

## Follow-ups (not blocking merge — your team's call)

These are design-debt / hardening observations from the same review, not bugs. None
of them need to land before this PR merges. Listed here so they aren't lost; treat
each as its own future ticket if you decide to act on it.

1. **`therapistBranchWindow.js`'s branch-window check is client-side only, with no
   DB-side backstop.** `assignTherapist`/`rescheduleBooking` validate the
   therapist's expected branch at booking time by reconstructing it in JS from
   transfer history — there's no equivalent constraint enforced in Postgres, so a
   direct DB write (or a future code path that bypasses these two functions) could
   still create a branch-mismatched assignment undetected.

2. **`migration-153`'s new unique index
   (`idx_staff_transfers_one_active_per_therapist`) is currently dead code.** No RLS
   `INSERT` policy on `staff_transfers` grants direct client writes (all writes go
   through the `transfer_therapist()` RPC), so the partial unique index only ever
   guards a code path that isn't reachable yet. Not wrong, just currently
   unexercised outside the RPC's own `BEGIN/EXCEPTION` handling — worth confirming
   that stays true if `staff_transfers` INSERT policies are ever loosened.

3. **Sequential (non-`Promise.all`) independent queries** in `assignTherapist`,
   `rescheduleBooking`, and `generatePayroll` — several independent Supabase reads
   in these functions currently `await` one after another instead of running
   concurrently via `Promise.all`, adding avoidable latency.

4. **Duplicated default-date-range block.** The same 3-line "default to last 30
   days if `fromDate`/`toDate` not given" snippet (see `getTherapistOverview`,
   `api.js:7353-7355`) is copy-pasted across roughly 5 functions in `api.js`.
   Candidate for a small shared helper.

5. **Two independent Kathmandu-timezone construction implementations**:
   `combineDateTimeKathmandu` (in `api.js`) and `toKathmanduDate` (in
   `therapistBranchWindow.js`) both construct a Nepal-local `Date`/offset from a
   date+time pair, independently. Worth consolidating to one shared implementation
   so a future timezone-handling bug fix doesn't need to be applied twice.

6. **New leave-cap constants have no `TEMPORARY` marker.** `CLAUDE.md` documents a
   precedent (`DISCOUNT_LIMITS.staff`) for flagging intentionally-temporary
   business-rule constants with an inline comment explaining what to revert and
   when. The new leave-pay-cap constants added on this branch (Sick Leave >14d/yr,
   Annual Leave >18d/yr unpaid) don't follow that convention — worth a comment if
   these caps are expected to change, or can be left alone if they're meant to be
   permanent.
