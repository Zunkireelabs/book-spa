import { describe, it, expect } from 'vitest';
import { resolveJunctionRoomId, countOverlappingRoomRows } from './roomOverrideHelpers';

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
