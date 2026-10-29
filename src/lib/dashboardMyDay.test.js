import { describe, it, expect } from 'vitest';
import { myEarnings, nextClient } from './dashboardMyDay';
import { businessNeeds, buildQueue } from './dashboardNeeds';
import { isNewTenant, setupSteps } from './dashboardTenant';
import { freeNow, freeTime, fmtFreeTotal } from './dashboardFloor';

describe('myEarnings', () => {
  it('adds own tips to service commission and referral commission', () => {
    const e = myEarnings({ tips: 300, commission_inputs: { service_revenue: 10000, commission_rate: 10, referral_rows: [{ final_amount: 2000, type: 'percentage', value: 5 }, { final_amount: 500, type: 'amount', value: 50 }] } });
    expect(e).toEqual({ tips: 300, commission: 1150, total: 1450 });
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

describe('businessNeeds', () => {
  const now = Date.parse('2026-10-29T10:00:00+05:45');
  const base = { branch_id: 'b1', branch_name: 'Lazimpat', date: '2026-10-29', payment_status: 'unpaid', status: 'Confirmed' };
  it('keeps a pending discount at once, and other items only after 2 hours', () => {
    const g = businessNeeds([
      { ...base, id: 'd', discount_status: 'pending', created_at: '2026-10-29T09:30:00+05:45' },
      { ...base, id: 'p1', status: 'Pending', created_at: '2026-10-29T09:00:00+05:45' },
      { ...base, id: 'p2', status: 'Pending', created_at: '2026-10-29T07:00:00+05:45' },
      { ...base, id: 'u1', status: 'Completed', end_time: '09:00:00' },
      { ...base, id: 'u2', status: 'Completed', end_time: '06:30:00' },
    ], now);
    expect(g).toHaveLength(1);
    expect(g[0].items.map((i) => i.id)).toEqual(['u2', 'p2', 'd']);
  });
  it('groups by branch, busiest first', () => {
    const mk = (id, branch) => ({ ...base, id, branch_id: branch, branch_name: branch, discount_status: 'pending' });
    expect(businessNeeds([mk('1', 'B'), mk('2', 'A'), mk('3', 'A')], now).map((g) => g.branch_id)).toEqual(['A', 'B']);
  });
});

describe('buildQueue', () => {
  const r = (o) => ({ date: '2026-10-29', start_time: '10:00:00', status: 'Confirmed', payment_status: 'unpaid', booking_therapists: [{}], ...o });
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
    expect(q.map((x) => [x.id, x.action])).toEqual([['c', 'collect'], ['b', 'assign'], ['d', 'confirm'], ['a', 'checkin']]);
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
