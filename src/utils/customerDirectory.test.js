import { describe, it, expect } from 'vitest';
import {
  buildCustomerDirectory, lifecycleSegment, bookingDue, nepalNow, tabCounts, lifecycleCounts, matchesSearch, sortCustomers,
  phoneSearchDigits, relativeDayLabel, daysBetween, TABS,
} from './customerDirectory';

const TODAY = '2026-10-15';
const NOW_HM = '14:00';
const ago = (n) => { const d = new Date(Date.UTC(2026, 9, 15) - n * 86400000); return d.toISOString().slice(0, 10); };
const ahead = (n) => ago(-n);
const cust = (id, extra = {}) => ({ id, full_name: `Cust ${id}`, phone: '+977 980-000-0001', email: '', created_at: '2026-01-01T00:00:00Z', ...extra });
const bk = (customer_id, date, status = 'Completed', extra = {}) => ({
  customer_id, date, status, start_time: '10:00:00', payment_status: 'paid', final_amount: 1000, service_name_snapshot: 'Massage', therapist_id: 't1', therapist_name_snapshot: 'Anil T.', payments: [], ...extra,
});
const one = (customers, bookings, memberIds) => buildCustomerDirectory({ customers, bookings, memberIds, today: TODAY, nowHM: NOW_HM });
const seg = (visits, lastAgo, { next = false, firstAgo } = {}) => {
  // `visits` completed visits, the latest `lastAgo` days ago, the first (if given) `firstAgo` days ago
  const bookings = [];
  for (let i = 0; i < visits; i += 1) bookings.push(bk('a', i === 0 ? ago(lastAgo) : ago(firstAgo ?? lastAgo + 100 + i)));
  if (next) bookings.push(bk('a', ahead(3), 'Confirmed', { payment_status: 'unpaid' }));
  return one([cust('a')], bookings)[0].segment;
};

describe('lifecycle segments', () => {
  it('a customer with no completed visit is New', () => {
    expect(seg(0, 0)).toBe('new');
    expect(one([cust('a')], [bk('a', ahead(2), 'Confirmed')])[0].segment).toBe('new');
    expect(one([cust('a')], [bk('a', ago(3), 'Cancelled'), bk('a', ago(2), 'No Show')])[0].segment).toBe('new');
  });
  it('New includes a first visit up to 30 days ago, not 31', () => {
    expect(seg(1, 30, { firstAgo: 30 })).toBe('new');
    expect(seg(1, 31, { firstAgo: 31 })).toBe('occasional');
    expect(seg(5, 5, { firstAgo: 30 })).toBe('new'); // new wins even with many visits
  });
  it('At risk needs 2+ visits and more than 60 days (59 / 60 / 61)', () => {
    expect(seg(2, 59)).toBe('occasional');
    expect(seg(2, 60)).toBe('occasional');
    expect(seg(2, 61)).toBe('at-risk');
    expect(seg(1, 100)).toBe('occasional'); // one visit can never be at risk
  });
  it('Lapsed is more than 180 days with nothing booked (179 / 180 / 181)', () => {
    expect(seg(1, 179)).toBe('occasional');
    expect(seg(1, 180)).toBe('occasional');
    expect(seg(1, 181)).toBe('lapsed');
    expect(seg(3, 179)).toBe('at-risk');
    expect(seg(3, 181)).toBe('lapsed'); // lapsed outranks at-risk
  });
  it('a next booking overrides at-risk and lapsed', () => {
    expect(seg(3, 90, { next: true })).toBe('occasional');
    expect(seg(5, 90, { next: true })).toBe('regular');
    expect(seg(3, 400, { next: true })).toBe('occasional');
    expect(seg(1, 400, { next: true })).toBe('occasional');
  });
  it('a booking later today counts as next; one earlier today does not', () => {
    const later = one([cust('a')], [bk('a', ago(100)), bk('a', ago(120)), bk('a', TODAY, 'Confirmed', { start_time: '16:00:00' })])[0];
    expect(later.nextBooking.time).toBe('16:00');
    expect(later.segment).toBe('occasional');
    const earlier = one([cust('a')], [bk('a', ago(100)), bk('a', ago(120)), bk('a', TODAY, 'Confirmed', { start_time: '09:00:00' })])[0];
    expect(earlier.nextBooking).toBeNull();
    expect(earlier.segment).toBe('at-risk');
  });
  it('Regular is 4+ visits that are not new / at risk / lapsed; the rest are Occasional', () => {
    expect(seg(4, 10)).toBe('regular');
    expect(seg(3, 10)).toBe('occasional');
    expect(seg(4, 61)).toBe('at-risk');
  });
  it('the counts always sum to the total', () => {
    const customers = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => cust(id));
    const bookings = [bk('b', ago(5)), bk('c', ago(200)), bk('d', ago(70)), bk('d', ago(150)), ...[1, 2, 3, 4].map((i) => bk('e', ago(i * 10 + 40)))];
    const list = one(customers, bookings);
    const counts = lifecycleCounts(list);
    expect(Object.values(counts).reduce((s, n) => s + n, 0)).toBe(customers.length);
  });
  it('lifecycleSegment is exported for direct use', () => {
    expect(lifecycleSegment({ completedVisits: 2, firstVisitDate: ago(200), lastVisitDate: ago(61), hasNext: false, today: TODAY })).toBe('at-risk');
  });
});

describe('VIP', () => {
  const visits = (n, amount) => Array.from({ length: n }, (_, i) => bk('a', ago(100 + i * 10), 'Completed', { final_amount: amount }));
  it('is 8+ completed visits AND NPR 25,000 paid', () => {
    expect(one([cust('a')], visits(8, 3200))[0].vip).toBe(true);
    expect(one([cust('a')], visits(8, 3100))[0].vip).toBe(false);
    expect(one([cust('a')], visits(7, 9000))[0].vip).toBe(false);
  });
  it('a VIP who has gone quiet is still At risk (not exempt)', () => {
    const c = one([cust('a')], visits(8, 4000))[0];
    expect(c.vip).toBe(true);
    expect(c.segment).toBe('at-risk');
  });
});

describe('last visit and next booking', () => {
  it('last visit ignores future, cancelled and no-show bookings', () => {
    const c = one([cust('a')], [
      bk('a', ago(40)),
      bk('a', ahead(5), 'Completed'), // data glitch: a future "completed" must not become the last visit
      bk('a', ago(2), 'Cancelled'),
      bk('a', ago(1), 'No Show'),
      bk('a', ahead(1), 'Confirmed'),
    ])[0];
    expect(c.lastVisit.date).toBe(ago(40));
    expect(c.completedVisits).toBe(1);
  });
  it('an in-progress booking today is a visit and flags in-spa; yesterday does not', () => {
    const today = one([cust('a')], [bk('a', TODAY, 'In-Progress')])[0];
    expect(today.inSpa).toBe(true);
    expect(today.lastVisit.date).toBe(TODAY);
    expect(one([cust('a')], [bk('a', ago(1), 'In-Progress')])[0].inSpa).toBe(false);
  });
  it('carries service and therapist for last and next', () => {
    const c = one([cust('a')], [bk('a', ago(3), 'Completed', { service_name_snapshot: 'Facial', therapist_name_snapshot: 'Asha T.' }), bk('a', ahead(2), 'Confirmed', { service_name_snapshot: 'Foot', therapist_name_snapshot: 'Vina O.', start_time: '16:00:00' })])[0];
    expect(c.lastVisit).toEqual({ date: ago(3), service: 'Facial', therapist: 'Asha T.' });
    expect(c.nextBooking).toEqual({ date: ahead(2), time: '16:00', service: 'Foot', therapist: 'Vina O.' });
  });
  it('picks the earliest upcoming booking', () => {
    const c = one([cust('a')], [bk('a', ahead(9), 'Confirmed'), bk('a', ahead(2), 'Pending'), bk('a', ahead(5), 'Confirmed')])[0];
    expect(c.nextBooking.date).toBe(ahead(2));
  });
});

describe('balance and spent', () => {
  it('ignores future bookings, cancelled and no-shows', () => {
    const c = one([cust('a')], [
      bk('a', ahead(2), 'Confirmed', { payment_status: 'unpaid', final_amount: 5000 }),
      bk('a', ago(2), 'Cancelled', { payment_status: 'unpaid', final_amount: 5000 }),
      bk('a', ago(3), 'No Show', { payment_status: 'unpaid', final_amount: 5000 }),
      bk('a', TODAY, 'Completed', { payment_status: 'unpaid', final_amount: 1200 }),
    ])[0];
    expect(c.balance).toBe(1200);
  });
  it('subtracts partial payments, never goes negative, and skips paid bookings', () => {
    const partial = bk('a', ago(2), 'Completed', { payment_status: 'partial', final_amount: 3000, payments: [{ amount: 1000 }, { amount: '500' }] });
    const over = bk('a', ago(3), 'Completed', { payment_status: 'partial', final_amount: 1000, payments: [{ amount: 1500 }] });
    const paid = bk('a', ago(4), 'Completed', { payment_status: 'paid', final_amount: 2000, payments: [] });
    expect(one([cust('a')], [partial, over, paid])[0].balance).toBe(1500);
  });
  it('an in-progress unpaid booking today is owed (it is being rendered)', () => {
    expect(one([cust('a')], [bk('a', TODAY, 'In-Progress', { payment_status: 'unpaid', final_amount: 800 })])[0].balance).toBe(800);
  });
  it('spent is the lifetime paid total', () => {
    const c = one([cust('a')], [bk('a', ago(2), 'Completed', { final_amount: 1500 }), bk('a', ago(9), 'Completed', { final_amount: 2500 }), bk('a', ago(8), 'Completed', { payment_status: 'unpaid', final_amount: 9999 })])[0];
    expect(c.spent).toBe(4000);
  });
  it('bookingDue is a pure per-booking helper', () => {
    expect(bookingDue(bk('a', ahead(1), 'Confirmed', { payment_status: 'unpaid' }), TODAY)).toBe(0);
    expect(bookingDue(bk('a', ago(1), 'Completed', { payment_status: 'unpaid', final_amount: 700 }), TODAY)).toBe(700);
  });
});

describe('Nepal clock', () => {
  it('uses Nepal date and time, not UTC (the midnight boundary)', () => {
    // 2026-10-14 19:00 UTC is 2026-10-15 00:45 in Nepal (+05:45)
    expect(nepalNow(new Date('2026-10-14T19:00:00Z'))).toEqual({ today: '2026-10-15', hm: '00:45' });
    // 2026-10-15 18:14 UTC is still 23:59 in Nepal on the 15th
    expect(nepalNow(new Date('2026-10-15T18:14:00Z'))).toEqual({ today: '2026-10-15', hm: '23:59' });
    expect(nepalNow(new Date('2026-10-15T18:15:00Z'))).toEqual({ today: '2026-10-16', hm: '00:00' });
  });
});

describe('tabs, search and sort', () => {
  const customers = [cust('a', { full_name: 'Aarav', phone: '+977 984-112-0921' }), cust('b', { full_name: 'Bimala', phone: '9779801234567', email: 'bim@x.test' }), cust('c', { full_name: 'Chetan', phone: '' })];
  const bookings = [bk('a', ahead(3), 'Confirmed'), bk('b', TODAY, 'In-Progress'), bk('c', ago(3), 'Completed', { payment_status: 'unpaid', final_amount: 900 })];
  const list = one(customers, bookings, new Set(['b']));
  it('counts each tab', () => {
    expect(tabCounts(list)).toEqual({ all: 3, 'in-spa': 1, upcoming: 1, owes: 1, members: 1, vip: 0 });
    expect(list.filter(TABS['in-spa']).map((c) => c.id)).toEqual(['b']);
  });
  it('matches phones ignoring spaces, dashes and +977', () => {
    expect(matchesSearch(list[0], '984 112')).toBe(true);
    expect(matchesSearch(list[0], '+977 98411')).toBe(true);
    expect(matchesSearch(list[0], '0984-112-0921')).toBe(true);
    expect(matchesSearch(list[1], '98012')).toBe(true);
    expect(matchesSearch(list[0], '98012')).toBe(false);
    expect(matchesSearch(list[1], 'bim@x')).toBe(true);
    expect(matchesSearch(list[0], 'aar')).toBe(true);
    expect(phoneSearchDigits('+977 984-12')).toBe('98412');
  });
  it('sorts with missing values last and name as the tie-break', () => {
    expect(sortCustomers(list, 'next').map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(sortCustomers(list, 'balance').map((c) => c.id)).toEqual(['c', 'a', 'b']);
    expect(sortCustomers(list, 'name', 'desc').map((c) => c.id)).toEqual(['c', 'b', 'a']);
    expect(sortCustomers(list, 'last').map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('labels', () => {
  it('relativeDayLabel', () => {
    expect(relativeDayLabel(TODAY, TODAY)).toBe('Today');
    expect(relativeDayLabel('2026-10-16', TODAY)).toBe('Tomorrow');
    expect(relativeDayLabel('2026-10-14', TODAY)).toBe('Yesterday');
    expect(relativeDayLabel('2026-10-24', TODAY)).toBe('Sat 24 Oct');
    expect(relativeDayLabel('2026-06-02', TODAY)).toBe('2 Jun');
    expect(relativeDayLabel('2025-06-02', TODAY)).toBe('2 Jun 2025');
    expect(daysBetween('2026-10-01', TODAY)).toBe(14);
  });
});
