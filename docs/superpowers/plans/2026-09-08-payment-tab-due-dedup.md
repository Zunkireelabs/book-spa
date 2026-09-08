# Payment Tab Previous-Due Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Payment tab's Grand Total from double-counting a booking that's returned by both the "Related Services" query and the "Previous Due" query — which happens for every real `booking_group_id` sibling, since an unpaid group sibling always satisfies both queries' independent match criteria.

**Architecture:** Extract a small pure dedup function, `excludeRelatedFromPreviousDue(previousDue, related)`, into `src/services/bookingTransformers.js` (this repo's existing home for small pure booking-data helpers — same role `therapistBranchWindow.js` plays for transfer-window logic). `BookingActionModal.jsx`'s payment-tab effect calls it once both underlying fetches (`fetchRelatedUnpaidBookings`, `getCustomerOutstandingBalance`) have resolved, so the "Previous Due" list — and therefore the Grand Total, and the array handed to `PaymentModal.jsx` — never contains a booking already shown under "Related Services".

**Tech Stack:** React 18 + Vite, Supabase JS client, Vitest (`npm test` = `vitest run`).

**Spec:** No separate spec doc — self-contained; root cause fully documented below from direct investigation of the live bug (booking `BK-20260908-0011` counted twice in `BK-20260908-0012`'s Payment tab, Grand Total showed NPR 12,600 for what should be NPR 8,400 / 2 services).

## Global Constraints

- `npm run build` must pass with zero errors after every task.
- `npm test` (vitest) must pass after Task 1.
- Do not modify `PaymentModal.jsx` — it just sums whatever `additionalBookings` array it's given; deduplicating the source array in `BookingActionModal.jsx` fixes both the inline Grand Total there AND `PaymentModal.jsx`'s own total for free, since both fetches to `previousDueBookings` state.
- Do not change `fetchRelatedUnpaidBookings()` or `getCustomerOutstandingBalance()` (`src/services/api.js`) — both queries are individually correct for their own stated purpose (name+date match vs. phone-wide match); the bug is the missing cross-check between their two results, not either query itself.
- `fetchRelatedUnpaidBookings` returns raw rows keyed by `.id`; `getCustomerOutstandingBalance` returns transformed objects keyed by `.bookingId` — both refer to the same underlying `bookings.id` UUID. The dedup function must bridge this field-name difference explicitly (not assume both use the same key).
- No database changes — both bookings in the triggering incident are genuinely real, distinct, unpaid rows; this is a pure UI/calculation bug.
- Preserve existing behavior for the case this must NOT break: a customer with a real, separate previous-due booking (different day, not part of any current related group) must still show it under "Previous Due" — the fix removes only the overlap with "Related Services", not previous-due bookings in general.

---

## Task 1: `excludeRelatedFromPreviousDue()` in `bookingTransformers.js`

**Files:**
- Modify: `src/services/bookingTransformers.js` (add new exported function)
- Test: `src/services/bookingTransformers.test.js` (new file — this module has no existing test file)

**Interfaces:**
- Produces: `excludeRelatedFromPreviousDue(previousDue: Array, related: Array) => Array` — returns a new array containing only the `previousDue` entries whose `.bookingId` does NOT match any `related` entry's `.id`. Order of surviving entries preserved. Null/undefined inputs treated as empty arrays (matches this codebase's existing `(x || [])` convention, e.g. `fetchRelatedUnpaidBookings`'s own `return { data: data || [], error: null }` pattern in `api.js`).

- [ ] **Step 1: Write the failing tests**

Create `src/services/bookingTransformers.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { excludeRelatedFromPreviousDue } from './bookingTransformers';

describe('excludeRelatedFromPreviousDue', () => {
  it('removes a previousDue booking whose bookingId matches a related booking id', () => {
    const previousDue = [
      { bookingId: 'booking-0011', bookingNumber: 'BK-20260908-0011', amountDue: 4200 },
    ];
    const related = [
      { id: 'booking-0011', booking_number: 'BK-20260908-0011', base_amount: 4200 },
    ];
    expect(excludeRelatedFromPreviousDue(previousDue, related)).toEqual([]);
  });

  it('keeps a previousDue booking that has no matching related booking (genuine separate due)', () => {
    const previousDue = [
      { bookingId: 'booking-old-01', bookingNumber: 'BK-20260801-0003', amountDue: 1500 },
    ];
    const related = [
      { id: 'booking-0011', booking_number: 'BK-20260908-0011', base_amount: 4200 },
    ];
    expect(excludeRelatedFromPreviousDue(previousDue, related)).toEqual(previousDue);
  });

  it('only removes the overlapping entry, keeping the rest, when previousDue has a mix', () => {
    const previousDue = [
      { bookingId: 'booking-0011', bookingNumber: 'BK-20260908-0011', amountDue: 4200 },
      { bookingId: 'booking-old-01', bookingNumber: 'BK-20260801-0003', amountDue: 1500 },
    ];
    const related = [
      { id: 'booking-0011', booking_number: 'BK-20260908-0011', base_amount: 4200 },
    ];
    expect(excludeRelatedFromPreviousDue(previousDue, related)).toEqual([
      { bookingId: 'booking-old-01', bookingNumber: 'BK-20260801-0003', amountDue: 1500 },
    ]);
  });

  it('returns an empty array when previousDue is empty', () => {
    const related = [{ id: 'booking-0011' }];
    expect(excludeRelatedFromPreviousDue([], related)).toEqual([]);
  });

  it('returns the full previousDue array when related is empty', () => {
    const previousDue = [{ bookingId: 'booking-old-01', amountDue: 1500 }];
    expect(excludeRelatedFromPreviousDue(previousDue, [])).toEqual(previousDue);
  });

  it('treats null/undefined inputs as empty arrays', () => {
    expect(excludeRelatedFromPreviousDue(null, null)).toEqual([]);
    expect(excludeRelatedFromPreviousDue(undefined, undefined)).toEqual([]);
    const previousDue = [{ bookingId: 'booking-old-01', amountDue: 1500 }];
    expect(excludeRelatedFromPreviousDue(previousDue, null)).toEqual(previousDue);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/services/bookingTransformers.test.js`
Expected: FAIL — `excludeRelatedFromPreviousDue is not a function` (or an import error), since it doesn't exist yet.

- [ ] **Step 3: Implement `excludeRelatedFromPreviousDue`**

Add to `src/services/bookingTransformers.js` (near the other small exported helpers, e.g. after `toDbStatus`):

```js
/**
 * Removes bookings from `previousDue` (getCustomerOutstandingBalance's result shape, keyed by
 * `.bookingId`) that are already present in `related` (fetchRelatedUnpaidBookings's raw-row
 * result shape, keyed by `.id`) — both key names refer to the same underlying bookings.id UUID.
 *
 * Why this exists: BookingActionModal.jsx's Payment tab independently fetches "Related
 * Services" (matched by customer name + exact date) and "Previous Due" (matched by phone,
 * across all dates). A real booking_group_id sibling that's unpaid always satisfies BOTH
 * queries' criteria, so without this dedup it gets listed — and summed into the Grand Total —
 * twice.
 *
 * @param {Array} previousDue - getCustomerOutstandingBalance()'s `data.bookings` array.
 * @param {Array} related - fetchRelatedUnpaidBookings()'s `data` array.
 * @returns {Array} previousDue entries whose bookingId doesn't appear in related, order preserved.
 */
export function excludeRelatedFromPreviousDue(previousDue, related) {
  const relatedIds = new Set((related || []).map(r => r.id));
  return (previousDue || []).filter(pd => !relatedIds.has(pd.bookingId));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/services/bookingTransformers.test.js`
Expected: PASS — all 6 new tests green.

- [ ] **Step 5: Commit**

```bash
git add src/services/bookingTransformers.js src/services/bookingTransformers.test.js
git commit -m "feat(booking): add excludeRelatedFromPreviousDue for Payment tab dedup"
```

---

## Task 2: Wire the dedup into `BookingActionModal.jsx`'s payment-tab effect

**Files:**
- Modify: `src/components/ui/BookingActionModal.jsx` — the payment-tab data-fetch effect (currently ~lines 170-203; grep `fetchRelatedUnpaidBookings` to find it — it's the effect immediately after the `setNewBookingSubmitting(false)` cleanup effect)

**Interfaces:**
- Consumes: `excludeRelatedFromPreviousDue(previousDue, related)` from Task 1 (`src/services/bookingTransformers.js`) — already imported in this file (it already imports `transformMembership, transformMemberships, toTitleCase` from the same module per `api.js`'s import line; confirm `BookingActionModal.jsx`'s own import line for `bookingTransformers` and add to it, or add a new import line if this file doesn't already import from that module — check before assuming).
- Produces: no new exports — only changes what feeds the existing `relatedBookings`/`previousDueBookings` state and therefore `combinedTotal`/`selectedCount` (unchanged variable names, unchanged downstream JSX and `PaymentModal.jsx` props).

This is a live-Supabase-integration change inside a large React component effect — not unit-testable the way Task 1 is (matches this codebase's existing pattern: no component-level tests exist for `BookingActionModal.jsx`). Verify via `npm run build` plus the manual check in Step 3.

- [ ] **Step 1: Replace the payment-tab fetch effect**

Find this exact block (the effect fetching `relatedBookings` and `previousDueBookings` — the two `fetchRelatedUnpaidBookings`/`getCustomerOutstandingBalance` calls currently run as two independent, unchained `.then()`s):

```js
  // Fetch related unpaid bookings when payment tab opens
  useEffect(() => {
    if ((activeTab === 'payment' || activeTab === 'discount') && booking) {
      fetchRelatedUnpaidBookings({
        customerName: booking.customerName,
        date: booking.date,
        excludeBookingId: booking.bookingId,
      }).then(result => {
        setRelatedBookings(result.data || []);
        setSelectedDiscountIds(new Set([booking.bookingId]));
        setSelectedApprover('');
        setDiscountSuccess(false);
        setRowDiscountOverrides({});
      });
    }
    if (activeTab === 'payment' && booking?.customerPhone) {
      getCustomerOutstandingBalance({
        customerPhone: booking.customerPhone,
        branchId,
        excludeBookingId: booking.bookingId,
      }).then(result => {
        const bookings = result.data?.bookings || [];
        setPreviousDueBookings(bookings);
        // Auto-bundled by default — staff can uncheck individual items.
        setSelectedPreviousDueIds(new Set(bookings.map(b => b.bookingId)));
      }).catch(err => {
        console.error('[BookingActionModal] getCustomerOutstandingBalance failed:', err.message);
        setPreviousDueBookings([]);
        setSelectedPreviousDueIds(new Set());
      });
    } else if (activeTab === 'payment') {
      setPreviousDueBookings([]);
      setSelectedPreviousDueIds(new Set());
    }
```

Replace it with (note: everything AFTER this block in the same effect — any further `if (activeTab === 'payment' && booking?.bookingId) { ... }` code that follows — is untouched, leave it exactly as-is below this replacement):

```js
  // Fetch related unpaid bookings when payment tab opens
  useEffect(() => {
    if ((activeTab === 'payment' || activeTab === 'discount') && booking) {
      const relatedPromise = fetchRelatedUnpaidBookings({
        customerName: booking.customerName,
        date: booking.date,
        excludeBookingId: booking.bookingId,
      });
      const duePromise = (activeTab === 'payment' && booking?.customerPhone)
        ? getCustomerOutstandingBalance({
            customerPhone: booking.customerPhone,
            branchId,
            excludeBookingId: booking.bookingId,
          })
        : Promise.resolve({ data: { bookings: [] } });

      Promise.all([relatedPromise, duePromise]).then(([relatedResult, dueResult]) => {
        const related = relatedResult.data || [];
        setRelatedBookings(related);
        setSelectedDiscountIds(new Set([booking.bookingId]));
        setSelectedApprover('');
        setDiscountSuccess(false);
        setRowDiscountOverrides({});

        if (activeTab === 'payment') {
          // Exclude any booking already shown under "Related Services" — a real
          // booking_group_id sibling that's unpaid always also matches
          // getCustomerOutstandingBalance's phone-wide criteria, so without this it would be
          // double-counted in the Grand Total (see BK-20260908-0011/-0012 incident).
          const bookings = excludeRelatedFromPreviousDue(dueResult.data?.bookings, related);
          setPreviousDueBookings(bookings);
          // Auto-bundled by default — staff can uncheck individual items.
          setSelectedPreviousDueIds(new Set(bookings.map(b => b.bookingId)));
        }
      }).catch(err => {
        console.error('[BookingActionModal] related/previous-due bookings fetch failed:', err.message);
        if (activeTab === 'payment') {
          setPreviousDueBookings([]);
          setSelectedPreviousDueIds(new Set());
        }
      });
    } else if (activeTab === 'payment') {
      setPreviousDueBookings([]);
      setSelectedPreviousDueIds(new Set());
    }
```

- [ ] **Step 2: Add/update the import**

Check `BookingActionModal.jsx`'s existing import from `../../services/bookingTransformers` (or equivalent relative path — confirm exact path used in this file, it may differ from `api.js`'s `./bookingTransformers` since it's one directory deeper). Add `excludeRelatedFromPreviousDue` to that import line. If this file has no existing import from that module, add a new one: `import { excludeRelatedFromPreviousDue } from '../../services/bookingTransformers';` (adjust the relative path to match this file's actual location relative to `src/services/`).

- [ ] **Step 3: Run the build, then manually verify**

Run: `npm run build`
Expected: succeeds with zero errors.

Manual check (dev server, `npm start`): open `BK-20260908-0012` in the Nuad Thai Spa Sanepa branch dashboard (or any booking with a real, still-unpaid `booking_group_id` sibling), go to the Payment tab, and confirm:
1. "Related Services (1)" still lists the sibling booking.
2. "Previous Due for Jubin" no longer repeats it.
3. Grand Total reads **NPR 8,400 (2 services)**, not NPR 12,600 (3 services).
4. If a customer has both a related-group sibling AND a genuinely separate unpaid booking from a different day, confirm both still show correctly (only the overlap is removed, not previous-due bookings in general) — the Task 1 test "keeps a previousDue booking that has no matching related booking" already covers this at the unit level, but do one real-data spot check since Task 2 itself has no automated coverage.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/BookingActionModal.jsx
git commit -m "fix(booking): dedupe Payment tab Previous Due against Related Services"
```

---

## Self-Review Notes

- **Spec coverage**: pure dedup logic (Task 1, fully tested) and its live wiring (Task 2, build + manual verification) are both covered. `PaymentModal.jsx` deliberately untouched per Global Constraints — it inherits the fix automatically since it consumes the now-deduplicated `previousDueBookings` state.
- **Placeholder scan**: no TBD/TODO; every step has complete code.
- **Type consistency**: `excludeRelatedFromPreviousDue`'s parameter/field names (`previousDue[].bookingId`, `related[].id`) match exactly what `getCustomerOutstandingBalance()` and `fetchRelatedUnpaidBookings()` actually return (verified against their live source in `src/services/api.js` during investigation, not assumed) — no mismatch between what Task 1's tests use and what Task 2 actually passes in.
