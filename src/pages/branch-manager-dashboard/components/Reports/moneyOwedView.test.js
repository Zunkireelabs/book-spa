import { describe, it, expect } from 'vitest';
import { responsibleOf, buildOwedTiles, ageBars, owedDelta, hasPreviousOwed, isEmptyOwed, TABS, owedExportRows, daysSinceNepal } from './moneyOwedView';

const data = {
  as_of: '2026-10-30',
  totals: { amount: 9750, count: 5, unpaid_count: 3, partial_count: 2, package_count: 0, customers: 5, largest_customer: 3500, oldest_days: 18, oldest_date: '2026-10-12', oldest_count: 2 },
  buckets: { d0_7: { count: 1, amount: 200 }, d8_30: { count: 4, amount: 9550 }, d31_60: { count: 0, amount: 0 }, d61: { count: 0, amount: 0 } },
  prev: { as_of: '2026-09-30', amount: 7650, count: 3 },
  rows: [{ customer_name: 'Wendy', customer_phone: '98', ref: 'BK-1', branch_name: 'Lazimpat', date: '2026-10-12', age_days: 18, service: 'Hot Stone', staff: 'Nabin', total: 3500, paid: 0, balance: 3500, kind: 'unpaid' }],
  by_customer: [{ name: 'Wendy', phone: '98', count: 1, last_date: '2026-10-12', oldest_days: 18, amount: 3500 }],
  by_branch: [{ name: 'Lazimpat', count: 3, oldest_days: 18, amount: 7000 }, { name: 'Sanepa', count: 2, oldest_days: 5, amount: 2750 }],
  by_staff: [{ name: 'Nabin', count: 1, amount: 3500 }],
};

describe('owedDelta', () => {
  it('owed going up is red, going down is green, in money not percent', () => {
    expect(owedDelta(9750, 7650)).toMatchObject({ dir: 'up', tone: 'bad', text: '▲ 2,100' });
    expect(owedDelta(5000, 7650)).toMatchObject({ dir: 'down', tone: 'good', text: '▼ 2,650' });
    expect(owedDelta(5, 5)).toMatchObject({ dir: 'flat', tone: 'flat' });
    expect(owedDelta(null, 5)).toBeNull();
  });
});

describe('tiles', () => {
  const t = Object.fromEntries(buildOwedTiles(data).map((x) => [x.key, x]));
  it('match the mockup scene', () => {
    expect(t.owed).toMatchObject({ value: '9,750', lead: true, prevText: 'vs 7,650 on 30 Sep' });
    expect(t.owed.delta.tone).toBe('bad');
    expect(t.count).toMatchObject({ value: '5', prevText: '3 unpaid · 2 part paid' });
    expect(t.customers).toMatchObject({ value: '5', prevText: 'largest: 3,500' });
    expect(t.oldest).toMatchObject({ value: '18 days', prevText: '12 Oct · 2 bookings' });
    expect(t.over30).toMatchObject({ value: '0', prevText: 'NPR 0' });
  });
  it('no previous data: no delta and no "vs 0"', () => {
    const none = { ...data, prev: { as_of: '2026-09-30', amount: 0, count: 0 } };
    expect(hasPreviousOwed(none)).toBe(false);
    expect(buildOwedTiles(none)[0]).toMatchObject({ delta: null, prevText: '' });
  });
  it('packages show in the sub line when owed', () => {
    expect(buildOwedTiles({ ...data, totals: { ...data.totals, package_count: 1 } })[1].prevText).toBe('3 unpaid · 2 part paid · 1 package');
  });
});

describe('age bars', () => {
  it('four buckets that add up to the total', () => {
    const bars = ageBars(data);
    expect(bars.map((b) => b.label)).toEqual(['0–7 days', '8–30 days', '31–60 days', 'Over 60 days']);
    expect(bars.reduce((s, b) => s + b.amount, 0)).toBe(9750);
    expect(bars.reduce((s, b) => s + b.count, 0)).toBe(5);
    expect(bars[1].share).toBeCloseTo(0.979, 2);
  });
});

describe('tabs, empty, export', () => {
  it('By branch only with more than one branch', () => {
    expect(TABS(data, 2).map((t) => t.id)).toEqual(['booking', 'customer', 'branch', 'staff', 'responsible', 'settled']);
    expect(TABS(data, 1).map((t) => t.id)).toEqual(['booking', 'customer', 'staff', 'responsible', 'settled']);
    expect(TABS({ ...data, by_branch: [data.by_branch[0]] }, 3).map((t) => t.id)).toContain('branch'); // owed rows in one branch only, still a multi-branch account
  });
  it('empty when nothing is owed', () => {
    expect(isEmptyOwed({ totals: { count: 0 } })).toBe(true);
    expect(isEmptyOwed(data)).toBe(false);
    expect(isEmptyOwed(null)).toBe(true);
  });
  it('exports the tab that is showing, with the industry word for staff', () => {
    expect(owedExportRows(data, 'booking', 'Therapist')[0]).toContain('Therapist');
    expect(owedExportRows(data, 'booking')[1][11]).toBe(3500);
    expect(owedExportRows(data, 'booking')[1][8]).toBe('Unassigned');
    expect(owedExportRows({ ...data, by_responsible: [{ name: null, count: 2, oldest_days: 18, amount: 5500 }] }, 'responsible')[1]).toEqual(['Unassigned', 2, 18, 5500]);
    expect(owedExportRows(data, 'customer')[1]).toEqual(['Wendy', '98', 1, '2026-10-12', 18, 3500]);
    expect(owedExportRows(data, 'branch').length).toBe(3);
    expect(owedExportRows(data, 'staff', 'Stylist')[0][0]).toBe('Stylist');
  });
});

describe('responsible person', () => {
  it('shows Unassigned when the due holder is empty', () => {
    expect(responsibleOf({ responsible: null })).toBe('Unassigned');
    expect(responsibleOf({ responsible: 'Sita' })).toBe('Sita');
  });
});

describe('daysSinceNepal', () => {
  it('counts whole Nepal calendar days, whatever the time of day (15 Oct → 15 d on 30 Oct, 12 Oct → 18 d)', () => {
    for (const t of ['2026-10-30T00:30:00+05:45', '2026-10-30T12:00:00+05:45', '2026-10-30T23:59:00+05:45']) {
      expect(daysSinceNepal('2026-10-15', new Date(t))).toBe(15);
      expect(daysSinceNepal('2026-10-12', new Date(t))).toBe(18);
    }
  });
  it('uses the Nepal date, not UTC (18:30 UTC on 29 Oct is already 30 Oct in Nepal)', () => {
    expect(daysSinceNepal('2026-10-15', new Date('2026-10-29T18:30:00Z'))).toBe(15);
  });
  it('is 0 for today and never negative for a future date', () => {
    expect(daysSinceNepal('2026-10-30', new Date('2026-10-30T09:00:00+05:45'))).toBe(0);
    expect(daysSinceNepal('2026-11-02', new Date('2026-10-30T09:00:00+05:45'))).toBe(0);
  });
});
