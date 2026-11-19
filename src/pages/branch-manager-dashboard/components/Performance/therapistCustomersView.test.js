import { describe, it, expect } from 'vitest';
import { build, tiles, suggestions, rebookSplit, statusChip, withCell, elsewhere, againCell, csvRows, searchRows, openDates } from './therapistCustomersView';

const bk = (group, date, extra = {}) => ({ id: `${group}${date}`, date, start: '10:00', service: 'S', minutes: 60, price: 1000, group, status: 'X', payment_status: 'unpaid', paid_amount: 0, ...extra });
const cu = (name, bookings, extra = {}) => ({ key: name, customer_id: name, name, phone: '+977', sales: 0, owed: 0, last_served: null, booked_again: null, first_visit: null, next_booking: null, type: 'not_served', bookings, ...extra });
const again = (t, me) => ({ date: '2026-10-20', service: 'Y', therapist: t, with_this_therapist: me });
const rows = [
  cu('A', [bk('completed', '2026-10-02')], { sales: 3500, last_served: '2026-10-02', type: 'new', booked_again: again('Anil T.', false) }),
  cu('B', [bk('completed', '2026-10-03'), bk('not_closed', '2026-10-16')], { sales: 2800, type: 'new', booked_again: again(null, null) }),
  cu('C', [bk('completed', '2026-10-04', { payment_status: 'unpaid' })], { sales: 2000, owed: 2000, type: 'returning', booked_again: again('Nabin C.', false) }),
  cu('D', [bk('completed', '2026-10-05')], { sales: 1000, type: 'new', booked_again: again('Govinda L.', true) }),
  cu('E', [bk('completed', '2026-10-06')], { sales: 500, type: 'new', last_served: '2026-10-06' }),
  cu('F', [bk('not_closed', '2026-10-17'), bk('not_closed', '2026-10-19')]),
  cu('G', [bk('not_closed', '2026-10-15', { status: 'Pending' })]),
  cu('H', [bk('upcoming', '2026-11-02')]),
  cu('I', [bk('cancelled', '2026-10-09')]),
  cu('J', [bk('no_show', '2026-10-09')]),
];

describe('build', () => {
  const v = build(rows);
  it('groups: served by sales, not closed oldest first, upcoming, cancelled', () => {
    expect(v.served.map((c) => c.name)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(v.notClosed.map((c) => c.name)).toEqual(['G', 'F']);
    expect(v.upcoming.map((c) => c.name)).toEqual(['H']);
    expect(v.cancelled.map((c) => c.name)).toEqual(['I', 'J']);
  });
  it('booked = served + not closed only + upcoming only (Pending counts, cancelled / no-show do not)', () => {
    expect(v.counts).toEqual({ booked: 8, served: 5, notClosed: 2, upcoming: 1, cancelled: 2 });
  });
});

describe('not closed order', () => {
  it('sorts by date, then time of day', () => {
    const v = build([cu('Late', [bk('not_closed', '2026-10-30', { start: '16:45' })]), cu('Early', [bk('not_closed', '2026-10-30', { start: '13:15' })]), cu('Older', [bk('not_closed', '2026-10-29', { start: '18:00' })])]);
    expect(v.notClosed.map((c) => c.name)).toEqual(['Older', 'Early', 'Late']);
  });
});

describe('booked again split + tiles', () => {
  const v = build(rows);
  it('splits with this therapist / other / not assigned', () => {
    expect(rebookSplit(v.served)).toEqual({ served: 5, again: 4, withMe: 1, other: 2, unassigned: 1 });
  });
  it('tile text; "—" under 5 served', () => {
    const t = tiles(v, 'Govinda');
    expect(t.again.value).toBe('80%');
    expect(t.again.line).toContain('1 with Govinda, 2 with other therapists, 1 not assigned yet');
    expect(t.newToSpa).toEqual({ value: 4, of: 5 });
    expect(t.owed).toMatchObject({ total: 2000, customers: 1 });
    expect(tiles(build(rows.slice(0, 3)), 'G').again.value).toBe('—');
  });
});

describe('✦ rules', () => {
  it('rebook flag when none / under half are with this person', () => {
    const s = suggestions(build(rows), 'Govinda');
    expect(s[0].key).toBe('rebook');
    expect(s[0].text).toContain('only 1 with Govinda');
  });
  it('no rebook flag when half or more are with this person; owed flag names the largest', () => {
    const r2 = rows.map((c) => (c.name === 'A' || c.name === 'C' ? { ...c, booked_again: again('Govinda L.', true) } : c));
    const s = suggestions(build(r2), 'Govinda');
    expect(s.find((x) => x.key === 'rebook')).toBeUndefined();
    expect(s[0]).toMatchObject({ key: 'owed', name: 'C' });
  });
});

describe('labels, sentences, csv', () => {
  const v = build(rows);
  it('status chips', () => {
    expect(statusChip(bk('completed', 'd', { payment_status: 'paid' })).text).toBe('Completed · paid');
    expect(statusChip(bk('not_closed', 'd', { paid_amount: 500 })).text).toBe('Not closed · paid ahead');
    expect(statusChip(bk('not_closed', 'd')).text).toBe('Not closed');
    expect(statusChip(bk('no_show', 'd')).text).toBe('No-show');
  });
  it('with-cell words and open dates', () => {
    expect(withCell(v.served[1])).toEqual(['1 served', '1 not closed']);
    expect(openDates(v.notClosed[1])).toBe('17, 19 Oct');
    expect(openDates(v.notClosed[0])).toBe('15 Oct (Pending)');
  });
  it('sentences carry no totals; booked again says with whom', () => {
    const l = elsewhere({ ...v.served[1], first_visit: { date: '2026-10-14', service: 'HS', therapist: 'Jagat P.' }, next_booking: null }, 'Govinda');
    expect(l.map((x) => x.k)).toEqual(['First visit', 'Booked again', 'Next booking']);
    expect(l[1].v).toContain('(no therapist yet)');
    expect(l[2].v).toBe('none after today');
  });
  it('booked again cell', () => {
    expect(againCell(v.served[0], '2026-10-30').text).toBe('Yes · 20 Oct · Anil T.');
    expect(againCell(v.served[4], '2026-10-06').text).toBe('No · served today');
    expect(againCell(v.notClosed[0], '2026-10-30').text).toBe('—');
  });
  it('csv: one row per customer', () => {
    const c = csvRows([...v.served, ...v.notClosed]);
    expect(c).toHaveLength(1 + 7);
    expect(c[1].slice(0, 7)).toEqual(['A', '+977', 1, 1, 0, 3500, 0]);
    expect(c[2][4]).toBe(1);
  });
  it('search by name or phone', () => {
    expect(searchRows(v.served, 'b').map((c) => c.name)).toEqual(['B']);
    expect(searchRows(v.served, '977')).toHaveLength(5);
  });
});
