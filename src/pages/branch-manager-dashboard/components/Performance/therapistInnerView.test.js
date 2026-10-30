import { describe, it, expect } from 'vitest';
import { scoreBars, holdsBack, outcomes, servicesDelivered, weekLabels, csvRows, kpiTiles, noPrevLine, clockedNote, attendanceFlag, rankOf } from './therapistInnerView';
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
    { date: '2026-10-16', status: 'Confirmed', endMs: 500, final: 100 }, { date: '2026-10-20', status: 'Pending', endMs: 900, final: 50 },
    { date: '2026-10-29', status: 'Confirmed', endMs: 5000, final: 70 }, { date: '2026-10-02', status: 'Completed', final: 9 },
    { date: '2026-10-03', status: 'Cancelled' }, { date: '2026-10-04', status: 'No Show' },
  ];
  const o = outcomes(list, now);
  it('counts and open list', () => {
    expect(o).toMatchObject({ completed: 1, notClosed: 2, cancelled: 1, noShow: 1, total: 6, openValue: 150 });
    expect(o.openByStatus).toEqual({ Confirmed: 1, Pending: 1 });
    expect(o.openInfo).toEqual({ count: 2, firstDate: '2026-10-16', lastDate: '2026-10-20' });
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
    expect(s.total).toEqual({ done: 3, sales: 8800 });
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
    expect(clockedNote([{ date: '2026-10-26', hours: 1.5, assumed: false }, { date: '2026-10-27', hours: 12, assumed: true }])).toBe('attendance marked on 26 Oct (1.5\u00A0h) and 27 Oct (no times, 12\u00A0h assumed)');
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
