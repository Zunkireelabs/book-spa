import { describe, it, expect } from 'vitest';
import { scoreBars, holdsBack, outcomes, servicesDelivered, pctShares, notClosedByService, didntHappen, servicesCsvRows, weekLabels, csvRows, kpiTiles, noPrevLine, clockedNote, attendanceFlag, rankOf } from './therapistInnerView';
import { buildRows } from '../Reports/therapistPerformanceView';

const govinda = { therapist_id: 'g', name: 'Govinda L.', service_sales: 17400, completed: 6, due: 18, bookings: 19, no_show: 0, customers: 6, rebooked: 5, rebook_rate: 0.833, booked_min: 1248, working_min: 15060, busy: 0.083, att_days: 2, att_present: 2 };
const top = { therapist_id: 'g', service_sales: 17400 };

describe('scoreBars', () => {
  const rows = buildRows({ therapists: [govinda] });
  const bars = scoreBars(rows[0], 17400);
  it('shows value / max with sub-labels and amber below half', () => {
    expect(bars.map((b) => [b.key, b.max])).toEqual([['sales', 40], ['completion', 25], ['attendance', 20], ['busy', 15]]);
    expect(bars[0].sub).toBe('top earner');
    expect(bars[1].sub).toBe('6 of 18 due');
    expect(bars[1].amber).toBe(true);
    expect(bars[0].amber).toBe(false);
    expect(bars[3].amber).toBe(true);
  });
  it('greys out a part with no data', () => {
    const r = buildRows({ therapists: [{ ...govinda, att_days: 0, att_present: 0, busy: null }] })[0];
    const b = scoreBars(r, 17400);
    expect(b[2]).toMatchObject({ na: true, sub: 'n/a, not marked', note: 'rest rescaled' });
    expect(b[3]).toMatchObject({ na: true, sub: 'n/a, no hours set' });
  });
});

describe('outcomes', () => {
  const now = 1000;
  const list = [
    { date: '2026-10-16', status: 'Confirmed', endMs: 500, final: 100, atStake: 60, paidAmt: 40 }, { date: '2026-10-20', status: 'Pending', endMs: 900, final: 50, atStake: 50, paidAmt: 0 },
    { date: '2026-10-29', status: 'Confirmed', endMs: 5000, final: 70 }, { date: '2026-10-02', status: 'Completed', final: 9 },
    { date: '2026-10-03', status: 'Cancelled' }, { date: '2026-10-04', status: 'No Show' },
  ];
  const o = outcomes(list, now);
  it('counts and open list', () => {
    expect(o).toMatchObject({ completed: 1, notClosed: 2, cancelled: 1, noShow: 1, total: 6, openValue: 150, openAtStake: 110, openPaid: 40 });
    expect(o.openByStatus).toEqual({ Confirmed: 1, Pending: 1 });
    expect(o.openInfo).toEqual({ count: 2, firstDate: '2026-10-16', lastDate: '2026-10-20' });
  });
  it('every booking is in exactly one bucket, a booking not ended yet is upcoming', () => {
    expect(o.upcoming).toBe(1);
    expect(o.completed + o.notClosed + o.cancelled + o.noShow + o.upcoming).toBe(o.total);
    expect(o.coming).toHaveLength(1);
  });
  it('holdsBack when completion is the lowest part and bookings are not closed', () => {
    const r = buildRows({ therapists: [govinda] })[0];
    expect(holdsBack(r, o.openInfo)).toEqual({ count: 2, from: '2026-10-16', to: '2026-10-20' });
    expect(holdsBack(r, { count: 0 })).toBeNull();
  });
});

describe('servicesDelivered', () => {
  it('rows sum to service sales, owed flag, share', () => {
    const s = servicesDelivered([
      { status: 'Completed', service: 'A', final: 6000, paid: 6000 }, { status: 'Completed', service: 'A', final: 800, paid: 800 },
      { status: 'Completed', service: 'B', final: 2000, paid: 0 }, { status: 'Cancelled', service: 'C', final: 999, paid: 0 },
    ]);
    expect(s.total).toEqual({ done: 3, sales: 8800, minutes: 0 });
    expect(s.rows.map((r) => [r.name, r.done, r.sales, r.owed])).toEqual([['A', 2, 6800, false], ['B', 1, 2000, true]]);
    expect(Math.round(s.rows[0].share * 100)).toBe(77);
  });
});

describe('weekLabels', () => {
  it('names every week by its range, cut by the period', () => {
    expect(weekLabels(['2026-09-28', '2026-10-05', '2026-10-26'], '2026-10-01', '2026-10-30')).toEqual(['1–4 Oct', '5–11 Oct', '26–30 Oct']);
  });
});

describe('csvRows / rank / notes', () => {
  it('one row per booking, owed only on Completed', () => {
    const r = csvRows([{ date: '2026-10-02', start: '10:00', customer: 'X', service: 'S', status: 'Completed', final: 2000, paid: 0 }, { date: '2026-10-03', start: '11:00', customer: 'Y', service: 'S', status: 'Confirmed', final: 500, paid: 0 }]);
    expect(r).toHaveLength(3);
    expect(r[1]).toEqual(['2026-10-02', '10:00', 'X', 'S', 'Completed', 2000, 0, 2000]);
    expect(r[2][7]).toBe(0);
  });
  it('ranks by the report ranking', () => {
    const rows = buildRows({ therapists: [govinda, { ...govinda, therapist_id: 'z', name: 'Z', service_sales: 100, completed: 1, due: 1 }] });
    expect(rankOf(rows, 'g')).toEqual({ rank: 1, of: 2 });
  });
  it('clocked note and attendance flag', () => {
    expect(clockedNote({ totals: { clockDays: 1, clockDates: [{ date: '2026-10-26' }], noTimeDates: ['2026-10-27'] } })).toBe('on 1 day with clock times (26 Oct); 27 Oct present, no clock times');
    expect(clockedNote({ totals: { clockDays: 0, clockDates: [], noTimeDates: [] } })).toBe('no attendance marked');
    expect(attendanceFlag(2, 25)).toMatch(/only 2 days/);
    expect(attendanceFlag(10, 25)).toBeNull();
  });
  it('previous-period line only when nothing to compare', () => {
    expect(noPrevLine(null, { from: '2026-09-01', to: '2026-09-30' }, 'Govinda')).toMatch(/No change vs 1–30 Sep/);
    expect(noPrevLine({ bookings: 3 }, { from: '2026-09-01', to: '2026-09-30' }, 'G')).toBeNull();
  });
  it('tiles carry the team marker, green at/above team, amber below', () => {
    const r = buildRows({ therapists: [govinda] })[0];
    const t = kpiTiles(r, { active: 25, service_sales: 119150, avg_ticket: 2837, busy: 0.046, rebook_rate: 0.59 }, null, { paidRevenue: 15400, owed: 2000, statusSplit: { noShow: 0, cancelled: 1, notClosed: 12 } });
    expect(t.filter((x) => x.marker).map((x) => x.key + x.marker.good)).toEqual(['salestrue', 'busytrue', 'rebooktrue']);
    expect(t[0].delta).toBeNull();
  });
});

describe('pctShares', () => {
  it('adds up to 100 (largest remainder), ties go to the earlier row', () => {
    expect(pctShares([6800, 3000, 2800, 2800, 2000])).toEqual([39, 17, 16, 16, 12]); // plain rounding gives 99
    expect(pctShares([1, 1, 1])).toEqual([34, 33, 33]);
    expect(pctShares([5])).toEqual([100]);
    expect(pctShares([0, 0])).toEqual([0, 0]);
  });
});

describe('services tab', () => {
  const list = [
    { date: '2026-10-02', start: '10:00', status: 'Completed', service: 'Hot Stone', final: 3500, paid: 3500, minutes: 90 },
    { date: '2026-10-03', start: '10:00', status: 'Completed', service: 'Hot Stone', final: 3300, paid: 0, minutes: 90 },
    { date: '2026-10-05', start: '10:00', status: 'Completed', service: 'Couples', final: 2250, paid: 2250, minutes: 120, others: ['Wangmo Q.'] },
    { date: '2026-10-16', start: '10:00', status: 'Confirmed', service: 'Couples', final: 2250, endMs: 1, atStake: 0, paidAmt: 4500, others: ['Wangmo Q.'] },
    { date: '2026-10-30', start: '10:00', status: 'Confirmed', service: 'Couples', final: 2250, endMs: 1, atStake: 2250, paidAmt: 0 },
    { date: '2026-10-19', start: '10:00', status: 'Confirmed', service: 'Thai', final: 3000, endMs: 1, atStake: 3000, paidAmt: 0 },
    { date: '2026-10-22', start: '10:00', status: 'Confirmed', service: 'Thai', final: 2300, endMs: 1, atStake: 2300, paidAmt: 0 },
    { date: '2026-10-26', start: '10:00', status: 'Pending', service: 'Foot', final: 900, endMs: 1, atStake: 900, paidAmt: 0 },
    { date: '2026-10-15', start: '13:30', status: 'Cancelled', service: 'Swedish', final: 2000 },
    { date: '2026-10-14', start: '09:00', status: 'No Show', service: 'Thai', final: 3000 },
    { date: '2026-11-20', start: '09:00', status: 'Confirmed', service: 'Thai', final: 3000, endMs: 9e15 },
  ];
  it('services: avg, hours (combo full length), shares add up to 100', () => {
    const s = servicesDelivered(list);
    expect(s.rows[0]).toMatchObject({ name: 'Hot Stone', done: 2, sales: 6800, avg: 3400, minutes: 180, owed: true });
    expect(s.rows[1]).toMatchObject({ name: 'Couples', sales: 2250, minutes: 120 });
    expect(s.total).toEqual({ done: 3, sales: 9050, minutes: 300 });
    expect(s.rows.reduce((n, r) => n + r.pct, 0)).toBe(100);
  });
  it('not closed grouped by service with date notes', () => {
    const nc = notClosedByService(outcomes(list, 1e12).open);
    expect(nc.rows.map((r) => [r.name, r.bookings, r.atStake, r.dates])).toEqual([
      ['Thai', 2, 5300, '19, 22 Oct'],
      ['Couples', 2, 2250, '16 Oct (with Wangmo Q., paid) · 30 Oct'],
      ['Foot', 1, 900, '26 Oct (Pending)'],
    ]);
    expect(nc.total).toBe(8450);
  });
  it("didn't happen: one line per booking, cancelled vs no-show", () => {
    expect(didntHappen(list)).toEqual([
      { service: 'Thai', date: '2026-10-14', start: '09:00', kind: 'noShow' },
      { service: 'Swedish', date: '2026-10-15', start: '13:30', kind: 'cancelled' },
    ]);
  });
  it('csv = what the tab shows', () => {
    const r = servicesCsvRows(list, 1e12);
    expect(r[0][0]).toBe('Section');
    expect(r[1]).toEqual(['Services delivered', 'Hot Stone', 2, 3400, 180, 6800, '']);
    expect(r.filter((x) => x[0] === 'Not closed yet')).toHaveLength(3);
    expect(r.filter((x) => x[0] === 'Coming up')).toHaveLength(1);
    expect(r.find((x) => x[0] === 'No-show')[6]).toBe('14 Oct 09:00');
  });
});
