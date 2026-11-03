# Group Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer book services for themselves + up to 5 guests (6 people total) in one checkout, one shared time slot, each person possibly with a different therapist, all created as one linked group (`booking_group_id`).

**Architecture:** New parallel `GroupBookingView` step-machine component alongside the existing solo `BookingView` (same plain-`useState`/prop-drilling pattern as `provider-profile-flow/index.jsx`), triggered from a new entry-choice screen gated by `VITE_ENABLE_GROUP_BOOKING`. Reuses existing per-person pieces (`ServicesSection`, `ProfessionalStep`, `CustomerForm`) per guest. New pure logic: `groupAvailability.js` composes the existing `buildOccupancy`/`buildTherapistOccupancy`/`isTherapistFree`/`anyProfessionalFree` primitives (already used by the solo `DateTimeSelection.jsx`) to find slots where all N people's picks are simultaneously satisfiable, by greedily simulating each person's reservation in turn against one shared branch-wide fetch. Submission is a sequential `createBooking` loop (copying the proven pattern from `branch-manager-dashboard/components/calendar/index.jsx` `handleQuickCreateSubmit`'s group branch) with added compensating rollback via the existing `public_cancel_booking_group` RPC, since this path is anonymous/customer-facing (unlike that staff-only original).

**Tech Stack:** React 18, Vite, Tailwind, Supabase (anon RLS), vitest.

**Spec:** spec given verbatim by peer session "Fix admin viewer membership voucher package access" in this conversation (2026-10-28) — no separate file; this plan is the durable record of it.

## Global Constraints

- Gate the entire feature behind `VITE_ENABLE_GROUP_BOOKING`, added to `.env.staging` only (follow `src/lib/featureFlags.js` pattern — add `GROUP_BOOKING_ENABLED` export there, `=== 'true'` check). Do not touch Dockerfile or workflow build-args.
- Max 6 people total (1 lead + 5 guests).
- One service per guest in v1 (lead keeps today's existing multi-service ability unchanged — out of scope to touch).
- No group discount concept; no combined-payment UI. Each row goes through `createBooking`'s existing per-row validation untouched.
- Guests get only a name field (default `Guest 2`, `Guest 3`, ... if left blank); no phone/email collected for guests. Guest rows inherit the lead's `customerPhone`/`customerEmail` — do not relax `createBooking`'s phone-required check (api.js:5306-5308).
- Do not modify the `online_booking_capacity` trigger/column or `counts_as_online_capacity` logic (migrations 138/155/159/301). Each guest's row counts individually against it, same as any solo booking — accepted tradeoff, not a bug.
- `createBooking`, `createBookingGroup`, `public_cancel_booking_group` (api.js:5278, 5864, RPC in migration-252) are not to be modified — compose around them, don't change their signatures or validation.
- Must build clean (`npm run build`) and pass `npm test` (vitest).
- Dropdowns (the per-service professional picker) must use `CustomSelect`, never native `<select>`, per CLAUDE.md.
- Use `booking.bookingId` (never `.id`) anywhere a created row is referenced after insert.

## Review Focus

- **Two "any professional" guests must not silently resolve to the same therapist at the same slot.** `anyProfessionalFree` (existing, solo-only) only proves "at least one" eligible therapist is free — naively calling it once per guest would let two "any" guests both pass against the same single available therapist, then fail at submit with a real-world double-booking race. Task 2's simulation must consume therapists as it assigns them across guests within one candidate slot.
- **A guest whose own service has zero eligible/active therapists at the branch** (e.g. a service nobody on the roster performs) must produce "no slots available" for the whole group, not a crash or an infinitely-available slot grid. `groupAvailability.js` must treat an empty eligible-therapist set per guest as "never free," matching `anyProfessionalFree`'s existing empty-list behavior, not skip the check.
- **Removing a guest mid-flow must clear that guest's professional/time selections that depended on them**, not leave stale `people[]` entries with another guest's service dangling off an old index — removal must re-key by guest id, not array position, or Guest 3 silently inherits Guest 2's stored selection after Guest 2 is removed.
- **Partial-failure rollback must not swallow the original error.** When `createBooking` fails for person 3 of 4, the customer must see person 3's actual error (e.g. "that slot just filled up"), not a generic rollback-success message — mirror `createBookingGroup`'s existing pattern (api.js:5928-5934) exactly rather than inventing new wording.
- **A lead who picks services for themself but adds zero guests** (opens "Book group appointment," then never clicks "Add guest") must not submit as a phantom 1-person "group" with a wasted `booking_group_id` — Task 6 must either disable submit until ≥1 guest exists, or fall back to the plain solo `createBooking` call with no `bookingGroupId` when `people.length === 1`, matching `createBookingGroup`'s own existing single-service bypass (api.js:5870-5878) in spirit.

---

## File Structure

New files:
- `src/pages/provider-profile-flow/utils/groupBooking.js` — pure person-list helpers (add/remove/update guest, id-keyed not index-keyed, `MAX_GROUP_SIZE = 6`).
- `src/pages/provider-profile-flow/utils/groupBooking.test.js`
- `src/pages/provider-profile-flow/utils/groupAvailability.js` — pure N-way slot-intersection logic.
- `src/pages/provider-profile-flow/utils/groupAvailability.test.js`
- `src/pages/provider-profile-flow/components/BookingView/GroupEntryChoice.jsx` — "Select an option" solo-vs-group screen.
- `src/pages/provider-profile-flow/components/GroupBookingView/index.jsx` — the group step machine (guests → professional → time → confirm), mirroring `BookingView/index.jsx`'s structure.
- `src/pages/provider-profile-flow/components/GroupBookingView/GuestsStep.jsx` — "Add guests and services" screen.
- `src/pages/provider-profile-flow/components/GroupBookingView/GroupProfessionalStep.jsx` — "any for all" vs "per guest" tiers, reusing `ProfessionalStep` per guest/service row.
- `src/pages/provider-profile-flow/components/GroupBookingView/GroupTimeStep.jsx` — shared slot grid, consuming `groupAvailability.js`.
- `src/pages/provider-profile-flow/components/GroupBookingView/GroupConfirmStep.jsx` — lead contact once + guest name list + per-person price breakdown + submit.

Modified files:
- `src/lib/featureFlags.js` — add `GROUP_BOOKING_ENABLED`.
- `.env.staging` — add `VITE_ENABLE_GROUP_BOOKING=true`.
- `src/pages/provider-profile-flow/index.jsx` — add `groupPeople` state, `groupModeOpen` state, render `GroupEntryChoice`/`GroupBookingView` alongside existing `bookingOpen`/`BookingView` branch.
- `src/services/api.js` — add `submitGroupBooking({ branchId, orgSlug, date, startTime, leadContact, people })` (new function, does NOT modify `createBooking`/`createBookingGroup`): sequential loop + rollback, colocated near `createBookingGroup` since it's the closest existing analog.
- `src/services/api.test.js` (create if it doesn't exist, else extend) — tests for `submitGroupBooking`'s orchestration logic (mock `createBooking`, assert loop order, rollback call, error passthrough).

## Review of open unknowns before Task 1

Two facts assumed by the spec turned out to need correction during research — recorded here so the implementer doesn't re-derive them:
- `therapistAvailability.js` (per-therapist slot-free logic) **does already exist** at `src/pages/provider-profile-flow/utils/therapistAvailability.js`, exactly where the spec guessed.
- `availability.js`'s `buildOccupancy` (room/gender/branch-capacity buckets) is **already wired into the live flow** — not legacy/unrouted as an earlier pass of research here suggested. The live path is `provider-profile-flow/components/BookingView/DateTimeStep.jsx` → reused `customer-booking-flow/components/DateTimeSelection.jsx`, which imports both `buildOccupancy` and `buildTherapistOccupancy`/`isTherapistFree`/`anyProfessionalFree` together (see `DateTimeSelection.jsx:1-16, 144-238` for the exact composition this plan's Task 2 mirrors) and fetches via `fetchBranchAvailabilityWindow(branchId, from, to)` and `fetchTherapistAvailabilityWindow(orgSlug, branchId, from, to)` (both already in `services/api.js`). Group booking's time step reuses these same two fetches **once each** for the whole group (they already return branch-wide/all-therapist rows, not filtered per selection) — no new fetch per guest needed.

---

### Task 1: Guest list state helpers

**Files:**
- Create: `src/pages/provider-profile-flow/utils/groupBooking.js`
- Test: `src/pages/provider-profile-flow/utils/groupBooking.test.js`

**Interfaces:**
- Produces:
  - `createLeadPerson()` → `{ id: 'lead', label: 'Me', isLead: true, service: null, professional: null }`
  - `createGuestPerson(n)` → `{ id: <uuid-like string, e.g. 'guest-' + n>, label: 'Guest ' + n, isLead: false, service: null, professional: null, name: '' }`
  - `addGuest(people)` → new array with one more guest appended (label numbered by current guest count + 1, e.g. second guest ever added, after one removed, is still "Guest 2" if only 1 guest currently present — numbering reflects current position, not history). Throws/returns unchanged array if `people.length >= MAX_GROUP_SIZE` (6).
  - `removeGuest(people, guestId)` → new array with the matching `id` removed (lead, `id === 'lead'`, can never be removed — removing it is a no-op returning the same array), remaining guests relabeled "Guest 2", "Guest 3"... in their new order.
  - `updateGuestField(people, guestId, field, value)` → new array, person matching `guestId` shallow-merged with `{ [field]: value }`; others untouched by reference (for cheap memo comparisons downstream).
  - `MAX_GROUP_SIZE` = `6` (exported constant).

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from 'vitest';
import { createLeadPerson, createGuestPerson, addGuest, removeGuest, updateGuestField, MAX_GROUP_SIZE } from './groupBooking';

describe('groupBooking person-list helpers', () => {
  it('addGuest appends a guest labeled by current position, capped at MAX_GROUP_SIZE total people', () => {
    let people = [createLeadPerson()];
    people = addGuest(people);
    expect(people).toHaveLength(2);
    expect(people[1].label).toBe('Guest 2');
    for (let i = 0; i < 10; i++) people = addGuest(people);
    expect(people).toHaveLength(MAX_GROUP_SIZE);
  });

  it('removeGuest relabels remaining guests by new position, and is a no-op on the lead', () => {
    let people = [createLeadPerson(), createGuestPerson(2), createGuestPerson(3)];
    people = removeGuest(people, people[1].id); // remove "Guest 2"
    expect(people.map((p) => p.label)).toEqual(['Me', 'Guest 2']);
    const unchanged = removeGuest(people, 'lead');
    expect(unchanged).toHaveLength(2);
  });

  it('updateGuestField merges only the targeted person, leaving sibling objects referentially equal', () => {
    const people = [createLeadPerson(), createGuestPerson(2)];
    const next = updateGuestField(people, people[1].id, 'name', 'Priya');
    expect(next[1].name).toBe('Priya');
    expect(next[0]).toBe(people[0]); // untouched person, same reference
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/provider-profile-flow/utils/groupBooking.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `groupBooking.js`**

Plain array-copying functions as described in Interfaces above. No React, no I/O.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/provider-profile-flow/utils/groupBooking.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/provider-profile-flow/utils/groupBooking.js src/pages/provider-profile-flow/utils/groupBooking.test.js
git commit -m "feat(group-booking): add guest-list state helpers"
```

---

### Task 2: N-way shared-slot availability

**Files:**
- Create: `src/pages/provider-profile-flow/utils/groupAvailability.js`
- Test: `src/pages/provider-profile-flow/utils/groupAvailability.test.js`

**Interfaces:**
- Consumes (all pre-existing, unmodified):
  - `buildOccupancy(bookings)` → `{ byRoom, byGender, byBranch }` (`customer-booking-flow/utils/availability.js`)
  - `buildTherapistOccupancy(rows)` → `{ byTherapist, unassigned }` (`provider-profile-flow/utils/therapistAvailability.js`)
  - `isTherapistFree(occupancy, therapistId, date, startMin, durationMinutes)` → boolean
  - `anyProfessionalFree(occupancy, eligibleTherapistIds, date, startMin, durationMinutes)` → boolean
  - `getRoomCapacity(room)` (`services/api.js`)
  - `START_HOUR`, `END_HOUR`, `getNepalToday`, `getNepalNow`, `minutesToTime24`, `minutesToTime12`, `isDateInRanges` (`customer-booking-flow/utils/availability.js`)
- Produces:
  - `computeGroupSlots({ dates, availabilityWindow, therapistWindow, closedRanges, enableRooms, onlineCapacity, people, allTherapists })` → `Array<{ date: string, slots: Array<{ time24, time12, isPast, isAvailable }> }>`, same shape as `DateTimeSelection.jsx`'s `computedDays` so `GroupTimeStep.jsx` can reuse that component's existing slot-grid rendering JSX pattern.
    - `people`: `Array<{ id, service: { id, duration_minutes }, professional: { mode: 'any' } | { mode: 'specific', therapist: { id } } | null }>` — lead + guests, each already resolved to one service and one professional choice (callers filter out any person missing either before calling this; a person missing a service/professional is simply never passed in).
    - `allTherapists`: `Array<{ id }>` — full active roster for the branch, used to resolve each `'any'` person's eligible pool (v1: every active therapist is eligible for "any", no per-service skill filtering — matches today's solo `ProfessionalStep`'s "any professional" semantics, which has no skill filter either).
  - Per spec's capacity rule: a person's row only counts against `onlineCapacity` when their resolved therapist is unassigned — i.e. always for `'any'` people (server inserts `therapist_id: null` for them) and never for `'specific'` people, mirroring `check_branch_online_capacity()`'s `therapist_id IS NULL` condition and `DateTimeSelection.jsx`'s existing `onlineCapacity = therapistFilter?.therapistId ? null : ...` branch.

- [ ] **Step 1: Write failing tests**

Follow `customer-booking-flow/utils/availability.test.js`'s conventions exactly: `describe`/`it` from vitest, a local `row(overrides)` factory for synthetic booking rows, one `describe` block per concern.

```js
import { describe, it, expect } from 'vitest';
import { computeGroupSlots } from './groupAvailability';

const baseArgs = (overrides = {}) => ({
  dates: [{ dayName: 'Mon', dayNumber: 2, monthName: 'Nov', fullDate: '2026-11-02', isToday: false, isWeekend: false }],
  availabilityWindow: { rooms: [], bookings: [] },
  therapistWindow: { bookings: [] },
  closedRanges: [],
  enableRooms: false,
  onlineCapacity: null,
  people: [],
  allTherapists: [{ id: 't1' }, { id: 't2' }],
  ...overrides,
});

describe('computeGroupSlots — two "any professional" guests never collapse onto one therapist', () => {
  it('marks a slot unavailable when only one therapist is free but two guests both want "any professional"', () => {
    const result = computeGroupSlots(baseArgs({
      people: [
        { id: 'lead', service: { id: 's1', duration_minutes: 60 }, professional: { mode: 'any' } },
        { id: 'guest-2', service: { id: 's1', duration_minutes: 60 }, professional: { mode: 'any' } },
      ],
      allTherapists: [{ id: 't1' }], // only one therapist exists at all
    }));
    const day = result.find((d) => d.date === '2026-11-02');
    const slot10am = day.slots.find((s) => s.time24 === '10:00');
    expect(slot10am.isAvailable).toBe(false);
  });

  it('marks the same slot available once a second therapist exists for the second guest', () => {
    const result = computeGroupSlots(baseArgs({
      people: [
        { id: 'lead', service: { id: 's1', duration_minutes: 60 }, professional: { mode: 'any' } },
        { id: 'guest-2', service: { id: 's1', duration_minutes: 60 }, professional: { mode: 'any' } },
      ],
    }));
    const day = result.find((d) => d.date === '2026-11-02');
    const slot10am = day.slots.find((s) => s.time24 === '10:00');
    expect(slot10am.isAvailable).toBe(true);
  });
});

describe('computeGroupSlots — a guest with zero eligible therapists blocks the whole group', () => {
  it('never offers a slot when one guest has no eligible therapist at all', () => {
    const result = computeGroupSlots(baseArgs({
      people: [{ id: 'lead', service: { id: 's1', duration_minutes: 60 }, professional: { mode: 'any' } }],
      allTherapists: [],
    }));
    const day = result.find((d) => d.date === '2026-11-02');
    expect(day.slots.every((s) => !s.isAvailable)).toBe(true);
  });
});

describe('computeGroupSlots — online capacity counts only "any professional" people', () => {
  it('does not shrink capacity for a person with a specific-therapist pick', () => {
    const result = computeGroupSlots(baseArgs({
      onlineCapacity: 1,
      people: [{ id: 'lead', service: { id: 's1', duration_minutes: 60 }, professional: { mode: 'specific', therapist: { id: 't1' } } }],
    }));
    const day = result.find((d) => d.date === '2026-11-02');
    expect(day.slots.find((s) => s.time24 === '10:00').isAvailable).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/provider-profile-flow/utils/groupAvailability.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `computeGroupSlots`**

For each date, for each 30-min `start` in `[START_HOUR*60, END_HOUR*60)` (stepping by 30, same grid as `DateTimeSelection.jsx`): for each person in order, attempt to reserve them against a **working copy** of the occupancy state seeded from `buildOccupancy`/`buildTherapistOccupancy`'s real data for this candidate slot only (don't mutate the shared maps across different candidate slots/dates):
  - `'specific'` person: `isTherapistFree(...)` against (real occupancy + therapists already claimed by earlier people *in this same candidate slot*). If free, claim that therapist for this slot (add to a per-slot "claimed" set) and continue; else the whole slot fails.
  - `'any'` person: iterate `allTherapists`, picking the first not yet claimed in this slot for which `isTherapistFree` is true against the real occupancy; if found, claim it and continue; else the whole slot fails.
  - Room capacity (`enableRooms`): same per-person incremental claim against `byRoom`, using `getRoomCapacity`.
  - `onlineCapacity`: increment a per-slot counter only for `'any'` people as they're claimed; if it would reach `onlineCapacity`, that person (and the slot) fails.
A slot is `isAvailable` only if every person was successfully claimed. `isPast`/`isClosed` short-circuit the same way `DateTimeSelection.jsx`'s `computedDays` does, reusing `getNepalToday`/`getNepalNow`/`isDateInRanges`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/provider-profile-flow/utils/groupAvailability.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/provider-profile-flow/utils/groupAvailability.js src/pages/provider-profile-flow/utils/groupAvailability.test.js
git commit -m "feat(group-booking): add N-way shared-slot availability intersection"
```

---

### Task 3: Submit orchestration with rollback

**Files:**
- Modify: `src/services/api.js` (add new exported function near `createBookingGroup`, ~line 5940)
- Test: `src/services/api.test.js` (create if absent)

**Interfaces:**
- Consumes: `createBooking(...)` (unmodified, api.js:5278), `supabase.rpc('public_cancel_booking_group', { p_booking_group_id })` (existing RPC, migration-252).
- Produces: `submitGroupBooking({ branchId, orgSlug, date, startTime, genderPreference, specialRequests, leadContact: { name, email, phone, gender }, people })` → `Promise<{ data: { bookings: Array<CreateBookingResult> } | null, error: { code?, message } | null }>`.
  - `people`: `Array<{ isLead: boolean, name?: string, service: { id }, therapistId: string|null }>` (the UI layer has already resolved each person's `'any'`/`'specific'` choice down to a single `therapistId` or `null` before calling this — this function does no resolution, only orchestration).
  - If `people.length === 1`: call `createBooking` once with no `bookingGroupId` (mirrors `createBookingGroup`'s existing single-service bypass, api.js:5870-5878) — no group row, no rollback machinery needed.
  - Else: generate one `bookingGroupId` via `crypto.randomUUID()`. Loop **sequentially** (plain `for`, not `Promise.all` — same reasoning as the staff-side pattern: each iteration's room-capacity trigger must see prior siblings already inserted) calling `createBooking` per person with:
    - lead: `customerName: leadContact.name, customerEmail: leadContact.email, customerPhone: leadContact.phone, customerGender: leadContact.gender`
    - guest: `customerName: person.name || <their label from the UI, e.g. "Guest 2">, customerEmail: leadContact.email, customerPhone: leadContact.phone, customerGender: null`
    - both: `serviceId: person.service.id, therapistId: person.therapistId, bookingGroupId, branchId, date, startTime, orgSlug, genderPreference, specialRequests` (special requests/gender preference shared from the lead's form, applied identically to every row — v1 has no per-guest version of either).
  - On any `error` mid-loop: call the rollback RPC exactly as `createBookingGroup` does (api.js:5910-5934) — same two-branch result shape (`BOOKING_GROUP_PARTIAL` if rollback itself fails; otherwise the original person's error, noting other rows were released) so the UI's error-rendering code can treat `submitGroupBooking` and `createBookingGroup` failures identically.
  - On success: `{ data: { bookings: [...each createBooking result's data] }, error: null }`.

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from './api';

describe('submitGroupBooking', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('creates one row per person sequentially, sharing one bookingGroupId', async () => {
    const calls = [];
    vi.spyOn(api, 'createBooking').mockImplementation(async (args) => {
      calls.push(args);
      return { data: { bookingId: `booking-${calls.length}` }, error: null };
    });
    const result = await api.submitGroupBooking({
      branchId: 'b1', orgSlug: 'nuad', date: '2026-11-02', startTime: '10:00',
      leadContact: { name: 'Anish', email: 'a@x.com', phone: '9800000000', gender: 'male' },
      people: [
        { isLead: true, service: { id: 's1' }, therapistId: null },
        { isLead: false, name: 'Guest 2', service: { id: 's2' }, therapistId: 't1' },
      ],
    });
    expect(result.error).toBeNull();
    expect(calls).toHaveLength(2);
    expect(calls[0].bookingGroupId).toBe(calls[1].bookingGroupId);
    expect(calls[1].customerPhone).toBe(calls[0].customerPhone); // guest inherits lead phone
  });

  it('rolls back already-created rows and surfaces the failing person error on partial failure', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({ data: 1, error: null });
    vi.spyOn(api, 'createBooking')
      .mockResolvedValueOnce({ data: { bookingId: 'booking-1' }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Room is full' } });
    // supabase client's .rpc is mocked at the module/import level per existing api.test.js conventions for this repo.
    const result = await api.submitGroupBooking({
      branchId: 'b1', orgSlug: 'nuad', date: '2026-11-02', startTime: '10:00',
      leadContact: { name: 'Anish', email: 'a@x.com', phone: '9800000000' },
      people: [
        { isLead: true, service: { id: 's1' }, therapistId: null },
        { isLead: false, name: 'Guest 2', service: { id: 's2' }, therapistId: null },
      ],
    });
    expect(result.error.message).toContain('Room is full');
  });
});
```

(Implementer: match whatever existing mocking convention `src/services/*.test.js` already uses for `supabase.rpc` — check an existing test file for the pattern rather than inventing a new one.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/api.test.js`
Expected: FAIL — `submitGroupBooking` not exported.

- [ ] **Step 3: Implement `submitGroupBooking`** per Interfaces above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/api.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/api.js src/services/api.test.js
git commit -m "feat(group-booking): add submitGroupBooking orchestration with rollback"
```

---

### Task 4: Feature flag + entry choice screen

**Files:**
- Modify: `src/lib/featureFlags.js`
- Modify: `.env.staging`
- Create: `src/pages/provider-profile-flow/components/BookingView/GroupEntryChoice.jsx`
- Modify: `src/pages/provider-profile-flow/index.jsx`

**Interfaces:**
- Produces: `export const GROUP_BOOKING_ENABLED = import.meta.env.VITE_ENABLE_GROUP_BOOKING === 'true';` in `featureFlags.js`.
- `GroupEntryChoice({ onChooseSolo, onChooseGroup, onClose })` — two-option screen: "Book an appointment" / "Book group appointment" ("For yourself and others"), each a button calling its handler.
- `index.jsx` new state: `entryChoiceOpen` (boolean), `groupPeople` (array, from Task 1's `createLeadPerson()`), `groupModeOpen` (boolean). Wire the existing primary CTA (wherever `bookingOpen` is currently set true — `SummaryCard`/`MobileBookingBar`'s continue handler) so that when `GROUP_BOOKING_ENABLED` is true it sets `entryChoiceOpen = true` instead of `bookingOpen = true` directly; choosing "solo" there sets `bookingOpen = true` (today's existing path, unchanged); choosing "group" sets `groupModeOpen = true`. When the flag is false, behavior is byte-identical to today (CTA sets `bookingOpen` directly, `entryChoiceOpen`/`groupModeOpen` never used).

- [ ] **Step 1: Add the flag**

`featureFlags.js`: add the `GROUP_BOOKING_ENABLED` export, comment explaining the gate (follow the file's existing comment style — one sentence on why it's flagged). `.env.staging`: add `VITE_ENABLE_GROUP_BOOKING=true` alongside the other flags.

- [ ] **Step 2: Build `GroupEntryChoice.jsx`**

Two large tappable cards (reuse the `RadioCard`-style visual pattern from `ProfessionalStep.jsx` for consistency), no state of its own — pure presentational, controlled by the two callback props.

- [ ] **Step 3: Wire `index.jsx`**

Add the three new state vars and the conditional branch (gated on `GROUP_BOOKING_ENABLED`) described in Interfaces. Render `GroupEntryChoice` when `entryChoiceOpen`. Leave every existing branch (`tenantError`/`tenantLoading`/`bookingData`/`bookingOpen`/etc.) untouched and in the same order — insert the new checks without reordering the existing cascade.

- [ ] **Step 4: Manual verification**

Run `npm start`, confirm: with `VITE_ENABLE_GROUP_BOOKING` unset/false, the booking CTA behaves exactly as before (no choice screen). With it true, clicking the CTA shows the choice screen; "Book an appointment" reaches today's unchanged solo flow.

- [ ] **Step 5: Commit**

```bash
git add src/lib/featureFlags.js .env.staging src/pages/provider-profile-flow/components/BookingView/GroupEntryChoice.jsx src/pages/provider-profile-flow/index.jsx
git commit -m "feat(group-booking): add feature flag and entry-choice screen"
```

---

### Task 5: Guests + per-guest service selection screen

**Files:**
- Create: `src/pages/provider-profile-flow/components/GroupBookingView/index.jsx`
- Create: `src/pages/provider-profile-flow/components/GroupBookingView/GuestsStep.jsx`

**Interfaces:**
- Consumes: Task 1's `groupBooking.js` helpers; existing `ServicesSection` component (reused, but driven in **single-select** mode for whichever guest is "active" — pass `selectedServices={activeGuest.service ? [activeGuest.service] : []}` and an `onServiceToggle` that **replaces** rather than toggles the array, since a click on an already-selected service in `ServicesSection`'s existing toggle logic would otherwise deselect it with no way to pick a different one for this guest).
- Produces: `GroupBookingView({ selectedBranch, services, onClose, onSubmit, ...everything GroupEntryChoice's "group" path needs })` owns `people` state (seeded from Task 1) and an internal `stepIndex`/`steps` machine (`guests` → `professional` → `time` → `confirm`), structurally mirroring `BookingView/index.jsx` (same nav breadcrumb pattern, same `DiscardDialog` reuse, same full-page layout). `GuestsStep({ people, services, activeGuestId, onSelectActiveGuest, onServiceChosenForActiveGuest, onAddGuest, onRemoveGuest })` renders: "Me" row + chosen service + each guest row ("Guest 2 — No services selected" until picked, or the chosen service name), an "Add guest" button (disabled at `MAX_GROUP_SIZE`, caption "Book a group appointment for up to 6 guests"), and — when a guest has no service yet or is clicked to edit — the reused `ServicesSection` scoped to them as described above.

- [ ] **Step 1: Build `GuestsStep.jsx`** per Interfaces.

- [ ] **Step 2: Build `GroupBookingView/index.jsx`** step shell (nav, header, `people` state, `canContinue.guests = people.every(p => !!p.service)`).

- [ ] **Step 3: Manual verification**

In-browser: open group flow, add up to 5 guests (6th "Add guest" click is a no-op/disabled), pick a different service per person, remove a middle guest and confirm the remaining guests relabel correctly and keep their own already-chosen services (this is the Review Focus item on id-keyed removal — check it explicitly here, not just in Task 1's unit test, since this is where a position-keyed bug would actually show up visibly).

- [ ] **Step 4: Commit**

```bash
git add src/pages/provider-profile-flow/components/GroupBookingView/index.jsx src/pages/provider-profile-flow/components/GroupBookingView/GuestsStep.jsx
git commit -m "feat(group-booking): add guests-and-services step"
```

---

### Task 6: Professional step (any-for-all vs per-guest)

**Files:**
- Create: `src/pages/provider-profile-flow/components/GroupBookingView/GroupProfessionalStep.jsx`
- Modify: `src/pages/provider-profile-flow/components/GroupBookingView/index.jsx` (wire the `professional` step)

**Interfaces:**
- Consumes: existing `ProfessionalStep` component (reused unmodified, once per guest/service row when "per guest" mode is active) and `therapists` (branch roster, already fetched by `index.jsx` today and passed down the same way `BookingView` receives it).
- Produces: `GroupProfessionalStep({ people, therapists, loading, error, onSelectAnyForAll, onSelectPerGuestMode, mode, onPersonProfessionalSelect })` — top-level radio: "Any professional" (sets every person's `professional = { mode: 'any' }` in one shot via `onSelectAnyForAll`) vs "Select professional per service" (`mode = 'per-guest'`, expands one `ProfessionalStep` instance per person, each calling `onPersonProfessionalSelect(personId, selection)`). `canContinue.professional = people.every(p => !!p.professional)`.

- [ ] **Step 1: Build `GroupProfessionalStep.jsx`** per Interfaces, reusing `ProfessionalStep` as a child component (don't fork its modal/radio-card JSX).

- [ ] **Step 2: Wire into `GroupBookingView/index.jsx`**'s `professional` step slot.

- [ ] **Step 3: Manual verification**

Confirm both tiers work: "Any professional" instantly satisfies `canContinue` for all people; "per guest" requires picking one per person before Continue enables.

- [ ] **Step 4: Commit**

```bash
git add src/pages/provider-profile-flow/components/GroupBookingView/GroupProfessionalStep.jsx src/pages/provider-profile-flow/components/GroupBookingView/index.jsx
git commit -m "feat(group-booking): add per-guest professional selection step"
```

---

### Task 7: Shared time-slot step

**Files:**
- Create: `src/pages/provider-profile-flow/components/GroupBookingView/GroupTimeStep.jsx`
- Modify: `src/pages/provider-profile-flow/components/GroupBookingView/index.jsx`

**Interfaces:**
- Consumes: Task 2's `computeGroupSlots`; `fetchBranchAvailabilityWindow`, `fetchTherapistAvailabilityWindow`, `fetchClosedDateRanges` (all existing, `services/api.js`) — fetched once each for the whole group, same `effectiveWindow`/`dates` generation as `DateTimeSelection.jsx` (copy that date-chip-generation `useMemo` verbatim rather than re-deriving it, since it already encodes the `advance_booking_days` rule from migration-303).
- Produces: `GroupTimeStep({ selectedBranch, people, therapists, selectedDateTime, onDateTimeSelect })` — fetches the two windows + closed ranges in `useEffect`s mirroring `DateTimeSelection.jsx:88-138`, resolves each person's eligible-therapist-id-set for `computeGroupSlots`'s `allTherapists`/`people` shape (an `'any'` person's `professional.mode === 'any'` needs no resolution — `allTherapists` already covers it; a `'specific'` person passes their chosen `therapist.id` straight through), calls `computeGroupSlots`, and renders the date-chip-strip + slot-grid JSX (copy the rendering half of `DateTimeSelection.jsx`'s return block — not its fetch/compute half, which Task 2 replaces — since `computedDays`'s shape is intentionally identical).

- [ ] **Step 1: Build `GroupTimeStep.jsx`** per Interfaces.

- [ ] **Step 2: Wire into `GroupBookingView/index.jsx`**'s `time` step slot. `canContinue.time = !!(selectedDateTime.date && selectedDateTime.time)`.

- [ ] **Step 3: Manual verification**

With 2+ guests all on "any professional" at a branch with only 1-2 active therapists, confirm the slot grid actually shrinks (fewer available slots than a solo booking would show at the same branch) — this is the main behavior the spec calls out as net-new.

- [ ] **Step 4: Commit**

```bash
git add src/pages/provider-profile-flow/components/GroupBookingView/GroupTimeStep.jsx src/pages/provider-profile-flow/components/GroupBookingView/index.jsx
git commit -m "feat(group-booking): add shared time-slot step with N-way availability"
```

---

### Task 8: Confirm step + submit

**Files:**
- Create: `src/pages/provider-profile-flow/components/GroupBookingView/GroupConfirmStep.jsx`
- Modify: `src/pages/provider-profile-flow/components/GroupBookingView/index.jsx`
- Modify: `src/pages/provider-profile-flow/index.jsx` (success handling — reuse the existing `bookingData`/`BookingSuccess` branch for the group result too, rather than building a second success screen)

**Interfaces:**
- Consumes: existing `CustomerForm` (reused unmodified for the lead's one-time contact entry); Task 3's `submitGroupBooking`; `formatNPR` (`services/bookingTransformers.js`).
- Produces: `GroupConfirmStep({ people, leadContact, onLeadContactChange, selectedBranch, selectedDateTime, onSubmit, submitting, submitError })` — renders `CustomerForm` for the lead once, a read-only guest-name list (editable name input per guest if not already named in Task 5 — if Task 5 didn't collect guest names, collect them here instead; pick one place, not both), an itemized line per person (`service.name` + `formatNPR(service.effective_price_npr ?? service.price_npr)`) + total, and the submit button calling `onSubmit`. On `submitError`, render it exactly as `BookingConfirmation.jsx` renders `createBooking`/`createBookingGroup` errors today (reuse that error-message-mapping logic/copy, don't invent new copy for the same error codes).
- `GroupBookingView/index.jsx`'s submit handler calls `submitGroupBooking(...)`, and on success calls a new `onGroupBookingComplete(data)` prop that `provider-profile-flow/index.jsx` wires to the same `bookingData`/`bookingOpen` setters `handleConfirmBooking` already uses, so `BookingSuccess` renders identically for solo and group (check what shape `BookingSuccess` expects — if it expects a single booking, pass `data.bookings[0]` plus however many siblings for a "see your other N bookings" line using the existing `fetchGroupBookings` already wired into `BookingActionModal.jsx`, reused here rather than re-querying by hand).

- [ ] **Step 1: Build `GroupConfirmStep.jsx`** per Interfaces.

- [ ] **Step 2: Wire submit handler into `GroupBookingView/index.jsx`**, and the success handoff into `provider-profile-flow/index.jsx`.

- [ ] **Step 3: Manual verification — real staging submission**

With the dev server on `:4028` against staging, click through: entry choice → group → add 2 guests with distinct services and distinct specific therapists → shared time slot → lead contact → submit. Confirm in the Supabase staging dashboard (or via `BookingActionModal`'s "group" tab on the staff dashboard) that 3 rows landed sharing one `booking_group_id`, each with the correct `customer_name`/`service_id`/`therapist_id`, and the two guest rows carry the lead's phone/email. Then deliberately force a mid-loop failure (e.g. pick a specific therapist for guest 2 who's already fully booked at the chosen slot via another tab/direct insert) and confirm the earlier-created row(s) get cancelled via rollback and the customer sees a real error, not a silent partial group.

- [ ] **Step 4: Commit**

```bash
git add src/pages/provider-profile-flow/components/GroupBookingView/GroupConfirmStep.jsx src/pages/provider-profile-flow/components/GroupBookingView/index.jsx src/pages/provider-profile-flow/index.jsx
git commit -m "feat(group-booking): add confirm step and wire submission"
```

---

### Task 9: Full build + test gate

**Files:** none (verification-only task)

- [ ] **Step 1:** `npm run build` — must pass clean.
- [ ] **Step 2:** `npm test` — all vitest suites pass, including Tasks 1-3's new tests.
- [ ] **Step 3:** Re-run the Task 8 Step 3 manual click-through once more end to end after the full build (not just dev server) to catch anything a dev-mode-only behavior masked.
- [ ] **Step 4:** Message the reviewing peer session with: file list (created/modified, from the File Structure section above), test output, what was clicked through on staging, and the one recorded deviation from spec (capacity-rule wiring reuses the already-live `DateTimeSelection.jsx` composition rather than a fresh `buildOccupancy` call, since research found that composition already serves the live flow — corrected in "Review of open unknowns" above).
