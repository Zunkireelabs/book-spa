import { describe, it, expect } from 'vitest';
import { computeTherapistBranchAt, toKathmanduDate, isAfterCheckout, resolveOrphanTransferWindow } from './therapistBranchWindow';

const BRANCH_A = 'branch-a';
const BRANCH_B = 'branch-b';
const BRANCH_C = 'branch-c';

function temp({ from, to, effective_date, start_time, revert_at }) {
  return {
    from_branch_id: from,
    to_branch_id: to,
    is_permanent: false,
    is_return_leg: false,
    effective_date,
    start_time,
    revert_at,
    transferred_at: `${effective_date}T${start_time}+05:45`,
  };
}

function permanent({ from, to, effective_date, start_time }) {
  return {
    from_branch_id: from,
    to_branch_id: to,
    is_permanent: true,
    effective_date,
    start_time,
    revert_at: null,
  };
}

describe('computeTherapistBranchAt', () => {
  it('returns the fallback (current) branch when there is no transfer history', () => {
    const at = toKathmanduDate('2026-09-10', '10:00:00');
    expect(computeTherapistBranchAt([], BRANCH_A, at)).toBe(BRANCH_A);
  });

  it('keeps the therapist at the origin branch before a temporary transfer starts', () => {
    const transfers = [
      temp({ from: BRANCH_A, to: BRANCH_B, effective_date: '2026-09-10', start_time: '09:00:00', revert_at: '2026-09-10T12:00:00+05:45' }),
    ];
    const before = toKathmanduDate('2026-09-10', '08:00:00');
    expect(computeTherapistBranchAt(transfers, BRANCH_A, before)).toBe(BRANCH_A);
  });

  it('places the therapist at the destination branch DURING the temporary window', () => {
    const transfers = [
      temp({ from: BRANCH_A, to: BRANCH_B, effective_date: '2026-09-10', start_time: '09:00:00', revert_at: '2026-09-10T12:00:00+05:45' }),
    ];
    const during = toKathmanduDate('2026-09-10', '10:00:00');
    expect(computeTherapistBranchAt(transfers, BRANCH_A, during)).toBe(BRANCH_B);
  });

  it('returns the therapist to the origin branch AFTER the temporary window closes', () => {
    const transfers = [
      temp({ from: BRANCH_A, to: BRANCH_B, effective_date: '2026-09-10', start_time: '09:00:00', revert_at: '2026-09-10T12:00:00+05:45' }),
    ];
    const after = toKathmanduDate('2026-09-10', '14:00:00');
    expect(computeTherapistBranchAt(transfers, BRANCH_A, after)).toBe(BRANCH_A);
  });

  it('keeps the therapist at the current branch until a SCHEDULED future temporary transfer starts, even though branch_id has not flipped yet', () => {
    const transfers = [
      temp({ from: BRANCH_A, to: BRANCH_B, effective_date: '2026-09-20', start_time: '09:00:00', revert_at: '2026-09-20T17:00:00+05:45' }),
    ];
    // Booking is dated between "now" and the transfer's start — still at origin.
    const beforeFutureWindow = toKathmanduDate('2026-09-15', '10:00:00');
    expect(computeTherapistBranchAt(transfers, BRANCH_A, beforeFutureWindow)).toBe(BRANCH_A);

    // Booking dated inside the future window should resolve to the destination branch
    // even though branch_id is still BRANCH_A right now (cron hasn't applied it yet).
    const insideFutureWindow = toKathmanduDate('2026-09-20', '12:00:00');
    expect(computeTherapistBranchAt(transfers, BRANCH_A, insideFutureWindow)).toBe(BRANCH_B);
  });

  it('moves the therapist permanently after a permanent transfer takes effect, and keeps them there', () => {
    const transfers = [
      permanent({ from: BRANCH_A, to: BRANCH_B, effective_date: '2026-09-10', start_time: '09:00:00' }),
    ];
    const before = toKathmanduDate('2026-09-09', '10:00:00');
    const after = toKathmanduDate('2026-09-11', '10:00:00');
    expect(computeTherapistBranchAt(transfers, BRANCH_A, before)).toBe(BRANCH_A);
    expect(computeTherapistBranchAt(transfers, BRANCH_A, after)).toBe(BRANCH_B);
  });

  it('allows legitimate SEQUENTIAL transfers: A -> B (completed) -> C (later), each window resolves independently', () => {
    const transfers = [
      // First loan: A -> B, already completed/reverted.
      temp({ from: BRANCH_A, to: BRANCH_B, effective_date: '2026-09-01', start_time: '09:00:00', revert_at: '2026-09-01T17:00:00+05:45' }),
      // Second, later loan: A -> C, scheduled after the first one closed.
      temp({ from: BRANCH_A, to: BRANCH_C, effective_date: '2026-09-15', start_time: '09:00:00', revert_at: '2026-09-15T17:00:00+05:45' }),
    ];

    // Inside the first (already-completed) window.
    expect(computeTherapistBranchAt(transfers, BRANCH_A, toKathmanduDate('2026-09-01', '10:00:00'))).toBe(BRANCH_B);
    // Between the two transfers: back home.
    expect(computeTherapistBranchAt(transfers, BRANCH_A, toKathmanduDate('2026-09-05', '10:00:00'))).toBe(BRANCH_A);
    // Inside the second window.
    expect(computeTherapistBranchAt(transfers, BRANCH_A, toKathmanduDate('2026-09-15', '10:00:00'))).toBe(BRANCH_C);
    // After the second window closes: back home again.
    expect(computeTherapistBranchAt(transfers, BRANCH_A, toKathmanduDate('2026-09-16', '10:00:00'))).toBe(BRANCH_A);
  });

  it('treats a returned-history row (temporary, no revert_at) as open-ended toward its toBranchId — covers apply_due_staff_reverts()/revert_staff_transfer_now() writing a completion row with revert_at left null', () => {
    const transfers = [
      // Original loan: A -> B, scheduled to revert at 12:00.
      temp({ from: BRANCH_A, to: BRANCH_B, effective_date: '2026-09-10', start_time: '09:00:00', revert_at: '2026-09-10T12:00:00+05:45' }),
      // System-generated "returned early" completion row: B -> A, no revert_at (not a
      // real temporary window — a point-in-time, indefinite move back).
      temp({ from: BRANCH_B, to: BRANCH_A, effective_date: '2026-09-10', start_time: '10:30:00', revert_at: null }),
    ];

    // Right after the early return, still before the ORIGINAL scheduled revert_at (12:00) —
    // must already be back home, not stuck at the destination until 12:00.
    expect(computeTherapistBranchAt(transfers, BRANCH_A, toKathmanduDate('2026-09-10', '11:00:00'))).toBe(BRANCH_A);
    // Well after, on a later date — still home.
    expect(computeTherapistBranchAt(transfers, BRANCH_A, toKathmanduDate('2026-09-15', '09:00:00'))).toBe(BRANCH_A);
  });

  it('treats a non-permanent transfer with no revert_at as indefinite, not already-closed (legacy pre-migration-145 rows)', () => {
    // Every transfer made before migration-145 added start_time/duration/revert_at
    // has is_permanent=false (the column's default) but no revert mechanism at all —
    // it's permanent in effect, matching the therapist's live therapists.branch_id.
    const transfers = [
      temp({ from: BRANCH_A, to: BRANCH_B, effective_date: '2026-09-02', start_time: null, revert_at: null }),
    ];
    const before = toKathmanduDate('2026-09-01', '10:00:00');
    const after = toKathmanduDate('2026-09-04', '13:30:00');
    expect(computeTherapistBranchAt(transfers, BRANCH_A, before)).toBe(BRANCH_A);
    expect(computeTherapistBranchAt(transfers, BRANCH_A, after)).toBe(BRANCH_B);
  });

  it('resolves a legacy indefinite transfer followed by a genuine later temporary transfer', () => {
    const transfers = [
      temp({ from: BRANCH_A, to: BRANCH_B, effective_date: '2026-09-02', start_time: null, revert_at: null }),
      temp({ from: BRANCH_B, to: BRANCH_C, effective_date: '2026-09-10', start_time: '09:00:00', revert_at: '2026-09-10T17:00:00+05:45' }),
    ];
    expect(computeTherapistBranchAt(transfers, BRANCH_A, toKathmanduDate('2026-09-05', '10:00:00'))).toBe(BRANCH_B);
    expect(computeTherapistBranchAt(transfers, BRANCH_A, toKathmanduDate('2026-09-10', '12:00:00'))).toBe(BRANCH_C);
    expect(computeTherapistBranchAt(transfers, BRANCH_A, toKathmanduDate('2026-09-11', '10:00:00'))).toBe(BRANCH_B);
  });

  it('handles a permanent transfer followed later by a temporary one from the new home branch', () => {
    const transfers = [
      permanent({ from: BRANCH_A, to: BRANCH_B, effective_date: '2026-09-01', start_time: '00:00:00' }),
      temp({ from: BRANCH_B, to: BRANCH_C, effective_date: '2026-09-10', start_time: '09:00:00', revert_at: '2026-09-10T17:00:00+05:45' }),
    ];

    expect(computeTherapistBranchAt(transfers, BRANCH_A, toKathmanduDate('2026-09-05', '10:00:00'))).toBe(BRANCH_B);
    expect(computeTherapistBranchAt(transfers, BRANCH_A, toKathmanduDate('2026-09-10', '12:00:00'))).toBe(BRANCH_C);
    expect(computeTherapistBranchAt(transfers, BRANCH_A, toKathmanduDate('2026-09-11', '10:00:00'))).toBe(BRANCH_B);
  });
});

describe('isAfterCheckout', () => {
  it('is false when the therapist has not checked out at all', () => {
    expect(isAfterCheckout(null, '2026-09-10', '17:30')).toBe(false);
    expect(isAfterCheckout(undefined, '2026-09-10', '17:30')).toBe(false);
  });

  it('is false for a booking time before the check-out time', () => {
    const checkOutTime = '2026-09-10T17:00:00+05:45';
    expect(isAfterCheckout(checkOutTime, '2026-09-10', '16:30')).toBe(false);
  });

  it('is true for a booking time at or after the check-out time', () => {
    const checkOutTime = '2026-09-10T17:00:00+05:45';
    expect(isAfterCheckout(checkOutTime, '2026-09-10', '17:00')).toBe(true);
    expect(isAfterCheckout(checkOutTime, '2026-09-10', '18:00')).toBe(true);
  });

  it('is false for the same clock time on a different (earlier) date than the check-out', () => {
    // Guards against comparing time-of-day only and ignoring the date.
    const checkOutTime = '2026-09-10T17:00:00+05:45';
    expect(isAfterCheckout(checkOutTime, '2026-09-09', '18:00')).toBe(false);
  });
});

describe('resolveOrphanTransferWindow', () => {
  it('returns a transferredIn window when branchId is the destination', () => {
    const transfers = [
      temp({ from: BRANCH_A, to: BRANCH_B, effective_date: '2026-09-06', start_time: '16:30:00', revert_at: '2026-09-06T18:30:00+05:45' }),
    ];
    expect(resolveOrphanTransferWindow(transfers, BRANCH_B)).toEqual({
      transferredIn: true,
      returnsAt: '2026-09-06T18:30:00+05:45',
      transferStartAt: '2026-09-06T16:30:00+05:45',
      fromBranch: null,
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
      fromBranch: null,
    });
  });

  it('picks the most recently transferred_at row when more than one matches (no range supplied)', () => {
    const transfers = [
      { from_branch_id: BRANCH_A, to_branch_id: BRANCH_B, is_permanent: false, is_return_leg: false, revert_at: '2026-09-06T17:00:00+05:45', effective_date: '2026-09-06', start_time: '15:00:00', transferred_at: '2026-09-06T14:00:00+05:45' },
      { from_branch_id: BRANCH_A, to_branch_id: BRANCH_B, is_permanent: false, is_return_leg: false, revert_at: '2026-09-06T18:30:00+05:45', effective_date: '2026-09-06', start_time: '16:30:00', transferred_at: '2026-09-06T16:10:00+05:45' },
    ];
    expect(resolveOrphanTransferWindow(transfers, BRANCH_B)).toEqual({
      transferredIn: true,
      returnsAt: '2026-09-06T18:30:00+05:45',
      transferStartAt: '2026-09-06T16:30:00+05:45',
      fromBranch: null,
    });
  });

  it('returns null for a window that ended before the requested range (stale window, not adopted)', () => {
    // Real transfer that happened and fully closed on 2026-09-01 — the calendar is now
    // being rendered for 2026-09-06. Adopting this window would make the Calendar's
    // ghost-column filter (calendar/index.jsx) drop the orphan column entirely, since its
    // returnsAt date (09-01) is already before the day being viewed (09-06) — exactly the
    // "booking vanishes into Unassigned" regression this range-awareness prevents.
    const transfers = [
      temp({ from: BRANCH_B, to: BRANCH_A, effective_date: '2026-09-01', start_time: '10:00:00', revert_at: '2026-09-01T12:00:00+05:45' }),
    ];
    const rangeStart = toKathmanduDate('2026-09-06', '00:00:00');
    const rangeEnd = toKathmanduDate('2026-09-06', '23:59:59');
    expect(resolveOrphanTransferWindow(transfers, BRANCH_A, rangeStart, rangeEnd)).toBeNull();
  });

  it('picks the window overlapping the requested range over a more-recently-created non-overlapping one', () => {
    const transfers = [
      // Overlaps the viewed day (09-06) — this is the one that should win.
      temp({ from: BRANCH_A, to: BRANCH_B, effective_date: '2026-09-06', start_time: '16:30:00', revert_at: '2026-09-06T18:30:00+05:45' }),
      // Created later (transferred_at 09-10 > 09-06), but its OWN window is a future day
      // that does not overlap the range being rendered — must lose despite being "more recent."
      temp({ from: BRANCH_A, to: BRANCH_B, effective_date: '2026-09-10', start_time: '09:00:00', revert_at: '2026-09-10T11:00:00+05:45' }),
    ];
    const rangeStart = toKathmanduDate('2026-09-06', '00:00:00');
    const rangeEnd = toKathmanduDate('2026-09-06', '23:59:59');
    expect(resolveOrphanTransferWindow(transfers, BRANCH_B, rangeStart, rangeEnd)).toEqual({
      transferredIn: true,
      returnsAt: '2026-09-06T18:30:00+05:45',
      transferStartAt: '2026-09-06T16:30:00+05:45',
      fromBranch: null,
    });
  });
});
