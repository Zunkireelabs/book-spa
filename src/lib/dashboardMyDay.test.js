import { describe, it, expect } from 'vitest';
import { dayStatus, myEarnings, nextClient } from './dashboardMyDay';
import { groupNeeds, needsOf, buildQueue, summarizeWaiting, adminDiscounts } from './dashboardNeeds';
import { isNewTenant, setupSteps } from './dashboardTenant';
import { freeNow, freeTime, fmtFreeTotal } from './dashboardFloor';

describe('myEarnings', () => {
  it('adds own tips to service commission and referral commission', () => {
    const e = myEarnings({ tips: 300, commission_inputs: { service_revenue: 10000, commission_rate: 10, referral_rows: [{ final_amount: 2000, type: 'percentage', value: 5 }, { final_amount: 500, type: 'amount', value: 50 }] } });
    expect(e).toEqual({ tips: 300, commission: 1150, total: 1450 });
  });
  it('reads the month-to-date inputs for the month column, with the same rate', () => {
    const my = { tips: 300, tips_month: 4150, commission_inputs: { service_revenue: 10000, commission_rate: 10, referral_rows: [] }, commission_inputs_month: { service_revenue: 186000, referral_rows: [] } };
    expect(myEarnings(my, 'month')).toEqual({ tips: 4150, commission: 18600, total: 22750 });
  });
  it('has no commission figure without a rate', () => {
    expect(myEarnings({ tips: 100, commission_inputs: { service_revenue: 5000, commission_rate: null } })).toEqual({ tips: 100, commission: null, total: 100 });
    expect(myEarnings(null)).toEqual({ tips: 0, commission: null, total: 0 });
  });
});

describe('nextClient', () => {
  const b = (id, start, end, status = 'Confirmed') => ({ id, start, end, status });
  it('prefers the one in progress', () => {
    expect(nextClient([b('a', '10:00', '11:00'), b('b', '09:00', '12:00', 'In-Progress')], '10:30').id).toBe('b');
  });
  it('else the first not yet finished, skipping done and past ones', () => {
    expect(nextClient([b('a', '09:00', '10:00', 'Completed'), b('b', '10:00', '11:00'), b('c', '13:00', '14:00')], '11:30').id).toBe('c');
    expect(nextClient([b('a', '09:00', '10:00')], '12:00')).toBeNull();
  });
});

describe('summarizeWaiting / adminDiscounts', () => {
  const now = Date.parse('2026-10-29T15:00:00+05:45');
  const base = { branch_id: 'b1', branch_name: 'Lazimpat', date: '2026-10-29', payment_status: 'unpaid', status: 'Completed', final_amount: 2400 };
  const groups = groupNeeds(needsOf([
    { ...base, id: 'u1', end_time: '12:15:00' },
    { ...base, id: 'u2', end_time: '12:30:00' },
    { ...base, id: 'p1', status: 'Pending', created_at: '2026-10-29T10:00:00+05:45' },
    { ...base, id: 'd1', status: 'Confirmed', discount_status: 'pending', created_at: '2026-10-29T14:30:00+05:45' },
  ], now, '2026-10-29'));
  it('gives one row per kind per branch with count, total and the oldest time', () => {
    const rows = summarizeWaiting(groups);
    expect(rows.map((r) => [r.kind, r.count, r.amount])).toEqual([['owed', 2, 4800], ['unconfirmed', 1, null]]);
    expect(rows[0].since).toBe(Date.parse('2026-10-29T12:15:00+05:45'));
  });
  it('lists discounts separately as the admin rows', () => {
    expect(adminDiscounts(groups).map((d) => [d.id, d.branch_name])).toEqual([['d1', 'Lazimpat']]);
  });
});

describe('buildQueue', () => {
  const r = (o) => ({ date: '2026-10-29', start_time: '10:00:00', status: 'Confirmed', payment_status: 'unpaid', final_amount: 1000, booking_therapists: [{}], ...o });
  it('picks one action per booking', () => {
    const q = buildQueue([
      r({ id: 'a', start_time: '12:00:00' }),
      r({ id: 'b', status: 'Pending', booking_therapists: [] }),
      r({ id: 'c', status: 'Completed' }),
      r({ id: 'd', status: 'Pending' }),
      r({ id: 'e', status: 'In-Progress' }),
      r({ id: 'f', status: 'Completed', payment_status: 'paid' }),
      r({ id: 'g', date: '2026-10-28' }),
    ], '2026-10-29');
    expect(q.map((x) => [x.id, x.action])).toEqual([['b', 'assign'], ['c', 'collect'], ['d', 'confirm'], ['e', 'with'], ['a', 'checkin']]);
  });
});

describe('new tenant', () => {
  it('is new until a booking is older than 14 days', () => {
    expect(isNewTenant(null, '2026-10-29')).toBe(true);
    expect(isNewTenant('2026-10-20', '2026-10-29')).toBe(true);
    expect(isNewTenant('2026-10-10', '2026-10-29')).toBe(false);
  });
  it('marks steps done from real counts', () => {
    expect(setupSteps({ services: 3, staff: 0, rooms: 1, bookings: 0 }).map((s) => s.done)).toEqual([true, false, true, false]);
  });
  it('drops the rooms step when the industry has no rooms', () => {
    const keys = setupSteps({ services: 1 }, { enableRooms: false }).map((s) => s.key);
    expect(keys).toEqual(['services', 'staff', 'booking']);
    expect(setupSteps({}, {}).map((s) => s.key)).toContain('rooms');
  });
  it('labels the rooms step with the industry location label, lowercased', () => {
    const r = setupSteps({}, { roomLabel: 'Stations' }).find((s) => s.key === 'rooms');
    expect(r.label).toBe('Add your stations');
  });
});

describe('floor helpers', () => {
  const t = (id, from, to, blocks = []) => ({ therapist_id: id, name: id, shift_from_min: from, shift_to_min: to, blocks, gaps: [] });
  it('lists people on shift with nothing on now, longest free first', () => {
    const f = freeNow([t('a', 540, 1080, [{ from_min: 600, to_min: 660 }]), t('b', 540, 1080, [{ from_min: 840, to_min: 900 }]), t('c', 700, 1080)], 630);
    expect(f.map((x) => x.therapist_id)).toEqual(['b']);
    expect(f[0].free_until_min).toBe(840);
  });
  it('counts people with free time and shows big totals in whole hours', () => {
    expect(freeTime([{ gaps: [{ from_min: 600, to_min: 700 }] }, { gaps: [] }], null).people).toBe(1);
    expect(fmtFreeTotal(240 * 60)).toBe('240h');
    expect(fmtFreeTotal(330)).toBe('5h 30m');
  });
});

describe('dayStatus', () => {
  const b = (id, start, status) => ({ id, start, status });
  it('is not all done while a past booking is still open', () => {
    const d = dayStatus([b('a', '11:00', 'Confirmed')], '13:00');
    expect(d).toMatchObject({ total: 1, done: 0, open: 1, late: 1, allClosed: false });
  });
  it('is all done only when everything is completed, cancelled or no-show', () => {
    expect(dayStatus([b('a', '09:00', 'Completed'), b('b', '10:00', 'No Show')], '13:00').allClosed).toBe(true);
    expect(dayStatus([], '13:00').allClosed).toBe(false);
  });
  it('counts only started-and-open bookings as late, not ones in progress or to come', () => {
    expect(dayStatus([b('a', '09:00', 'In-Progress'), b('b', '15:00', 'Confirmed'), b('c', '10:00', 'Pending')], '13:00').late).toBe(1);
  });
});

import { dayChip, dayMeta } from './dashboardMyDay';
describe('My day uses the Bookings list status mapping (ZNLY-237)', () => {
  const t = (id, status, start = '14:00') => ({ id, status, start });
  const ctx = { nowHm: '18:30', today: '2026-11-17', nextId: null };
  it('Late only for Pending or Confirmed past their start', () => {
    expect(dayChip(t('a', 'Confirmed'), ctx)[0]).toBe('Late');
    expect(dayChip(t('a', 'Pending'), ctx)[0]).toBe('Late');
    expect(dayChip(t('a', 'Confirmed', '19:00'), ctx)[0]).toBe('Booked');
  });
  it('No show and Cancelled are their own chips, never Late', () => {
    expect(dayChip(t('a', 'No Show'), ctx)[0]).toBe('No show');
    expect(dayChip(t('a', 'Cancelled'), ctx)[0]).toBe('Cancelled');
  });
  it('counts and meta line follow the same statuses', () => {
    const s = dayStatus([t('a', 'Completed'), t('b', 'No Show'), t('c', 'Confirmed'), t('d', 'Cancelled')], '18:30', '2026-11-17');
    // ZNLY-276: a no-show is finished; total leaves out the cancelled one
    expect(s).toMatchObject({ total: 3, done: 2, noShow: 1, cancelled: 1, open: 1, late: 1, allClosed: false });
    expect(dayMeta(s)).toBe('2 of 3 finished · 1 no-show · 1 cancelled');
  });
});
