import { describe, it, expect } from 'vitest';
import { hoursFromShiftRow } from './staffDay';
import {
  shiftBasis, shiftSource, therapistState, availabilityNow, freeForSlot, freeUntilLabel, nextSlot10, usualTherapistId, suggestTherapist,
  isNewOnline, isUnseen, needsYouNow, matchesNeed, clock, toMin,
} from './freeNow';

const T = (id, name) => ({ id, name });
const A = T('a', 'Asha'); const B = T('b', 'Bina'); const C = T('c', 'Chhiring'); const D = T('d', 'Dolma');
const bk = (o) => ({ bookingId: 'x', status: 'confirmed', date: '2026-10-15', time: '10:00', endTime: '11:00', createdBy: 'u', customerName: 'Guest One', customerPhone: '9800', therapists: [], serviceId: 's1', service: 'Swedish', duration: '60 min', ...o });
const OPEN = { startTime: '00:00', endTime: '24:00', isDayOff: false, breaks: [] };
// Default: every therapist has an open roster row (shift data exists), so tests isolate one rule at a time.
const ctx = (o = {}) => ({ date: '2026-10-15', nowMin: toMin('13:52'), source: 'roster', bookings: [], blocks: [], transfers: [], attendanceById: {}, shiftById: { a: OPEN, b: OPEN, c: OPEN, d: OPEN }, ...o });

describe('shift source', () => {
  it('uses attendance only when check-in is actually recorded', () => {
    expect(shiftSource([])).toBe('roster');
    expect(shiftSource([{ therapistId: 'a', status: null }, { therapistId: 'b', status: 'Absent' }])).toBe('roster');
    expect(shiftSource([{ therapistId: 'a', status: 'Present', checkInTime: '09:05' }])).toBe('attendance');
  });
});

describe('therapistState (roster mode)', () => {
  it('free with no bookings; until the next booking', () => {
    expect(therapistState(A, ctx())).toEqual({ state: 'free', freeUntil: null });
    const c = ctx({ bookings: [bk({ therapists: [{ id: 'a' }], time: '15:00', endTime: '16:00' })] });
    expect(therapistState(A, c)).toEqual({ state: 'free', freeUntil: 900 });
  });
  it('busy while a Confirmed or In-Progress booking overlaps now, with the back-to-back free-at', () => {
    const c = ctx({ bookings: [
      bk({ bookingId: '1', status: 'in-progress', therapists: [{ id: 'a' }], time: '13:00', endTime: '14:30' }),
      bk({ bookingId: '2', status: 'confirmed', therapists: [{ id: 'a' }], time: '14:30', endTime: '15:30' }),
    ] });
    expect(therapistState(A, c)).toMatchObject({ state: 'busy', kind: 'booking', freeAt: toMin('15:30') });
    const c2 = ctx({ bookings: [bk({ status: 'confirmed', therapists: [{ id: 'a' }], time: '13:30', endTime: '14:30' })] });
    expect(therapistState(A, c2)).toMatchObject({ state: 'busy', freeAt: toMin('14:30') });
  });
  it('cancelled / completed / no-show bookings do not occupy', () => {
    const c = ctx({ bookings: ['cancelled', 'completed', 'no show'].map((s) => bk({ status: s, therapists: [{ id: 'a' }], time: '13:00', endTime: '15:00' })) });
    expect(therapistState(A, c).state).toBe('free');
  });
  it('an In-Progress booking past its end is "running over" (no free-at)', () => {
    const c = ctx({ bookings: [bk({ status: 'in-progress', therapists: [{ id: 'a' }], time: '12:00', endTime: '13:00' })] });
    expect(therapistState(A, c)).toMatchObject({ state: 'busy', freeAt: null, overrun: true });
  });
  it('per-therapist booking times win (couples with staggered starts)', () => {
    const c = ctx({ bookings: [bk({ therapists: [{ id: 'a', startTime: '14:00', endTime: '15:00' }, { id: 'b', startTime: '13:00', endTime: '14:30' }], time: '13:00', endTime: '15:00' })] });
    expect(therapistState(A, c)).toEqual({ state: 'free', freeUntil: toMin('14:00') });
    expect(therapistState(B, c).state).toBe('busy');
  });
  it('manual block now → busy (not "in session"); block later → free until it', () => {
    const now = ctx({ blocks: [{ therapistId: 'a', startTime: '13:00', endTime: '14:00', description: 'Lunch' }] });
    expect(therapistState(A, now)).toMatchObject({ state: 'busy', kind: 'block', freeAt: toMin('14:00'), label: 'Lunch' });
    const later = ctx({ blocks: [{ therapistId: 'a', startTime: '16:00', endTime: '17:00' }] });
    expect(therapistState(A, later)).toEqual({ state: 'free', freeUntil: 960 });
    expect(therapistState(B, now).state).toBe('free'); // someone else's block
  });
  it('transferred out / visiting windows exclude', () => {
    const c = ctx({ transfers: [{ therapistId: 'a', startTime: '00:00', endTime: '24:00', description: 'Transferred to Thamel' }] });
    expect(therapistState(A, c)).toMatchObject({ state: 'busy', kind: 'transfer', freeAt: null });
    expect(availabilityNow([A], c).free).toHaveLength(0);
  });
  it('leave, absent and day off are never free', () => {
    for (const status of ['Leave', 'Annual Leave', 'Sick Leave', 'Day Off', 'Absent']) {
      expect(therapistState(A, ctx({ attendanceById: { a: { status } } })).state).toBe('off');
    }
    expect(therapistState(A, ctx({ shiftById: { a: { isDayOff: true } } }))).toMatchObject({ state: 'off', reason: 'Day off' });
  });
  it('roster hours bound the shift; breaks occupy', () => {
    const wh = { startTime: '09:00', endTime: '18:00', isDayOff: false, breaks: [{ name: 'Lunch', startTime: '14:00', endTime: '14:30' }] };
    expect(therapistState(A, ctx({ shiftById: { a: wh } }))).toEqual({ state: 'free', freeUntil: toMin('14:00') });
    expect(therapistState(A, ctx({ nowMin: toMin('18:30'), shiftById: { a: wh } }))).toMatchObject({ state: 'off', reason: 'Shift ended' });
    expect(therapistState(A, ctx({ nowMin: toMin('08:00'), shiftById: { a: wh } }))).toMatchObject({ state: 'off' });
    expect(therapistState(A, ctx({ nowMin: toMin('17:30'), shiftById: { a: wh } }))).toEqual({ state: 'free', freeUntil: toMin('18:00') });
  });
});

describe('the rule\'s shift (therapist_shifts_for_range)', () => {
  const row = (o) => hoursFromShiftRow({ works: true, source: 'weekly', start_time: '09:00:00', end_time: '18:00:00', breaks: [], off: [], ...o });
  it('no hours set is open inside branch hours only', () => {
    const open = row({ source: 'none', start_time: '10:00:00', end_time: '20:00:00' });  // the RPC already clamps to branch hours
    expect(open.openNoHours).toBe(true);
    expect(therapistState(A, ctx({ shiftById: { a: open } }))).toMatchObject({ state: 'free' });
    expect(therapistState(A, ctx({ nowMin: toMin('21:00'), shiftById: { a: open } }))).toMatchObject({ state: 'off', reason: 'Shift ended' });
    expect(therapistState(A, ctx({ nowMin: toMin('09:00'), shiftById: { a: open } }))).toMatchObject({ state: 'off' });
  });
  it('the Free-now row carries the shared status line, and "No hours set" for someone with no hours', () => {
    const open = row({ source: 'none', start_time: '10:00:00', end_time: '20:00:00' });
    const r = availabilityNow([A, B], ctx({ shiftById: { a: open, b: row() } }));
    expect(r.free.find((f) => f.therapist.id === 'a')).toMatchObject({ status: 'No hours set · bookable in branch hours 10:00–20:00', label: 'free until 8:00pm' });
    expect(r.free.find((f) => f.therapist.id === 'b').label).toBe('free until 6:00pm');
  });
  it('a closed branch day (no hours, not working) is off', () => {
    expect(therapistState(A, ctx({ shiftById: { a: row({ source: 'none', works: false, start_time: null, end_time: null }) } }))).toMatchObject({ state: 'off', reason: 'Closed' });
  });
  it('a roster date change overrides the weekly hours, and its breaks occupy', () => {
    const h = row({ source: 'roster', start_time: '11:00:00', end_time: '20:00:00', breaks: [{ name: '', start: '14:00', end: '14:30' }] });
    expect(h.source).toBe('override');
    expect(therapistState(A, ctx({ nowMin: toMin('14:10'), shiftById: { a: h } }))).toMatchObject({ state: 'busy', kind: 'break', freeAt: toMin('14:30') });
  });
  it('a half day of leave occupies that part of the shift', () => {
    const h = row({ off: [{ code: 'ON_LEAVE', reason: 'leave_half', start_min: 9 * 60, end_min: 14 * 60 }] });
    expect(therapistState(A, ctx({ nowMin: toMin('13:00'), shiftById: { a: h } }))).toMatchObject({ state: 'busy', kind: 'leave' });
  });
});

describe('no shift data (the "on today" fallback)', () => {
  const none = (o = {}) => ctx({ shiftById: {}, ...o });
  it('counts only people with a non-cancelled booking today', () => {
    const c = none({ bookings: [
      bk({ bookingId: '1', status: 'completed', therapists: [{ id: 'a' }], time: '09:00', endTime: '10:00' }),
      bk({ bookingId: '2', status: 'cancelled', therapists: [{ id: 'b' }], time: '09:00', endTime: '10:00' }),
      bk({ bookingId: '3', status: 'confirmed', therapists: [{ id: 'c' }], time: '16:00', endTime: '17:00' }),
    ] });
    expect(therapistState(A, c).state).toBe('free');
    expect(therapistState(B, c)).toMatchObject({ state: 'off', reason: 'No shift or bookings today' });
    expect(therapistState(C, c)).toEqual({ state: 'free', freeUntil: 960 });
    expect(therapistState(D, c).state).toBe('off');
    const r = availabilityNow([A, B, C, D], c);
    expect(r.free.map((f) => f.therapist.id)).toEqual(['c', 'a']);
    expect(r.basis).toBe('bookings');
  });
  it('a roster row (even a long shift) or check-in is real shift data', () => {
    expect(shiftBasis([A, B], ctx())).toBe('roster');
    expect(shiftBasis([A, B], ctx({ shiftById: { a: OPEN } }))).toBe('bookings');
    expect(shiftBasis([A], ctx({ source: 'attendance' }))).toBe('attendance');
  });
  it('leave still wins over a booking', () => {
    const c = none({ bookings: [bk({ therapists: [{ id: 'a' }], time: '09:00', endTime: '10:00', status: 'completed' })], attendanceById: { a: { status: 'Sick Leave' } } });
    expect(therapistState(A, c).state).toBe('off');
  });
});

describe('therapistState (attendance mode)', () => {
  const att = (o) => ctx({ source: 'attendance', ...o });
  it('only checked-in therapists are on shift', () => {
    const c = att({ attendanceById: { a: { status: 'Present', checkInTime: '09:00' }, b: { status: null } } });
    expect(therapistState(A, c).state).toBe('free');
    expect(therapistState(B, c)).toMatchObject({ state: 'off', reason: 'Not checked in' });
    expect(therapistState(C, c)).toMatchObject({ state: 'off', reason: 'Not checked in' });
  });
  it('checked out → off; check-in later than now → off', () => {
    expect(therapistState(A, att({ attendanceById: { a: { status: 'Present', checkInTime: '09:00', checkOutTime: '13:30' } } })).state).toBe('off');
    expect(therapistState(A, att({ attendanceById: { a: { status: 'Present', checkInTime: '14:30' } } })).state).toBe('off');
  });
});

describe('availabilityNow', () => {
  it('splits free / in session, sorted, with labels', () => {
    const c = ctx({
      bookings: [
        bk({ bookingId: '1', status: 'in-progress', therapists: [{ id: 'b' }], time: '13:00', endTime: '14:30' }),
        bk({ bookingId: '2', therapists: [{ id: 'c' }], time: '15:00', endTime: '16:00' }),
      ],
      attendanceById: { d: { status: 'Leave' } },
    });
    const r = availabilityNow([A, B, C, D], c);
    expect(r.free.map((f) => [f.therapist.id, f.label])).toEqual([['c', 'free until 3:00pm'], ['a', 'free all afternoon']]);
    expect(r.inSession.map((s) => [s.therapist.id, s.label])).toEqual([['b', 'free at 2:30pm']]);
    expect(r.source).toBe('roster');
  });
  it('labels', () => {
    expect(freeUntilLabel(toMin('14:30'), toMin('13:55'))).toBe('free until 2:30pm (35 min)');
    expect(freeUntilLabel(null, toMin('10:00'))).toBe('free all day');
    expect(freeUntilLabel(null, toMin('18:00'))).toBe('free all evening');
    expect(nextSlot10(toMin('13:52'))).toBe(toMin('14:00'));
    expect(nextSlot10(toMin('14:00'))).toBe(toMin('14:00'));
    expect(clock(0)).toBe('12:00am');
  });
});

describe('freeForSlot', () => {
  it('needs the whole slot clear and ignores the booking itself', () => {
    const c = ctx({ bookings: [bk({ bookingId: 'self', therapists: [{ id: 'a' }], time: '15:00', endTime: '16:00' })], blocks: [{ therapistId: 'a', startTime: '17:00', endTime: '18:00' }] });
    expect(freeForSlot(A, toMin('14:00'), toMin('15:00'), c)).toBe(true);
    expect(freeForSlot(A, toMin('14:30'), toMin('15:30'), c)).toBe(false);
    expect(freeForSlot(A, toMin('14:30'), toMin('15:30'), c, { excludeBookingId: 'self' })).toBe(true);
    expect(freeForSlot(A, toMin('16:30'), toMin('17:30'), c)).toBe(false);
  });
  it('respects shift end and leave', () => {
    const c = ctx({ shiftById: { a: { startTime: '09:00', endTime: '16:00', isDayOff: false } }, attendanceById: { b: { status: 'Sick Leave' } } });
    expect(freeForSlot(A, toMin('15:30'), toMin('16:30'), c)).toBe(false);
    expect(freeForSlot(B, toMin('10:00'), toMin('11:00'), c)).toBe(false);
  });
});

describe('suggestTherapist', () => {
  const unassigned = bk({ bookingId: 'u1', therapists: [], time: '15:00', endTime: '16:00', serviceId: 's1', service: 'Swedish Massage' });
  it('least busy when nothing else decides', () => {
    const c = ctx({ bookings: [unassigned, bk({ bookingId: '2', therapists: [{ id: 'a' }], time: '10:00', endTime: '11:00' }), bk({ bookingId: '3', therapists: [{ id: 'a' }], time: '11:30', endTime: '12:00' })] });
    const s = suggestTherapist(unassigned, [A, B], c);
    expect(s.therapist.id).toBe('b');
    expect(s.reasons[0]).toBe('Free 3:00pm–4:00pm');
  });
  it('prefers the usual therapist over a less busy one', () => {
    const c = ctx({ bookings: [unassigned, bk({ bookingId: '2', therapists: [{ id: 'a' }], time: '10:00', endTime: '11:00' })] });
    const s = suggestTherapist(unassigned, [A, B], c, { usualId: 'a' });
    expect(s.therapist.id).toBe('a');
    expect(s.label).toContain('usual therapist');
  });
  it('skips leave / transfer / block / busy candidates', () => {
    const c = ctx({
      bookings: [unassigned, bk({ bookingId: '2', therapists: [{ id: 'd' }], time: '15:30', endTime: '16:30' })],
      attendanceById: { a: { status: 'Leave' } },
      transfers: [{ therapistId: 'b', startTime: '00:00', endTime: '24:00' }],
      blocks: [{ therapistId: 'c', startTime: '15:00', endTime: '15:30' }],
    });
    expect(suggestTherapist(unassigned, [A, B, C, D], c)).toBeNull();
  });
  it('respects service eligibility only when the service has a list', () => {
    const c = ctx({ bookings: [unassigned] });
    expect(suggestTherapist(unassigned, [A, B], c, { eligibility: new Map([['s1', new Set(['b'])]]), usualId: 'a' }).therapist.id).toBe('b');
    expect(suggestTherapist(unassigned, [A, B], c, { eligibility: new Map([['s1', new Set()]]) })).not.toBeNull();
    expect(suggestTherapist(unassigned, [A], c, { eligibility: new Map([['s1', new Set(['b'])]]) })).toBeNull();
  });
  it('judges a late booking on its own slot (what assign validates), not from now', () => {
    const late = bk({ bookingId: 'u2', therapists: [], time: '12:00', endTime: '13:00' });
    const c = ctx({ bookings: [late, bk({ bookingId: '2', therapists: [{ id: 'a' }], time: '12:00', endTime: '13:30' })] });
    const s = suggestTherapist(late, [A, B], c, { usualId: 'a' });
    expect(s.therapist.id).toBe('b'); // a's booking overlapped the original slot, even though it is over now
    expect(s.reasons[0]).toBe('Free 12:00pm–1:00pm');
  });
});

describe('suggestTherapist returns the slot it judged', () => {
  it('gives start/end for chaining suggestions', () => {
    const u = bk({ bookingId: 'u1', therapists: [], time: '15:00', endTime: '16:00' });
    const s = suggestTherapist(u, [A], ctx({ bookings: [u] }));
    expect([s.start, s.end]).toEqual([toMin('15:00'), toMin('16:00')]);
  });
});

describe('usual therapist', () => {
  it('needs >=2 visits and >= half', () => {
    expect(usualTherapistId([{ therapistId: 'a' }, { therapistId: 'a' }, { therapistId: 'b' }])).toBe('a');
    expect(usualTherapistId([{ therapistId: 'a' }, { therapistId: 'b' }])).toBeNull();
    expect(usualTherapistId([{ therapistId: 'a' }, { therapistId: 'a' }, { therapistId: 'b' }, { therapistId: 'c' }, { therapistId: 'd' }])).toBeNull();
    expect(usualTherapistId([])).toBeNull();
  });
});

describe('unseen + needs you now', () => {
  const rows = [
    bk({ bookingId: '1', status: 'pending', createdBy: null, time: '17:00' }), // online, nobody opened it
    bk({ bookingId: '2', status: 'confirmed', createdBy: null, time: '17:30', acknowledgedAt: '2026-10-15T08:00:00Z' }), // online, opened
    bk({ bookingId: '3', status: 'confirmed', time: '12:30', customerName: 'Dhiren Rai', customerPhone: '+977 98' }), // late, unassigned
    bk({ bookingId: '4', status: 'pending', time: '16:00', therapists: [{ id: 'a' }] }),
    bk({ bookingId: '5', status: 'pending', time: '16:00', date: '2026-10-16', createdBy: null }), // tomorrow: ignored
    bk({ bookingId: '6', status: 'completed', time: '09:00' }),
  ];
  it('unopened = online AND not acknowledged AND still live (team-level, not per person)', () => {
    expect(isNewOnline(rows[0])).toBe(true);
    expect(isUnseen(rows[0])).toBe(true);
    expect(isNewOnline(rows[1])).toBe(false); // someone opened it
    expect(isUnseen(rows[3])).toBe(false); // staff-made
    expect(isNewOnline(bk({ createdBy: null, status: 'confirmed' }))).toBe(true); // confirmed but never opened still counts
    expect(isNewOnline(bk({ createdBy: null, status: 'cancelled' }))).toBe(false);
  });
  it('counts, today only', () => {
    const items = needsYouNow(rows, ctx());
    expect(items.map((i) => [i.id, i.count])).toEqual([['online', 1], ['late', 1], ['assign', 3]]);
    expect(items[0].text).toBe('1 new online booking');
    expect(items[1]).toMatchObject({ text: 'Dhiren is 1h 22m late', action: 'Call', tel: '+977 98' });
    expect(items[2].text).toBe('3 bookings need a therapist');
  });
  it('several late bookings → View; nothing → empty', () => {
    const many = [bk({ bookingId: 'a', time: '12:00' }), bk({ bookingId: 'b', time: '12:30' })];
    expect(needsYouNow(many, ctx()).find((i) => i.id === 'late')).toMatchObject({ count: 2, text: '2 bookings are running late', action: 'View' });
    expect(needsYouNow([bk({ therapists: [{ id: 'a' }], time: '17:00' })], ctx())).toEqual([]);
  });
  it('filters match the counted rows', () => {
    const c = ctx();
    expect(rows.filter((b) => matchesNeed(b, 'online', c)).map((b) => b.bookingId)).toEqual(['1']);
    expect(rows.filter((b) => matchesNeed(b, 'late', c)).map((b) => b.bookingId)).toEqual(['3']);
    expect(rows.filter((b) => matchesNeed(b, 'assign', c)).map((b) => b.bookingId)).toEqual(['1', '2', '3']);
  });
});

describe('needs you now: finished but not paid (ZNLY-273)', () => {
  const done = (o) => bk({ status: 'Completed', paymentStatus: 'unpaid', finalAmount: 1000, payments: [], therapists: [{ id: 'a' }], ...o });
  it('counts today\'s completed bookings that still owe money, with a Collect action', () => {
    const items = needsYouNow([done({}), done({ payments: [{ amount: 400 }], paymentStatus: 'partial' }), done({ paymentStatus: 'paid', payments: [{ amount: 1000 }] })], ctx());
    expect(items.find((i) => i.id === 'unpaid')).toEqual({ id: 'unpaid', count: 2, text: '2 finished but not paid', action: 'Collect' });
  });
  it('ignores other days, unfinished bookings and fully paid ones', () => {
    expect(needsYouNow([done({ date: '2026-10-14' }), bk({ status: 'Confirmed', therapists: [{ id: 'a' }], time: '17:00' })], ctx()).find((i) => i.id === 'unpaid')).toBeUndefined();
  });
  it('matchesNeed("unpaid") picks exactly those rows', () => {
    const rows = [done({}), done({ paymentStatus: 'paid', payments: [{ amount: 1000 }] })];
    expect(rows.filter((b) => matchesNeed(b, 'unpaid', ctx()))).toHaveLength(1);
  });
  it('uses the dashboard rule on fallback amount_paid rows', () => {
    expect(matchesNeed(done({ payments: undefined, amountPaid: 1000, paymentStatus: 'paid' }), 'unpaid', ctx())).toBe(false);
    expect(matchesNeed(done({ payments: undefined, amountPaid: 0 }), 'unpaid', ctx())).toBe(true);
  });
});
