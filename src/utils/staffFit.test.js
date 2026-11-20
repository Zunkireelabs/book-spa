import { describe, it, expect } from 'vitest';
import { staffPickIncomplete, arrangeByTime, staffDayRanges, rangeLabel, pillRange, offStaffReasons } from './staffFit';

const P = (id, name) => ({ id, name });
const people = [P('a', 'Asha'), P('b', 'Bishnu'), P('c', 'Chhori'), P('d', 'Dil')];
const bk = (id, th, s, e, extra = {}) => ({ id, date: '2026-11-20', status: 'Confirmed', therapist_id: th, start_time: s, end_time: e, ...extra });

describe('staffDayRanges', () => {
  it('collects active bookings of the day per person, skipping excluded and cancelled', () => {
    const r = staffDayRanges([
      bk('1', 'a', '13:00:00', '14:00:00'),
      bk('2', 'a', '15:00:00', '16:00:00', { status: 'Cancelled' }),
      bk('3', 'b', '13:00:00', '14:00:00', { id: 'self' }),
      bk('4', 'c', '09:00:00', '10:00:00', { therapist_id: null, booking_therapists: [{ therapist_id: 'c' }, { therapist_id: 'd' }] }),
      { ...bk('5', 'a', '13:00:00', '14:00:00'), date: '2026-11-21' },
    ], { date: '2026-11-20', excludeBookingId: 'self' });
    expect(r.a).toEqual([{ start: 780, end: 840 }]);
    expect(r.b).toBeUndefined();
    expect(Object.keys(r).sort()).toEqual(['a', 'c', 'd']);
  });
});

describe('arrangeByTime', () => {
  const slot = { slotStart: 14 * 60, slotEnd: 15 * 60 };
  it('splits free / busy / off; busy keeps its overlapping range', () => {
    const r = arrangeByTime(people, { ...slot, rangesById: { a: [{ start: 810, end: 870 }] }, offById: { d: 'On leave' } });
    expect(r.free.map((x) => x.person.id)).toEqual(['b', 'c']);
    expect(r.busy[0].person.id).toBe('a');
    expect(r.busy[0].busyRange).toEqual({ start: 810, end: 870 });
    expect(r.off[0].reason).toBe('On leave');
  });
  it('back-to-back is not busy', () => {
    const r = arrangeByTime(people, { ...slot, rangesById: { a: [{ start: 780, end: 840 }] } });
    expect(r.busy).toHaveLength(0);
  });
  it('best fit: fewest booked minutes, then last person, then A-Z; only eligible; at most max', () => {
    const rangesById = { a: [{ start: 540, end: 660 }], b: [{ start: 540, end: 570 }], c: [{ start: 540, end: 570 }] };
    expect(arrangeByTime(people, { ...slot, rangesById }).bestIds).toEqual(['d']);
    expect(arrangeByTime(people, { ...slot, rangesById, max: 2 }).bestIds).toEqual(['d', 'b']);
    expect(arrangeByTime(people, { ...slot, rangesById, max: 2, lastStaffId: 'c' }).bestIds).toEqual(['d', 'c']);
    expect(arrangeByTime(people, { ...slot, rangesById, max: 2, eligibleIds: ['a', 'c'] }).bestIds).toEqual(['c', 'a']);
  });
  it('someone who cannot do the service is never best fit and sorts below', () => {
    const r = arrangeByTime(people, { ...slot, eligibleIds: ['c'], max: 2 });
    expect(r.bestIds).toEqual(['c']);
    expect(r.free[0].person.id).toBe('c');
  });
  it('nobody free -> no best fit, noneFree', () => {
    const all = { a: [{ start: 840, end: 900 }], b: [{ start: 840, end: 900 }], c: [{ start: 840, end: 900 }], d: [{ start: 840, end: 900 }] };
    const r = arrangeByTime(people, { ...slot, rangesById: all });
    expect(r.noneFree).toBe(true);
    expect(r.bestIds).toEqual([]);
  });
  it('off people are never best fit', () => {
    const r = arrangeByTime(people, { ...slot, offById: { a: 'Off today', b: 'Off today', c: 'Off today' } });
    expect(r.bestIds).toEqual(['d']);
  });
});

describe('labels and off reasons', () => {
  it('formats ranges', () => {
    expect(rangeLabel(13 * 60 + 15, 14 * 60)).toBe('1:15–2pm');
    expect(rangeLabel(11 * 60 + 30, 12 * 60 + 15)).toBe('11:30am–12:15pm');
    expect(pillRange(13 * 60, 14 * 60 + 30)).toBe('1–2:30');
  });
  it('offStaffReasons reads attendance and roster day-off', () => {
    const r = offStaffReasons(people, { attendanceMap: { a: 'Leave', b: 'Absent' }, shiftsByTherapist: { c: { d1: { works: false, source: 'weekly' } }, d: { d1: { works: false, source: 'none' } } }, date: 'd1' });
    expect(r).toEqual({ a: 'On leave', b: 'Off today', c: 'Off today' });
  });
});

describe('staffPickIncomplete', () => {
  it('couple + staff required needs 2 picks when assigning', () => {
    expect([0, 1, 2].map((count) => staffPickIncomplete({ isCouple: true, count }))).toEqual([true, true, false]);
  });
  it('couple on New booking: 0 ok, 1 incomplete, 2 ok', () => {
    expect([0, 1, 2].map((count) => staffPickIncomplete({ isCouple: true, count, zeroOk: true }))).toEqual([false, true, false]);
  });
  it('single service: assigning needs 1, New booking needs none', () => {
    expect([0, 1].map((count) => staffPickIncomplete({ count }))).toEqual([true, false]);
    expect([0, 1].map((count) => staffPickIncomplete({ count, zeroOk: true }))).toEqual([false, false]);
  });
  it('staff optional: no rule applies', () => {
    expect(staffPickIncomplete({ isCouple: true, optional: true, count: 1 })).toBe(false);
    expect(staffPickIncomplete({ optional: true, count: 0 })).toBe(false);
  });
});
