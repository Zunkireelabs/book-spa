import { describe, it, expect } from 'vitest';
import { computeTherapistBranchAt, toKathmanduDate, isAfterCheckout } from './therapistBranchWindow';

const BRANCH_A = 'branch-a';
const BRANCH_B = 'branch-b';
const BRANCH_C = 'branch-c';

function temp({ from, to, effective_date, start_time, revert_at }) {
  return {
    from_branch_id: from,
    to_branch_id: to,
    is_permanent: false,
    effective_date,
    start_time,
    revert_at,
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
