import { describe, it, expect } from 'vitest';
import {
  makeRange, stepRange, rangeLabel, dayHeading, lateMinutes, formatLate, isDimmed, nowLineIndex, inView, viewCounts,
  amountCell, nextAction, matchesBookingSearch, matchesFilters, sortBookings, groupByDay, clockLabel, addDays,
} from './bookingsList';

const ctx = { today: '2026-10-15', nowHM: '13:52' };
const mk = (o = {}) => ({
  id: 'BK-1', bookingId: 'u1', customerName: 'Asha Rai', customerPhone: '9841234567', date: '2026-10-15', time: '12:30',
  status: 'confirmed', finalAmount: 2000, payments: [], refunds: [], therapists: [{ id: 't1', name: 'Mina' }], therapist: { id: 't1' },
  serviceId: 's1', roomId: 'r1', ...o,
});

describe('date ranges', () => {
  it('builds day / week / month / custom', () => {
    expect(makeRange('day', '2026-10-15')).toEqual({ mode: 'day', from: '2026-10-15', to: '2026-10-15' });
    expect(makeRange('week', '2026-10-15')).toEqual({ mode: 'week', from: '2026-10-15', to: '2026-10-21' });
    expect(makeRange('month', '2026-02-10')).toEqual({ mode: 'month', from: '2026-02-01', to: '2026-02-28' });
    expect(makeRange('custom', '2026-10-15', { from: '2026-10-20', to: '2026-10-12' })).toEqual({ mode: 'custom', from: '2026-10-12', to: '2026-10-20' });
  });
  it('steps by the active unit', () => {
    expect(stepRange(makeRange('day', '2026-10-31'), 1).from).toBe('2026-11-01');
    expect(stepRange(makeRange('week', '2026-10-15'), 1)).toMatchObject({ from: '2026-10-22', to: '2026-10-28' });
    expect(stepRange(makeRange('month', '2026-01-15'), -1)).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
    expect(stepRange({ mode: 'custom', from: '2026-10-10', to: '2026-10-12' }, 1)).toMatchObject({ from: '2026-10-13', to: '2026-10-15' });
  });
  it('labels', () => {
    expect(rangeLabel(makeRange('day', '2026-10-15'), '2026-10-15')).toBe('Today · Thu 15 Oct');
    expect(rangeLabel(makeRange('day', '2026-10-16'), '2026-10-15')).toBe('Tomorrow · Fri 16 Oct');
    expect(rangeLabel(makeRange('month', '2026-10-15'), '2026-10-15')).toBe('October 2026');
    expect(dayHeading('2026-10-17', '2026-10-15')).toBe('Sat 17 Oct');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('row signals', () => {
  it('late only for today, Pending/Confirmed, start in the past', () => {
    expect(lateMinutes(mk({ time: '12:30' }), ctx)).toBe(82);
    expect(lateMinutes(mk({ time: '14:00' }), ctx)).toBeNull();
    expect(lateMinutes(mk({ status: 'in-progress' }), ctx)).toBeNull();
    expect(lateMinutes(mk({ date: '2026-10-14' }), ctx)).toBeNull();
    expect(lateMinutes(mk({ status: 'pending', time: '13:00' }), ctx)).toBe(52);
  });
  it('formats late', () => {
    expect(formatLate(82)).toBe('1h 22m');
    expect(formatLate(60)).toBe('1h');
    expect(formatLate(22)).toBe('22m');
  });
  it('dims finished rows before now, never Confirmed/Pending', () => {
    expect(isDimmed(mk({ status: 'completed', time: '09:00' }), ctx)).toBe(true);
    expect(isDimmed(mk({ status: 'completed', time: '15:00' }), ctx)).toBe(false);
    expect(isDimmed(mk({ status: 'cancelled', date: '2026-10-10' }), ctx)).toBe(true);
    expect(isDimmed(mk({ status: 'confirmed', time: '09:00' }), ctx)).toBe(false);
    expect(isDimmed(mk({ status: 'pending', date: '2026-10-10' }), ctx)).toBe(false);
  });
  it('now line goes before the first later row', () => {
    const rows = [mk({ time: '09:00' }), mk({ time: '13:00' }), mk({ time: '14:30' }), mk({ time: '16:00' })];
    expect(nowLineIndex(rows, '13:52')).toBe(2);
    expect(nowLineIndex(rows, '08:00')).toBe(0);
    expect(nowLineIndex(rows, '23:00')).toBe(4);
    expect(clockLabel('13:52')).toBe('1:52pm');
    expect(clockLabel('00:05')).toBe('12:05am');
  });
});

describe('view chips', () => {
  const rows = [
    mk({ status: 'completed', time: '09:00', finalAmount: 1000, payments: [{ amount: 1000 }] }),
    mk({ status: 'completed', time: '10:00', finalAmount: 1000, payments: [{ amount: 400 }] }),
    mk({ status: 'in-progress', time: '13:00' }),
    mk({ status: 'confirmed', time: '12:00' }), // late
    mk({ status: 'confirmed', time: '16:00' }),
    mk({ status: 'pending', time: '17:00', date: '2026-10-16' }),
    mk({ status: 'cancelled', time: '11:00' }),
    mk({ status: 'no show', time: '11:30' }),
  ];
  it('classifies', () => {
    expect(viewCounts(rows, ctx)).toEqual({ all: 8, done: 2, spa: 1, come: 2, walkin: 0, unpaid: 2, void: 2 });
  });
  it('Walk-in chip counts walk-ins only (ZNLY-327), linked ones too', () => {
    const w = [mk({ status: 'confirmed', isWalkIn: true }), mk({ status: 'confirmed', isWalkIn: true, customerId: 'c1' }), mk({ status: 'confirmed' })];
    expect(viewCounts(w, ctx).walkin).toBe(2);
    expect(inView(w[2], 'walkin', ctx)).toBe(false);
  });
  it('late bookings are not "To come"', () => {
    expect(inView(rows[3], 'come', ctx)).toBe(false);
  });
});

describe('amount cell', () => {
  it('follows the money model', () => {
    expect(amountCell(mk({ status: 'completed', finalAmount: 1000, payments: [{ amount: 1000 }] }), ctx)).toEqual({ tone: 'paid', text: 'Paid' });
    expect(amountCell(mk({ status: 'completed', finalAmount: 1000, payments: [{ amount: 400 }] }), ctx)).toEqual({ tone: 'due', amount: 600 });
    expect(amountCell(mk({ status: 'confirmed', finalAmount: 2000 }), ctx)).toEqual({ tone: 'price', amount: 2000 });
    expect(amountCell(mk({ status: 'confirmed', finalAmount: 2000, payments: [{ amount: 500 }] }), ctx)).toEqual({ tone: 'deposit', amount: 500 });
    expect(amountCell(mk({ status: 'cancelled' }), ctx)).toEqual({ tone: 'void', text: '—' });
  });
  it('refunds reduce what counts as paid', () => {
    expect(amountCell(mk({ status: 'completed', finalAmount: 1000, payments: [{ amount: 1000 }], refunds: [{ amount: 300 }] }), ctx)).toEqual({ tone: 'due', amount: 300 });
  });
});

describe('next action', () => {
  it('walks the lifecycle', () => {
    expect(nextAction(mk({ status: 'pending', therapists: [], therapist: null }))).toMatchObject({ id: 'assign' });
    expect(nextAction(mk({ status: 'pending' }))).toMatchObject({ id: 'confirm', to: 'confirmed' });
    expect(nextAction(mk({ status: 'confirmed' }))).toMatchObject({ id: 'start', to: 'in-progress' });
    expect(nextAction(mk({ status: 'in-progress' }))).toMatchObject({ id: 'complete', to: 'completed' });
  });
  it('is hidden when terminal, locked or read-only', () => {
    expect(nextAction(mk({ status: 'completed' }))).toBeNull();
    expect(nextAction(mk({ status: 'cancelled' }))).toBeNull();
    expect(nextAction(mk({ isLocked: true }))).toBeNull();
    expect(nextAction(mk(), { readOnly: true })).toBeNull();
  });
});

describe('search / filters', () => {
  const b = mk({ customerPhone: '+977 984-1234567' });
  it('matches name, number and normalised phone', () => {
    expect(matchesBookingSearch(b, 'asha')).toBe(true);
    expect(matchesBookingSearch(b, 'bk-1')).toBe(true);
    expect(matchesBookingSearch(b, '984 1234567')).toBe(true);
    expect(matchesBookingSearch(b, '09841234567')).toBe(true);
    expect(matchesBookingSearch(b, '+977984')).toBe(true);
    expect(matchesBookingSearch(b, '9999')).toBe(false);
    expect(matchesBookingSearch(b, '')).toBe(true);
  });
  it('filters by therapist / service / room', () => {
    expect(matchesFilters(b, { therapist: 't1' })).toBe(true);
    expect(matchesFilters(b, { therapist: 't2' })).toBe(false);
    expect(matchesFilters(b, { service: 's2' })).toBe(false);
    expect(matchesFilters(b, { room: 'r1' })).toBe(true);
    expect(matchesFilters(b, {})).toBe(true);
  });
});

describe('sort / group', () => {
  const rows = [
    mk({ id: 'C', date: '2026-10-16', time: '09:00', customerName: 'Zed' }),
    mk({ id: 'B', date: '2026-10-15', time: '14:00', customerName: 'Bob', finalAmount: 500 }),
    mk({ id: 'A', date: '2026-10-15', time: '09:00', customerName: 'Cat', finalAmount: 900 }),
  ];
  it('sorts by date then time', () => {
    expect(sortBookings(rows, 'time').map((r) => r.id)).toEqual(['A', 'B', 'C']);
  });
  it('keeps days together for other sorts', () => {
    expect(sortBookings(rows, 'customer').map((r) => r.id)).toEqual(['B', 'A', 'C']);
    expect(sortBookings(rows, 'amount').map((r) => r.id)).toEqual(['A', 'B', 'C']);
  });
  it('groups by day', () => {
    const g = groupByDay(sortBookings(rows, 'time'));
    expect(g.map((x) => [x.date, x.rows.length])).toEqual([['2026-10-15', 2], ['2026-10-16', 1]]);
  });
});
