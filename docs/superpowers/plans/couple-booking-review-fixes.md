# Couple-booking review-findings fix Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

Goal: Fix the 6 logic gaps found in an adversarial review of PR #245 (branch
feature/couple-separate-rooms in the book-spa repo), without changing the PR's overall
design (per-therapist room override on booking_therapists.room_id, services.is_couple flag).

Architecture: Extract the two pieces of fiddly logic the review found buggy (junction-row
room_id resolution, and room-overlap counting that must union bookings.room_id +
booking_therapists.room_id occupancy) into small, pure, independently-testable helper
modules — following this codebase's existing convention (transferDedup.js,
therapistBranchWindow.js, etc. are pure logic siblings of api.js, unit-tested directly,
imported and used by the Supabase-calling functions). Everything else (surfacing swallowed
errors, gating UI payload construction, a server-side guard) is a direct edit at the call site
the review flagged.

Tech Stack: React 18, Vite, Supabase (Postgres), Vitest for unit tests.

Spec: This plan's own "Findings" section below (from the PR #245 review) IS the spec —
there is no separate external spec doc.

## Global Constraints

- Work happens on the existing branch feature/couple-separate-rooms (already pushed as PR #245
against stage) — do not create a new branch; commit directly onto this one and push.
- booking.bookingId (UUID) vs booking.id (display number) convention, toDbStatus(), and the
state-machine validators in api.js are unrelated to this fix — do not touch them.
- Every new/changed dropdown must still use CustomSelect — this plan adds no new dropdowns, so
this is a no-op constraint, just confirming no regressions.
- npm run build and npm test (vitest) must both pass after every task.
- Every commit message ends with Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>
(see any existing commit on this branch for the exact format) — no Claude/AI branding, per this
repo's CLAUDE.md.
- Do not fix anything not listed in the Findings section below — this plan is scoped to exactly
the 6 reviewed issues, nothing more (YAGNI).

---
## Findings this plan fixes (from the PR #245 review)

1. Silent data loss reported as success — createBooking()/assignTherapist() in
src/services/api.js only console.warn when the booking_therapists insert fails, but
still return success/the booking as if nothing went wrong. Now that migration-171 added a
trigger that can actually reject that insert (room-capacity conflict), a booking/reassignment
can end up with zero therapist rows while the caller is told it worked.
2. Stale room override survives promoting a companion to primary — assignTherapist()'s
junction-row room_id resolution falls back to the therapist's previous room_id whenever
they're not in the current override map. Since BookingActionModal.jsx only ever builds an
override entry for selectedTherapists.slice(1) (never index 0), removing the current primary
promotes the old companion to index 0 — and their old override room silently carries over,
with no UI to see or clear it.
3. Companion/override payload outlives the is_couple gate — the companion section's
visibility is gated on the service being is_couple (both in BookingActionModal.jsx and
the calendar's Quick Create panel), but the actual submitted therapistRoomOverrides/
companionName/companionPhone payload is only gated on "2+ therapists selected." Switching
the service away from a couple service before saving still ships the now-hidden data.
4. Primary-room JS pre-check doesn't match the new DB trigger — migration-171 made
check_room_capacity() (the DB trigger) count booking_therapists.room_id occupancy too, but
createBooking()'s JS pre-checks (both the explicit-room and auto-assign path) still only
count bookings.room_id matches. Staff can be told a room is free, submit, and get rejected by
the stricter trigger.
5. Group-booking couple-service exclusion is client-only — the calendar's group-booking
service pickers filter out is_couple services from their dropdown options, but nothing in
createBooking() rejects a couple service if one reaches it via the group path anyway (e.g. a
value selected before the service list refreshed).
6. checkOverrideRoomCapacity()'s companion-overlap check has no time fallback — it compares
bt.start_time/bt.end_time directly with no fallback to the parent booking's own
start_time/end_time (the DB trigger added in migration-171 always does
COALESCE(bt.start_time, b2.start_time)). Dormant today since every current write path
backfills those columns, but a latent trap.

---
## Task 1: Pure helper — resolve a junction row's room_id (fixes finding #2)

Files:
- Create: src/services/roomOverrideHelpers.js
- Test: src/services/roomOverrideHelpers.test.js
- Modify: src/services/api.js:1936-1944 (inside assignTherapist)
- Modify: src/services/api.js:5034-5039 (inside createBooking)

Interfaces:
- Produces: resolveJunctionRoomId({ index, therapistId, overridesMap, existingRoomId }) — pure
function, no Supabase calls. Returns a room id string or null. Used by both assignTherapist
and createBooking when building booking_therapists insert rows.

- [ ] Step 1: Write the failing tests

Create src/services/roomOverrideHelpers.test.js:

```js
import { describe, it, expect } from 'vitest';
import { resolveJunctionRoomId } from './roomOverrideHelpers';

describe('resolveJunctionRoomId', () => {
  it('always returns null for the primary (index 0), even with a stale existing override', () => {
    // Regression test for PR #245 finding #2: a former companion promoted to primary
    // (after the old primary was removed) must not carry over their old override room.
    const result = resolveJunctionRoomId({
      index: 0,
      therapistId: 't-2',
      overridesMap: undefined,
      existingRoomId: 'room-b', // stale override from when t-2 was a companion
    });
    expect(result).toBeNull();
  });

  it('uses the override map value for a non-primary therapist', () => {
    const result = resolveJunctionRoomId({
      index: 1,
      therapistId: 't-2',
      overridesMap: { 't-2': 'room-b' },
      existingRoomId: null,
    });
    expect(result).toBe('room-b');
  });

  it('treats an explicit null in the override map as "use the primary room"', () => {
    const result = resolveJunctionRoomId({
      index: 1,
      therapistId: 't-2',
      overridesMap: { 't-2': null },
      existingRoomId: 'room-b', // must NOT fall back to this — the map entry is authoritative
    });
    expect(result).toBeNull();
  });

  it('falls back to the existing room_id when the therapist has no entry in the map at all', () => {
    const result = resolveJunctionRoomId({
      index: 1,
      therapistId: 't-2',
      overridesMap: { 't-3': 'room-c' }, // t-2 not mentioned
      existingRoomId: 'room-b',
    });
    expect(result).toBe('room-b');
  });

  it('returns null when there is no override map and no existing room_id', () => {
    const result = resolveJunctionRoomId({
      index: 1,
      therapistId: 't-2',
      overridesMap: undefined,
      existingRoomId: null,
    });
    expect(result).toBeNull();
  });
});
```

- [ ] Step 2: Run the tests to verify they fail

Run: npx vitest run src/services/roomOverrideHelpers.test.js
Expected: FAIL — Cannot find module './roomOverrideHelpers' (the file doesn't exist yet).

- [ ] Step 3: Write the minimal implementation

Create src/services/roomOverrideHelpers.js:

```js
// The primary therapist (junction row index 0) always uses the booking's own room_id —
// a room override only ever applies to a companion. This must be enforced here,
// unconditionally, rather than left to whatever the caller's override map happens to
// contain: BookingActionModal only ever builds an override entry for non-primary
// therapists, so if a former companion gets promoted to index 0 (the old primary was
// removed), their stale override would otherwise silently carry over with no UI to
// see or clear it.
export function resolveJunctionRoomId({ index, therapistId, overridesMap, existingRoomId }) {
  if (index === 0) return null;
  if (overridesMap && Object.prototype.hasOwnProperty.call(overridesMap, therapistId)) {
    return overridesMap[therapistId] || null;
  }
  return existingRoomId || null;
}
```

- [ ] Step 4: Run the tests to verify they pass

Run: npx vitest run src/services/roomOverrideHelpers.test.js
Expected: PASS (5 tests).

- [ ] Step 5: Wire it into assignTherapist()

In src/services/api.js, add the import near the top (next to the existing
therapistBranchWindow import, ~line 7):

```js
import { resolveJunctionRoomId } from './roomOverrideHelpers';
```

Replace the rows construction inside assignTherapist() (currently lines 1936-1944):

```js
      const rows = ids.map(tid => ({
        booking_id: bookingId,
        therapist_id: tid,
        start_time: existingTimeMap[tid]?.start_time || bk?.start_time || null,
        end_time: existingTimeMap[tid]?.end_time || bk?.end_time || null,
        room_id: existingTimeMap[tid]?.room_id || null,
      }));
```

with:

```js
      const rows = ids.map((tid, index) => ({
        booking_id: bookingId,
        therapist_id: tid,
        start_time: existingTimeMap[tid]?.start_time || bk?.start_time || null,
        end_time: existingTimeMap[tid]?.end_time || bk?.end_time || null,
        room_id: resolveJunctionRoomId({
          index,
          therapistId: tid,
          overridesMap: therapistRoomOverrides,
          existingRoomId: existingTimeMap[tid]?.room_id,
        }),
      }));
```

- [ ] Step 6: Wire it into createBooking()

Replace the rows construction inside createBooking() (currently lines 5034-5039):

```js
      const rows = allTherapistIds.map(tid => ({
        booking_id: booking.id,
        therapist_id: tid,
        start_time: booking.start_time,
        end_time: booking.end_time,
        room_id: therapistRoomOverrides?.[tid] || null,
      }));
```

with:

```js
      const rows = allTherapistIds.map((tid, index) => ({
        booking_id: booking.id,
        therapist_id: tid,
        start_time: booking.start_time,
        end_time: booking.end_time,
        room_id: resolveJunctionRoomId({
          index,
          therapistId: tid,
          overridesMap: therapistRoomOverrides,
          existingRoomId: null, // brand-new booking, nothing to preserve
        }),
      }));
```

- [ ] Step 7: Run full build + test suite

Run: npm run build && npm test
Expected: both clean.

- [ ] Step 8: Commit

```
git add src/services/roomOverrideHelpers.js src/services/roomOverrideHelpers.test.js src/services/api.js
git commit -m "$(cat <<'EOF'
fix(bookings): primary therapist never inherits a stale room override

Removing the current primary while a companion has a room override
promoted that companion to index 0 without clearing their old override
-- assignTherapist's junction-row resolution fell back to their
previous room_id whenever the (primary-only) override map had no entry
for them. Extracted resolveJunctionRoomId() as a pure, unit-tested
helper that unconditionally nulls the override for index 0.

Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>
EOF
)"
```

---
## Task 2: Pure helper — room-overlap counting with time fallback (fixes findings #4 and #6)

Files:
- Modify: src/services/roomOverrideHelpers.js (add a second export)
- Modify: src/services/roomOverrideHelpers.test.js (add tests)
- Modify: src/services/api.js:133-164 (checkOverrideRoomCapacity)
- Modify: src/services/api.js:4740-4756 (createBooking, explicit-room path)
- Modify: src/services/api.js:4771-4796 (createBooking, auto-assign path)

Interfaces:
- Consumes: none (pure function, takes already-fetched rows).
- Produces: countOverlappingRoomRows(rows, { branchId, date, startTime, endTime, excludeBookingId }) — pure function. rows is an array
shaped like what Supabase returns from
.from('booking_therapists').select('booking_id, start_time, end_time, bookings(branch_id, date, status, start_time, end_time)').
Returns an integer count of rows that overlap the given
window, are not Cancelled/No Show, and aren't excludeBookingId.

- [ ] Step 1: Write the failing tests

Append to src/services/roomOverrideHelpers.test.js:

```js
import { countOverlappingRoomRows } from './roomOverrideHelpers';

describe('countOverlappingRoomRows', () => {
  const baseRow = (overrides = {}) => ({
    booking_id: 'bk-1',
    start_time: '10:00:00',
    end_time: '11:00:00',
    bookings: { branch_id: 'br-1', date: '2027-01-01', status: 'Confirmed' },
    ...overrides,
  });

  it('counts a row whose own start/end time overlaps the window', () => {
    const rows = [baseRow()];
    const count = countOverlappingRoomRows(rows, {
      branchId: 'br-1', date: '2027-01-01', startTime: '10:30:00', endTime: '11:30:00',
    });
    expect(count).toBe(1);
  });

  it('falls back to the parent booking start/end time when the row has none (COALESCE parity with the DB trigger)', () => {
    const rows = [baseRow({
      start_time: null,
      end_time: null,
      bookings: { branch_id: 'br-1', date: '2027-01-01', status: 'Confirmed', start_time: '10:00:00', end_time: '11:00:00' },
    })];
    const count = countOverlappingRoomRows(rows, {
      branchId: 'br-1', date: '2027-01-01', startTime: '10:30:00', endTime: '11:30:00',
    });
    expect(count).toBe(1);
  });

  it('excludes Cancelled/No Show bookings', () => {
    const rows = [baseRow({ bookings: { branch_id: 'br-1', date: '2027-01-01', status: 'Cancelled' } })];
    const count = countOverlappingRoomRows(rows, {
      branchId: 'br-1', date: '2027-01-01', startTime: '10:30:00', endTime: '11:30:00',
    });
    expect(count).toBe(0);
  });

  it('excludes a different branch or date', () => {
    const rows = [
      baseRow({ bookings: { branch_id: 'br-OTHER', date: '2027-01-01', status: 'Confirmed' } }),
      baseRow({ bookings: { branch_id: 'br-1', date: '2027-01-02', status: 'Confirmed' } }),
    ];
    const count = countOverlappingRoomRows(rows, {
      branchId: 'br-1', date: '2027-01-01', startTime: '10:30:00', endTime: '11:30:00',
    });
    expect(count).toBe(0);
  });

  it('excludes a non-overlapping time window', () => {
    const rows = [baseRow({ start_time: '12:00:00', end_time: '13:00:00' })];
    const count = countOverlappingRoomRows(rows, {
      branchId: 'br-1', date: '2027-01-01', startTime: '10:00:00', endTime: '11:00:00',
    });
    expect(count).toBe(0);
  });

  it('excludes excludeBookingId (used when re-checking an existing booking being edited)', () => {
    const rows = [baseRow({ booking_id: 'bk-SELF' })];
    const count = countOverlappingRoomRows(rows, {
      branchId: 'br-1', date: '2027-01-01', startTime: '10:30:00', endTime: '11:30:00',
      excludeBookingId: 'bk-SELF',
    });
    expect(count).toBe(0);
  });
});
```

- [ ] Step 2: Run the tests to verify they fail

Run: npx vitest run src/services/roomOverrideHelpers.test.js
Expected: FAIL — countOverlappingRoomRows is not exported yet.

- [ ] Step 3: Write the minimal implementation

Append to src/services/roomOverrideHelpers.js:

```js
// Counts booking_therapists rows overlapping a time window for one room, matching what
// the check_room_capacity()/check_booking_therapist_room_capacity() DB triggers
// (migration-171) do in SQL. Falls back to the parent booking's own start_time/end_time
// when the row's own are null, mirroring the triggers' COALESCE(bt.start_time,
// b2.start_time) — without this fallback, a null-timed row would silently never count.
export function countOverlappingRoomRows(rows, { branchId, date, startTime, endTime, excludeBookingId }) {
  return (rows || []).filter(row => {
    if (excludeBookingId && row.booking_id === excludeBookingId) return false;
    const b = row.bookings || {};
    if (b.branch_id !== branchId) return false;
    if (b.date !== date) return false;
    if (['Cancelled', 'No Show'].includes(b.status)) return false;
    const rowStart = row.start_time || b.start_time;
    const rowEnd = row.end_time || b.end_time;
    if (!rowStart || !rowEnd) return false;
    return rowStart < endTime && rowEnd > startTime;
  }).length;
}
```

- [ ] Step 4: Run the tests to verify they pass

Run: npx vitest run src/services/roomOverrideHelpers.test.js
Expected: PASS (11 tests total: 5 from Task 1 + 6 new).

- [ ] Step 5: Wire it into checkOverrideRoomCapacity() (fixes finding #6)

In src/services/api.js, add countOverlappingRoomRows to the Task 1 import:

```js
import { resolveJunctionRoomId, countOverlappingRoomRows } from './roomOverrideHelpers';
```

Replace the body of checkOverrideRoomCapacity (currently lines 133-164):

```js
async function checkOverrideRoomCapacity({ room, branchId, date, startTime, endTime, excludeBookingId }) {
  const capacity = getRoomCapacity(room);

  let primaryQuery = supabase
    .from('bookings')
    .select('id')
    .eq('room_id', room.id)
    .eq('branch_id', branchId)
    .eq('date', date)
    .not('status', 'in', '("Cancelled","No Show")')
    .lt('start_time', endTime)
    .gt('end_time', startTime);
  if (excludeBookingId) primaryQuery = primaryQuery.neq('id', excludeBookingId);
  const { data: primaryOverlaps } = await primaryQuery;

  const { data: companionRows } = await supabase
    .from('booking_therapists')
    .select('id, booking_id, start_time, end_time, bookings(branch_id, date, status)')
    .eq('room_id', room.id);

  const companionOverlaps = (companionRows || []).filter(bt =>
    bt.booking_id !== excludeBookingId &&
    bt.bookings?.branch_id === branchId &&
    bt.bookings?.date === date &&
    !['Cancelled', 'No Show'].includes(bt.bookings?.status) &&
    bt.start_time < endTime && bt.end_time > startTime
  );

  const occupied = (primaryOverlaps || []).length + companionOverlaps.length;
  if (occupied >= capacity) {
    return { code: 'ROOM_FULL', message: `${room.name} is fully booked at this time (capacity: ${capacity}).` };
```

with:

```js
async function checkOverrideRoomCapacity({ room, branchId, date, startTime, endTime, excludeBookingId }) {
  const capacity = getRoomCapacity(room);

  let primaryQuery = supabase
    .from('bookings')
    .select('id')
    .eq('room_id', room.id)
    .eq('branch_id', branchId)
    .eq('date', date)
    .not('status', 'in', '("Cancelled","No Show")')
    .lt('start_time', endTime)
    .gt('end_time', startTime);
  if (excludeBookingId) primaryQuery = primaryQuery.neq('id', excludeBookingId);
  const { data: primaryOverlaps } = await primaryQuery;

  const { data: companionRows } = await supabase
    .from('booking_therapists')
    .select('booking_id, start_time, end_time, bookings(branch_id, date, status, start_time, end_time)')
    .eq('room_id', room.id);

  const companionCount = countOverlappingRoomRows(companionRows, { branchId, date, startTime, endTime, excludeBookingId });

  const occupied = (primaryOverlaps || []).length + companionCount;
  if (occupied >= capacity) {
    return { code: 'ROOM_FULL', message: `${room.name} is fully booked at this time (capacity: ${capacity}).` };
```

(Leave the closing `}` lines after this block exactly as they are — only the body above the
`if (occupied >= capacity)` line changes; the rest of the function is untouched.)

- [ ] Step 6: Wire it into createBooking()'s explicit-room path (fixes finding #4)

Replace the capacity check inside the `else if (roomId)` branch (currently lines 4740-4756):

```js
        // Check room capacity — count overlapping bookings
        const capacity = getRoomCapacity(selectedRoom);
        const { data: roomOverlaps } = await supabase
          .from('bookings')
          .select('id')
          .eq('room_id', roomId)
          .eq('branch_id', resolvedBranchId)
          .eq('date', date)
          .not('status', 'in', '("Cancelled","No Show")')
          .lt('start_time', endTime)
          .gt('end_time', startTime);

        if ((roomOverlaps || []).length >= capacity) {
          return { data: null, error: { code: 'ROOM_FULL', message: `${selectedRoom.name} is fully booked at this time (capacity: ${capacity}).` } };
        }

        availableRoom = selectedRoom;
```

with:

```js
        // Check room capacity — count overlapping bookings. Must union bookings.room_id
        // matches (someone's primary room) with booking_therapists.room_id matches
        // (a companion's override room) — see migration-171's check_room_capacity(),
        // which this JS pre-check must agree with or staff get told a room is free
        // right before the stricter DB trigger rejects it.
        const capacity = getRoomCapacity(selectedRoom);
        const { data: roomOverlaps } = await supabase
          .from('bookings')
          .select('id')
          .eq('room_id', roomId)
          .eq('branch_id', resolvedBranchId)
          .eq('date', date)
          .not('status', 'in', '("Cancelled","No Show")')
          .lt('start_time', endTime)
          .gt('end_time', startTime);

        const { data: companionOverlapRows } = await supabase
          .from('booking_therapists')
          .select('booking_id, start_time, end_time, bookings(branch_id, date, status, start_time, end_time)')
          .eq('room_id', roomId);
        const companionOverlapCount = countOverlappingRoomRows(companionOverlapRows, {
          branchId: resolvedBranchId, date, startTime, endTime,
        });

        if ((roomOverlaps || []).length + companionOverlapCount >= capacity) {
          return { data: null, error: { code: 'ROOM_FULL', message: `${selectedRoom.name} is fully booked at this time (capacity: ${capacity}).` } };
        }

        availableRoom = selectedRoom;
```

- [ ] Step 7: Wire it into createBooking()'s auto-assign path (fixes finding #4)

Replace the counting block inside the auto-assign else branch (currently lines 4771-4792):

```js
        // 4. Count overlapping bookings per room
        const { data: overlapping, error: overlapError } = await supabase
          .from('bookings')
          .select('room_id')
          .eq('branch_id', resolvedBranchId)
          .eq('date', date)
          .not('status', 'in', '("Cancelled","No Show")')
          .lt('start_time', endTime)
          .gt('end_time', startTime);

        if (overlapError) throw overlapError;

        // 5. Count bookings per room and pick first with remaining capacity
        const roomBookingCounts = {};
        (overlapping || []).forEach(b => {
          roomBookingCounts[b.room_id] = (roomBookingCounts[b.room_id] || 0) + 1;
        });
        availableRoom = rooms.find(r => {
          const capacity = getRoomCapacity(r);
          const used = roomBookingCounts[r.id] || 0;
          return used < capacity;
        });
```

with:

```js
        // 4. Count overlapping bookings per room
        const { data: overlapping, error: overlapError } = await supabase
          .from('bookings')
          .select('room_id')
          .eq('branch_id', resolvedBranchId)
          .eq('date', date)
          .not('status', 'in', '("Cancelled","No Show")')
          .lt('start_time', endTime)
          .gt('end_time', startTime);

        if (overlapError) throw overlapError;

        // 5. Count bookings per room and pick first with remaining capacity. Also count
        // booking_therapists.room_id occupancy (companion overrides) per candidate room —
        // same reasoning as the explicit-room path above.
        const roomBookingCounts = {};
        (overlapping || []).forEach(b => {
          roomBookingCounts[b.room_id] = (roomBookingCounts[b.room_id] || 0) + 1;
        });

        const { data: companionOverlapRowsAll } = await supabase
          .from('booking_therapists')
          .select('room_id, booking_id, start_time, end_time, bookings(branch_id, date, status, start_time, end_time)')
          .in('room_id', rooms.map(r => r.id));

        rooms.forEach(r => {
          const rowsForRoom = (companionOverlapRowsAll || []).filter(row => row.room_id === r.id);
          const companionCount = countOverlappingRoomRows(rowsForRoom, {
            branchId: resolvedBranchId, date, startTime, endTime,
          });
          if (companionCount > 0) {
            roomBookingCounts[r.id] = (roomBookingCounts[r.id] || 0) + companionCount;
          }
        });

        availableRoom = rooms.find(r => {
          const capacity = getRoomCapacity(r);
          const used = roomBookingCounts[r.id] || 0;
          return used < capacity;
        });
```

- [ ] Step 8: Run full build + test suite

Run: npm run build && npm test
Expected: both clean.

- [ ] Step 9: Commit

```
git add src/services/roomOverrideHelpers.js src/services/roomOverrideHelpers.test.js src/services/api.js
git commit -m "$(cat <<'EOF'
fix(bookings): JS room-capacity pre-checks now match the DB trigger

migration-171's check_room_capacity() trigger counts
booking_therapists.room_id occupancy (companion overrides) alongside
bookings.room_id -- createBooking()'s JS pre-checks (both explicit-room
and auto-assign paths) still only counted the latter, so staff could be
told a room was free right before the stricter trigger rejected it.
Extracted countOverlappingRoomRows() as a pure, unit-tested helper
(also fixes checkOverrideRoomCapacity's missing COALESCE-style
start/end time fallback) and reused it in all three call sites.

Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>
EOF
)"
```

---
## Task 3: Surface swallowed booking_therapists insert failures (fixes finding #1)

Files:
- Modify: src/services/api.js (assignTherapist, createBooking)
- Modify: src/pages/branch-manager-dashboard/components/calendar/index.jsx
(handleAssignTherapist, handleQuickCreateSubmit)

Interfaces:
- assignTherapist()'s success return shape changes from `{ data: { success, bookingId, therapistIds, roomId }, error: null }` to
optionally include `warning: string` on
data when the junction write failed. error stays null in this case — the primary
therapist/room update on bookings already committed, so this is not a full failure.
- createBooking()'s returned booking object (still `data: booking, error: null` on success)
gets an extra non-persisted field `booking._therapistAssignmentWarning` (string, only present
when the junction write failed) — this is on the JS object returned to the caller, not written
to the database (it doesn't exist as a bookings column).

- [ ] Step 1: Update assignTherapist()

In src/services/api.js, find (currently lines 1945-1951):

```js
      const { error: junctionError } = await supabase.from('booking_therapists').insert(rows);
      if (junctionError) {
        console.warn('[API] booking_therapists insert warning:', junctionError.message);
      }
    }

    return { data: { success: true, bookingId, therapistIds: ids, roomId: updated.room_id }, error: null };
```

Replace with:

```js
      const { error: junctionError } = await supabase.from('booking_therapists').insert(rows);
      if (junctionError) {
        // Non-fatal: the primary therapist/room update on `bookings` above already
        // committed. But since migration-171 added a trigger that can reject this
        // insert for a real reason (room-capacity conflict), staying silent here would
        // leave the booking with ZERO therapist rows while reporting success -- surface
        // it as a warning so the caller can tell staff, instead of only console.warn.
        console.warn('[API] booking_therapists insert warning:', junctionError.message);
        return {
          data: { success: true, bookingId, therapistIds: ids, roomId: updated.room_id, warning: junctionError.message },
          error: null,
        };
      }
    }

    return { data: { success: true, bookingId, therapistIds: ids, roomId: updated.room_id }, error: null };
```

- [ ] Step 2: Update createBooking()

Find (currently lines 5032-5043):

```js
    // 7b. Insert into junction table for all therapists
    if (allTherapistIds.length > 0) {
      const rows = allTherapistIds.map((tid, index) => ({
        booking_id: booking.id,
        therapist_id: tid,
        start_time: booking.start_time,
        end_time: booking.end_time,
        room_id: resolveJunctionRoomId({
          index,
          therapistId: tid,
          overridesMap: therapistRoomOverrides,
          existingRoomId: null,
        }),
      }));
      const { error: btError } = await supabase.from('booking_therapists').insert(rows);
      if (btError) console.warn('[API] booking_therapists insert error:', btError.message);
    }
```

(Note: this snippet already reflects Task 1's edit — resolveJunctionRoomId is already in place
by the time you reach this task.)

Replace the last two lines with:

```js
      const { error: btError } = await supabase.from('booking_therapists').insert(rows);
      if (btError) {
        // Same reasoning as assignTherapist above -- the booking row itself already
        // committed, so this stays non-fatal, but must be visible to the caller now
        // that a real trigger can reject this insert.
        console.warn('[API] booking_therapists insert error:', btError.message);
        booking._therapistAssignmentWarning = btError.message;
      }
    }
```

- [ ] Step 3: Surface the warning in calendar/index.jsx's handleAssignTherapist

Find (search for `const handleAssignTherapist = async (bookingId, therapistIds, notes, roomId,`):

```js
  const handleAssignTherapist = async (bookingId, therapistIds, notes, roomId, therapistRoomOverrides, companionName, companionPhone) => {
    const ids = Array.isArray(therapistIds) ? therapistIds : (therapistIds ? [therapistIds] : []);
    const result = await assignTherapist({
      bookingId,
      therapistIds: ids,
      roomId: roomId !== undefined ? (roomId || null) : undefined,
      therapistRoomOverrides,
      companionName,
      companionPhone,
    });
    if (result.error) {
      showToast(result.error.message || `Failed to assign ${staffLabel.toLowerCase()}.`, 'error');
      return;
    }
    showToast('Assignment saved successfully');
  };
```

Replace the tail with:

```js
    if (result.error) {
      showToast(result.error.message || `Failed to assign ${staffLabel.toLowerCase()}.`, 'error');
      return;
    }
    if (result.data?.warning) {
      showToast(`Assignment partially saved: ${result.data.warning}`, 'error');
      return;
    }
    showToast('Assignment saved successfully');
  };
```

- [ ] Step 4: Surface the warning in calendar/index.jsx's handleQuickCreateSubmit

Find the individual-booking (non-group) createBooking call and its result handling (search for
`showToast('Booking created successfully')`):

```js
    if (result.error) {
      return result.error.message || 'Failed to create booking.';
    }
    showToast('Booking created successfully');
    setQuickCreateSlot(null);
    refreshCalendar();
    return null;
```

Replace with:

```js
    if (result.error) {
      return result.error.message || 'Failed to create booking.';
    }
    if (result.data?._therapistAssignmentWarning) {
      showToast(`Booking created, but: ${result.data._therapistAssignmentWarning}`, 'error');
    } else {
      showToast('Booking created successfully');
    }
    setQuickCreateSlot(null);
    refreshCalendar();
    return null;
```

- [ ] Step 5: Run full build + test suite

Run: npm run build && npm test
Expected: both clean.

- [ ] Step 6: Commit

```
git add src/services/api.js src/pages/branch-manager-dashboard/components/calendar/index.jsx
git commit -m "$(cat <<'EOF'
fix(bookings): surface booking_therapists insert failures instead of only console.warn

migration-171 added a trigger that can genuinely reject this insert
(room-capacity conflict). Silently swallowing it meant a
booking/reassignment could end up with zero therapist rows while the
caller was told it succeeded. Now returns a non-fatal `warning`
(assignTherapist) / `_therapistAssignmentWarning` (createBooking) the
UI surfaces as a toast.

Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>
EOF
)"
```

---
## Task 4: Gate the companion payload on is_couple, not just therapist count (fixes finding #3)

Files:
- Modify: src/components/ui/BookingActionModal.jsx (handleAssignTherapist)
- Modify: src/pages/branch-manager-dashboard/components/calendar/index.jsx (handleSubmit,
individual-mode payload)

Interfaces: none new — purely tightens existing conditions.

- [ ] Step 1: Fix BookingActionModal.jsx

Find (search for `Overrides only make sense for non-primary`):

```js
        // Overrides only make sense for non-primary (companion) therapists —
        // the primary always uses selectedRoom.
        const overridesToSend = selectedTherapists.length > 1
          ? Object.fromEntries(
              selectedTherapists.slice(1).map(tid => [tid, therapistRoomOverrides[tid] || selectedRoom || null])
            )
          : undefined;
        await onAssignTherapist(
          booking.bookingId,
          selectedTherapists,
          notes,
          selectedRoom || null,
          overridesToSend,
          selectedTherapists.length > 1 ? (companionName.trim() || null) : undefined,
          selectedTherapists.length > 1 ? (companionPhone.trim() || null) : undefined
        );
```

Replace with:

```js
        // Overrides/companion info only make sense for a couple-flagged service with
        // 2+ therapists selected -- gate on BOTH, not just therapist count, or this data
        // ships even after the section that shows it has been hidden (e.g. staff picked
        // 2 therapists on a couple service, then changed the service before saving).
        const isCoupleAssignment = selectedTherapists.length > 1 && !!currentServiceObj?.is_couple;
        const overridesToSend = isCoupleAssignment
          ? Object.fromEntries(
              selectedTherapists.slice(1).map(tid => [tid, therapistRoomOverrides[tid] || selectedRoom || null])
            )
          : undefined;
        await onAssignTherapist(
          booking.bookingId,
          selectedTherapists,
          notes,
          selectedRoom || null,
          overridesToSend,
          isCoupleAssignment ? (companionName.trim() || null) : undefined,
          isCoupleAssignment ? (companionPhone.trim() || null) : undefined
        );
```

(`currentServiceObj` is the existing useMemo already defined earlier in this component — no
new lookup needed.)

- [ ] Step 2: Fix calendar/index.jsx's individual-mode submit payload

Find (search for `therapistRoomOverrides: selectedTherapistIds.length > 1`):

```js
          therapistIds: selectedTherapistIds.length > 0 ? selectedTherapistIds : null,
          roomId: roomId || null,
          therapistRoomOverrides: selectedTherapistIds.length > 1
            ? Object.fromEntries(
                selectedTherapistIds.slice(1).map(tid => [tid, therapistRoomOverrides[tid] || roomId || null])
              )
            : undefined,
          companionName: selectedTherapistIds.length > 1 ? (companionName.trim() || null) : undefined,
          companionPhone: selectedTherapistIds.length > 1 ? (companionPhone.trim() || null) : undefined,
```

Replace with:

```js
          therapistIds: selectedTherapistIds.length > 0 ? selectedTherapistIds : null,
          roomId: roomId || null,
          therapistRoomOverrides: isCoupleService && selectedTherapistIds.length > 1
            ? Object.fromEntries(
                selectedTherapistIds.slice(1).map(tid => [tid, therapistRoomOverrides[tid] || roomId || null])
              )
            : undefined,
          companionName: isCoupleService && selectedTherapistIds.length > 1 ? (companionName.trim() || null) : undefined,
          companionPhone: isCoupleService && selectedTherapistIds.length > 1 ? (companionPhone.trim() || null) : undefined,
```

This `handleSubmit` function is defined in the same QuickCreatePanel component that already
computes the companion section's visibility at (search for `Couple in separate rooms — surfaced only for a couple-flagged service`):

```js
            {selectedTherapistIds.length > 1 && (services || []).find(s => s.id === serviceId)?.is_couple && (
```

Add a `isCoupleService` derived value near the top of the component (with the other useState/
derived values, e.g. right after the `serviceId` state declaration) so both the visibility check
and handleSubmit share one source of truth instead of repeating the `.find()`:

```js
  const isCoupleService = (services || []).find(s => s.id === serviceId)?.is_couple || false;
```

Then simplify the visibility condition to use it too:

```js
            {selectedTherapistIds.length > 1 && isCoupleService && (
```

- [ ] Step 3: Run full build + test suite

Run: npm run build && npm test
Expected: both clean.

- [ ] Step 4: Commit

```
git add src/components/ui/BookingActionModal.jsx src/pages/branch-manager-dashboard/components/calendar/index.jsx
git commit -m "$(cat <<'EOF'
fix(booking-ui): gate companion payload on is_couple, not just therapist count

The companion room-override/name/phone section's visibility was
already gated on is_couple, but the actual submitted payload was only
gated on therapist count -- switching a booking/new-booking's service
away from a couple service before saving still shipped the now-hidden
data. Both surfaces (BookingActionModal, calendar Quick Create) now
gate the payload on the same condition as the visible section.

Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>
EOF
)"
```

---
## Task 5: Server-side guard against a couple service in a group booking (fixes finding #5)

Files:
- Modify: src/services/api.js (createBooking)

Interfaces: none new — adds one validation branch using data already fetched.

- [ ] Step 1: Include is_couple in the service fetch and add the guard

Find, near the top of createBooking() (currently lines 4685-4691):

```js
    // 1. Fetch service for duration + price
    const { data: service, error: serviceError } = await supabase
      .from('services')
      .select('id, name, duration_minutes, price_npr')
      .eq('id', serviceId)
      .single();

    if (serviceError) throw serviceError;
```

Replace with:

```js
    // 1. Fetch service for duration + price
    const { data: service, error: serviceError } = await supabase
      .from('services')
      .select('id, name, duration_minutes, price_npr, is_couple')
      .eq('id', serviceId)
      .single();

    if (serviceError) throw serviceError;

    // Group-booking creates one independent bookings row per person, each carrying the
    // full service price -- a couple service (priced once for the pair) picked there
    // would double-charge. The calendar's group-booking service pickers already filter
    // is_couple services out of their options, but that's client-side only; enforce it
    // here too in case a value was selected before the service list refreshed.
    if (bookingGroupId && service.is_couple) {
      return {
        data: null,
        error: {
          code: 'COUPLE_SERVICE_NOT_ALLOWED_IN_GROUP',
          message: `${service.name} is a couple service and can't be booked as a group booking — use a single booking with 2 therapists instead.`,
        },
      };
    }
```

- [ ] Step 2: Run full build + test suite

Run: npm run build && npm test
Expected: both clean.

- [ ] Step 3: Commit

```
git add src/services/api.js
git commit -m "$(cat <<'EOF'
fix(bookings): reject couple services in group bookings server-side

The calendar's group-booking service pickers already filter is_couple
services out of their dropdown options, but that's a client-side
filter only -- nothing stopped an already-selected value from reaching
createBooking if the service list changed after selection. Adds the
same check inside createBooking itself.

Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>
EOF
)"
```

---
## Task 6: Push and update the PR

Files: none — git operations only.

- [ ] Step 1: Push the 5 new commits

`git push origin feature/couple-separate-rooms`

- [ ] Step 2: Verify PR #245 picked up the new commits and still shows no merge conflicts

`gh pr view 245 --json mergeable,mergeStateStatus,commits --jq '{mergeable,mergeStateStatus,ncommits:(.commits|length)}'`

Expected: `mergeable: "MERGEABLE"`.

- [ ] Step 3: Add a PR comment summarizing the fixes

```
gh pr comment 245 --body "$(cat <<'EOF'
Addressed all 6 findings from the review pass:
1. Surfaced previously-swallowed booking_therapists insert failures as a visible warning instead of only console.warn.
2. Fixed a stale room override carrying over when a companion is promoted to primary.
3. Gated the companion payload (not just its visible UI section) on the service being is_couple.
4. Brought createBooking's JS room-capacity pre-checks in line with migration-171's DB trigger (both now count booking_therapists.room_id occupancy).
5. Added a server-side guard rejecting couple services in group bookings (previously client-filter only).
6. Fixed a missing time fallback in checkOverrideRoomCapacity's companion-overlap check.

New pure helper module `src/services/roomOverrideHelpers.js` (unit-tested) backs fixes #2, #4, and #6.
EOF
)"
```

---
## Self-Review

1. Finding coverage: Finding #1 → Task 3. #2 → Task 1. #3 → Task 4. #4 → Task 2 (Steps
6-7). #5 → Task 5. #6 → Task 2 (Step 5). All 6 covered.

2. Placeholder scan: No TBD/TODO markers; every step has literal before/after code, not a
description of intent.

3. Type/name consistency: resolveJunctionRoomId and countOverlappingRoomRows are named
and called identically everywhere they're referenced across Tasks 1-3. currentServiceObj and
isCoupleService are the two names used for "the looked-up service object with is_couple" in
BookingActionModal.jsx and calendar/index.jsx respectively — kept distinct because they're
genuinely different variables in different files (one is a useMemo on booking.serviceId, the
other a plain derived const on serviceId state); not a naming bug.

## Verification (after all 6 tasks)

- npm run build and npm test clean (checked after every task above).
- Manually re-run the 3 SQL transaction tests from the original migration-171 verification
(rolled back, no persisted data) against staging to confirm the DB side is untouched by this
plan (it is — no migration changes here, JS/UI only).
- In the app: reproduce finding #2 (assign 2 therapists to a couple-service booking with a
companion room override, then remove the original primary) — confirm the promoted therapist no
longer carries the stale override.
- Reproduce finding #3 (select a couple service + 2 therapists + set a companion room, then
switch the service dropdown to a non-couple service before submitting) — confirm no companion
data reaches the created booking (check bookings.companion_name is null and
booking_therapists.room_id is null for both rows).
- Attempt to trigger finding #4's old gap (book a room right at capacity via an override, then
immediately try to book a second booking into that same room as its primary room at an
overlapping time) — confirm the JS pre-check now blocks it with a friendly ROOM_FULL error
instead of letting it through to the DB trigger.
