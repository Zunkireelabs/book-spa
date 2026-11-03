import { describe, it, expect } from 'vitest';
import { buildOccupancy } from './availability';

// buildOccupancy's byBranch bucket backs the customer date-picker's branch online-capacity
// graying (migration-301). It must count exactly the rows the DB's
// check_branch_online_capacity() trigger counts — anonymous online bookings only — or the UI
// and the trigger disagree about which slots are bookable.
describe('buildOccupancy byBranch (online capacity)', () => {
  const row = (overrides) => ({
    booking_date: '2026-11-02',
    start_time: '10:00:00',
    duration_minutes: 60,
    room_id: 'room-1',
    therapist_gender: null,
    counts_as_online_capacity: false,
    ...overrides,
  });

  it('counts a flagged booking into every 30-min slot its duration spans', () => {
    const { byBranch } = buildOccupancy([row({ counts_as_online_capacity: true })]);
    const day = byBranch['2026-11-02'];
    expect(day.get(600)).toBe(1); // 10:00
    expect(day.get(630)).toBe(1); // 10:30
    expect(day.get(660)).toBeUndefined(); // 11:00 — booking has ended
  });

  it('ignores rows the DB did not flag (staff-created bookings, manual blocks)', () => {
    const { byBranch } = buildOccupancy([
      row({ counts_as_online_capacity: false }),
      row({ counts_as_online_capacity: null }),
    ]);
    expect(byBranch['2026-11-02']).toBeUndefined();
  });

  it('accumulates concurrent flagged bookings in the same slot', () => {
    const { byBranch } = buildOccupancy([
      row({ counts_as_online_capacity: true }),
      row({ counts_as_online_capacity: true, room_id: 'room-2' }),
    ]);
    expect(byBranch['2026-11-02'].get(600)).toBe(2);
  });

  it('aligns an off-grid start down to the 30-min grid, like byRoom does', () => {
    const { byBranch } = buildOccupancy([
      row({ start_time: '16:05:00', duration_minutes: 30, counts_as_online_capacity: true }),
    ]);
    const day = byBranch['2026-11-02'];
    expect(day.get(960)).toBe(1); // 16:00 slot, not 16:05
    expect(day.get(990)).toBe(1); // span runs to 16:35, so 16:30 is consumed too
  });

  it('keeps byBranch independent of byRoom/byGender counts', () => {
    const { byRoom, byGender, byBranch } = buildOccupancy([
      row({ therapist_gender: 'Female', counts_as_online_capacity: false }),
    ]);
    expect(byRoom['2026-11-02']['room-1'].get(600)).toBe(1);
    expect(byGender['2026-11-02'].get(600)).toEqual({ male: 0, female: 1 });
    expect(byBranch['2026-11-02']).toBeUndefined();
  });

  it('keeps separate per-date tallies', () => {
    const { byBranch } = buildOccupancy([
      row({ counts_as_online_capacity: true }),
      row({ booking_date: '2026-11-03', counts_as_online_capacity: true }),
    ]);
    expect(byBranch['2026-11-02'].get(600)).toBe(1);
    expect(byBranch['2026-11-03'].get(600)).toBe(1);
  });
});
