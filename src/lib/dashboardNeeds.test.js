import { describe, it, expect } from 'vitest';
import { classifyNeed, groupNeeds, needsOf, ofKind, NEED_KINDS } from './dashboardNeeds';

const T = '2026-10-29';
const NOW = Date.parse('2026-10-29T15:00:00+05:45');
const row = (o) => ({ id: o.id, status: 'Confirmed', date: T, start_time: '16:00:00', end_time: '17:00:00', created_at: '2026-10-29T14:30:00+05:45',
  payment_status: 'unpaid', final_amount: 1000, payments: [], discount_status: 'none', booking_therapists: [{ therapist_id: 't1' }], ...o });
const kind = (o) => classifyNeed(row(o), NOW, T);

describe('classifyNeed: one kind per booking, in order', () => {
  it('1 discount wins over everything', () => {
    expect(kind({ discount_status: 'pending', status: 'Completed', end_time: '12:00:00' })).toBe('discount');
    expect(kind({ discount_status: 'pending', status: 'Pending', date: '2026-10-12' })).toBe('discount');
  });
  it('2 owed: completed with a balance, any date; the balance is final minus payments', () => {
    expect(kind({ status: 'Completed', date: '2026-10-12' })).toBe('owed');
    expect(kind({ status: 'Completed', payments: [{ amount: 400 }] })).toBe('owed');
    expect(kind({ status: 'Completed', payments: [{ amount: 1000 }] })).toBeNull();
    expect(kind({ status: 'Completed', payment_status: 'paid' })).toBeNull();
  });
  it('3 not_closed: open status whose date + end_time has passed, any date, beats unconfirmed', () => {
    expect(kind({ status: 'Confirmed', date: '2026-10-12', end_time: '11:00:00' })).toBe('not_closed');
    expect(kind({ status: 'In-Progress', end_time: '14:59:00' })).toBe('not_closed');
    expect(kind({ status: 'Pending', end_time: '12:00:00', created_at: '2026-10-28T09:00:00+05:45' })).toBe('not_closed');
    expect(kind({ status: 'Confirmed', end_time: '15:00:00' })).toBe('not_closed'); // ends exactly now
    expect(kind({ status: 'In-Progress', end_time: '15:01:00' })).toBeNull();
    expect(kind({ status: 'Completed', payment_status: 'paid', end_time: '10:00:00' })).toBeNull();
    expect(kind({ status: 'Cancelled', end_time: '10:00:00' })).toBeNull();
  });
  it('4 unconfirmed: Pending, not ended, created more than 2h ago', () => {
    expect(kind({ status: 'Pending', created_at: '2026-10-29T12:59:00+05:45' })).toBe('unconfirmed');
    expect(kind({ status: 'Pending', created_at: '2026-10-29T13:00:00+05:45' })).toBeNull(); // exactly 2h: not yet
    expect(kind({ status: 'Pending', created_at: '2026-10-29T14:00:00+05:45' })).toBeNull();
    expect(kind({ status: 'Confirmed', created_at: '2026-10-20T09:00:00+05:45' })).toBeNull();
  });
  it('5 unassigned: today, not started, Pending or Confirmed, nobody on it', () => {
    expect(kind({ booking_therapists: [] })).toBe('unassigned');
    expect(kind({ booking_therapists: [], status: 'Pending' })).toBe('unassigned');
    expect(kind({ booking_therapists: [], start_time: '14:00:00', end_time: '16:00:00' })).toBeNull(); // already started
    expect(kind({ booking_therapists: [], date: '2026-10-30' })).toBeNull();
    expect(kind({ booking_therapists: [], status: 'In-Progress' })).toBeNull();
  });
  it('is null when there is no end or start time to judge by', () => {
    expect(kind({ end_time: null, start_time: null, booking_therapists: [] })).toBeNull();
  });
});

describe('needsOf / groupNeeds', () => {
  const rows = [
    row({ id: 'd', branch_id: 'B', branch_name: 'Baneshwor', discount_status: 'pending' }),
    row({ id: 'o', branch_id: 'A', branch_name: 'Lazimpat', status: 'Completed', date: '2026-10-26', end_time: '11:00:00', payments: [{ amount: 400 }] }),
    row({ id: 'n1', branch_id: 'A', branch_name: 'Lazimpat', date: '2026-10-12', end_time: '11:00:00' }),
    row({ id: 'n2', branch_id: 'A', branch_name: 'Lazimpat', status: 'Pending', end_time: '12:00:00' }),
    row({ id: 'ok', branch_id: 'A', branch_name: 'Lazimpat' }),
    row({ id: 'future', branch_id: 'A', branch_name: 'Lazimpat', date: '2026-10-30', booking_therapists: [], discount_status: 'pending' }),
  ];
  const items = needsOf(rows, NOW, T);
  it('tags each booking with exactly one kind and skips settled and future ones', () => {
    expect(items.map((i) => [i.id, i.kind])).toEqual([['d', 'discount'], ['o', 'owed'], ['n1', 'not_closed'], ['n2', 'not_closed']]);
    expect(NEED_KINDS.reduce((n, k) => n + ofKind(items, k).length, 0)).toBe(items.length);
  });
  it('gives owed rows their balance and every row a wait', () => {
    expect(items.find((i) => i.id === 'o')).toMatchObject({ amount_paid: 400, amount_due: 600 });
    expect(items.find((i) => i.id === 'n2').wait_min).toBe(180);
  });
  it('groups by branch with per-kind counts that add to the total, busiest first', () => {
    const g = groupNeeds(items);
    expect(g.map((x) => [x.branch_name, x.total])).toEqual([['Lazimpat', 3], ['Baneshwor', 1]]);
    expect(g[0].counts).toEqual({ discount: 0, owed: 1, not_closed: 2, unconfirmed: 0, unassigned: 0 });
    for (const x of g) expect(Object.values(x.counts).reduce((a, b) => a + b, 0)).toBe(x.total);
  });
  it('handles no rows', () => {
    expect(needsOf(null, NOW, T)).toEqual([]);
    expect(groupNeeds(null)).toEqual([]);
  });
});
