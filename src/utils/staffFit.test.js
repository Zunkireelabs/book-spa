import { describe, it, expect } from 'vitest';
import { staffPickIncomplete, arrangeByTime, staffDayRanges, rangeLabel, pillRange, offStaffReasons, offDayLabel, offReasonFor, staffHeldByOthers, pickedRowStatus } from './staffFit';

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

import { staffHeldByOthers, pickProblems, fillFreeStaff, undoFill } from './staffFit';

describe('group staff (ZNLY-303)', () => {
  const G = (idx, staffId, start = 840, end = 900, serviceId = 's') => ({ idx, staffId, start, end, serviceId });
  const people = [{ id: 'a', name: 'Asha' }, { id: 'b', name: 'Bina' }, { id: 'c', name: 'Cara' }];

  describe('staffHeldByOthers', () => {
    it('a person picked for one guest is held for every other overlapping guest', () => {
      expect(staffHeldByOthers([G(0, 'a'), G(1, ''), G(2, 'b')])).toEqual({ 0: { b: 2 }, 1: { a: 0, b: 2 }, 2: { a: 0 } });
    });
    it('non-overlapping guests may share a person', () => {
      expect(staffHeldByOthers([G(0, 'a', 840, 900), G(1, '', 900, 960)])).toEqual({ 0: {}, 1: {} });
    });
    it('a guest never holds a person against themselves', () => {
      expect(staffHeldByOthers([G(0, 'a')])[0]).toEqual({});
    });
  });

  describe('pickProblems', () => {
    const rangesById = { b: [{ start: 870, end: 930 }] };
    it('flags busy with the overlapping range, off, and the later guest of a same-person clash', () => {
      const p = pickProblems([G(0, 'a'), G(1, 'b'), G(2, 'c'), G(3, 'a')], { rangesById, offById: { c: 'Off today' } });
      expect(p[1]).toEqual({ kind: 'busy', staffId: 'b', range: { start: 870, end: 930 } });
      expect(p[2]).toMatchObject({ kind: 'off', staffId: 'c' });
      expect(p[3]).toEqual({ kind: 'clash', staffId: 'a', withIdx: 0 });
      expect(p[0]).toBeUndefined();
    });
    it('ignores guests without staff and a booking that ends when the slot starts', () => {
      expect(pickProblems([G(0, ''), G(1, 'a')], { rangesById: { a: [{ start: 780, end: 840 }] } })).toEqual({});
    });
    it('re-check: a pick that was free stops fitting when the booked range moves onto the slot', () => {
      const guests = [G(0, 'a')];
      expect(pickProblems(guests, { rangesById: {} })).toEqual({});
      expect(pickProblems(guests, { rangesById: { a: [{ start: 800, end: 860 }] } })[0].kind).toBe('busy');
    });
  });

  describe('fillFreeStaff + undoFill', () => {
    it('fills empty guests only, a different free person each, never Busy/Off, never a manual pick', () => {
      const r = fillFreeStaff([G(0, 'c'), G(1, ''), G(2, '')], { people, rangesById: {}, offById: {} });
      expect(r.picks).toEqual({ 1: 'a', 2: 'b' });
      expect(r.filled).toEqual([1, 2]);
      expect(r.unfilled).toEqual([]);
    });
    it('skips busy and off people and reports guests nobody is free for', () => {
      const r = fillFreeStaff([G(0, ''), G(1, ''), G(2, '')], { people, rangesById: { a: [{ start: 840, end: 900 }] }, offById: { b: 'Off today' } });
      expect(r.picks).toEqual({ 0: 'c' });
      expect(r.unfilled).toEqual([1, 2]);
    });
    it('Best fit (eligible, fewest booked minutes) goes first', () => {
      const r = fillFreeStaff([G(0, '')], { people, rangesById: { a: [{ start: 0, end: 60 }] }, eligibleByService: { s: ['a', 'b'] } });
      expect(r.picks).toEqual({ 0: 'b' });
    });
    it('Undo restores exactly what was empty and leaves later manual changes alone', () => {
      const r = fillFreeStaff([G(0, 'c'), G(1, ''), G(2, '')], { people });
      expect(undoFill({ 0: 'c', 1: 'a', 2: 'b' }, r.picks)).toEqual({ 0: 'c', 1: '', 2: '' });
      expect(undoFill({ 0: 'c', 1: 'a', 2: 'c' }, r.picks)).toEqual({ 0: 'c', 1: '', 2: 'c' });
    });
  });
});

describe('arrangeByTime excludeIds (Best fit only from pickable staff)', () => {
  const ppl = [{ id: 'a', name: 'Asha' }, { id: 'b', name: 'Bina' }];
  it('never tags an excluded person as best fit, the next free one gets it', () => {
    const r = arrangeByTime(ppl, { slotStart: 840, slotEnd: 900, excludeIds: new Set(['a']) });
    expect(r.bestIds).toEqual(['b']);
  });
  it('no best fit when every free person is excluded; busy/off are never best either', () => {
    expect(arrangeByTime(ppl, { slotStart: 840, slotEnd: 900, excludeIds: new Set(['a', 'b']) }).bestIds).toEqual([]);
    const r = arrangeByTime(ppl, { slotStart: 840, slotEnd: 900, rangesById: { a: [{ start: 850, end: 880 }] }, offById: { b: 'Off today' } });
    expect(r.bestIds).toEqual([]);
  });
});

describe('ZNLY-310 Off label follows the slot date', () => {
  it('keeps "Off today" for today, names the day otherwise', () => {
    expect(offDayLabel('2026-11-22', '2026-11-22')).toBe('Off today');
    expect(offDayLabel(undefined, '2026-11-22')).toBe('Off today');
    expect(offDayLabel('2026-11-23', '2026-11-22')).toBe('Off Mon 23 Nov');
  });
  it('rewrites only the "Off today" reason, never leave', () => {
    expect(offReasonFor('Off today', '2026-11-23', '2026-11-22')).toBe('Off Mon 23 Nov');
    expect(offReasonFor('On leave', '2026-11-23', '2026-11-22')).toBe('On leave');
    expect(offReasonFor('Off today', '2026-11-22', '2026-11-22')).toBe('Off today');
  });
});

describe('ZNLY-310 combo step holds', () => {
  const steps = [
    { idx: 0, staffId: 'a', start: 840, end: 900 },  // 2:00-3:00
    { idx: 1, staffId: '', start: 840, end: 870 },   // concurrent 2:00-2:30
    { idx: 2, staffId: 'b', start: 900, end: 920 },  // sequential 3:00-3:20
  ];
  it('holds the person of an overlapping step', () => {
    expect(staffHeldByOthers(steps)[1]).toEqual({ a: 0 });
  });
  it('lets sequential steps share a person', () => {
    expect(staffHeldByOthers(steps)[2]).toEqual({});
    expect(staffHeldByOthers([{ ...steps[0] }, { idx: 2, staffId: 'a', start: 900, end: 920 }])[2]).toEqual({});
  });
});

describe('ZNLY-310 pickedRowStatus', () => {
  const k = { id: 'k', name: 'Kebisha S.' };
  const slot = { start: 840, end: 900 }; // 2:00-3:00pm
  const T = '2026-11-22';
  it('free', () => {
    expect(pickedRowStatus(k, { slot, date: T, today: T })).toEqual({ name: 'Kebisha S.', statusLine: 'Free 2–3pm', pill: 'free', problem: '' });
  });
  it('busy: problem unless busyOk', () => {
    const rangesById = { k: [{ start: 810, end: 855 }] };
    const r = pickedRowStatus(k, { slot, rangesById, date: T, today: T });
    expect(r.pill).toBe('busy'); expect(r.statusLine).toMatch(/^Busy /); expect(r.problem).toMatch(/^Kebisha S\. is busy /);
    expect(pickedRowStatus(k, { slot, rangesById, date: T, today: T, busyOk: true }).problem).toBe('');
  });
  it('off today and off on another date use the list wording', () => {
    expect(pickedRowStatus(k, { slot, offById: { k: 'Off today' }, date: T, today: T }).problem).toBe('Kebisha S. is off today');
    const r = pickedRowStatus(k, { slot, offById: { k: 'Off today' }, date: '2026-11-23', today: T });
    expect(r.problem).toBe('Kebisha S. is off Mon 23 Nov'); expect(r.pill).toBe(null); expect(r.statusLine).toBe('Off Mon 23 Nov');
    expect(pickedRowStatus(k, { slot, offById: { k: 'On leave' }, date: T, today: T }).problem).toBe('Kebisha S. is on leave');
  });
  it('no time / NaN / no person = plain row', () => {
    expect(pickedRowStatus(k, { slot: null, offById: { k: 'Off today' } })).toEqual({ name: 'Kebisha S.', statusLine: '', pill: null, problem: '' });
    expect(pickedRowStatus(k, { slot: { start: NaN, end: 900 } }).statusLine).toBe('');
    expect(pickedRowStatus(null).name).toBe('');
  });
});
