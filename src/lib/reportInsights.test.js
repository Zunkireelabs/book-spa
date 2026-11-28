import { describe, it, expect } from 'vitest';
import { businessHealthInsights, hasPreviousData } from './reportInsights';

const branch = (name, share, booked, working) => ({ name, current: { busy: { share, booked_min: booked, working_min: working } } });
const base = (over = {}) => ({
  current: { cancelled: 2, avg_ticket: 800, top_service: { name: 'Thai 90 min', share: 0.31 } },
  previous: { made: 10, sales: 100, cancelled: 2, avg_ticket: 800 },
  branches: [branch('Lazimpat', 0.71, 66240, 93300), branch('Sanepa', 0.48, 18720, 39000)],
  computed_at: '2026-10-30T09:07:00Z',
  ...over,
});
const rules = (d, o) => businessHealthInsights(d, o).map((i) => i.rule);

describe('busy gap', () => {
  it('fires at a 15+ point gap with the quiet branch under 50%, and carries the exact numbers', () => {
    const [i] = businessHealthInsights(base(), { staffLabel: 'Therapist', periodLabel: 'Last 30 days' });
    expect(i.rule).toBe('busy_gap');
    expect(i.headline).toBe('Sanepa was busy 48% of its hours');
    expect(i.detail).toContain('Lazimpat 71%');
    expect(i.detail).toContain('therapist');
    expect(i.why).toContain('312 h booked of 650 h working (48%)');
    expect(i.source).toMatch(/^From bookings \+ roster · Last 30 days · computed \d{1,2}:\d\d(am|pm)$/);
  });
  it('does not fire under 15 points, when nobody is under 50%, or with one branch / no hours', () => {
    expect(rules(base({ branches: [branch('A', 0.6, 1, 1), branch('B', 0.48, 1, 1)] }))).toEqual([]);
    expect(rules(base({ branches: [branch('A', 0.9, 1, 1), branch('B', 0.5, 1, 1)] }))).toEqual([]);
    expect(rules(base({ branches: [branch('A', 0.9, 1, 1)] }))).toEqual([]);
    expect(rules(base({ branches: [branch('A', null, 0, 0), branch('B', 0.3, 1, 1)] }))).toEqual([]);
  });
});

describe('cancellations', () => {
  const d = (now, prev) => base({ branches: [], current: { cancelled: now, avg_ticket: 800 }, previous: { made: 10, sales: 100, cancelled: prev, avg_ticket: 800 } });
  it('fires at +30% and at least 5', () => {
    const [i] = businessHealthInsights(d(28, 17));
    expect(i.rule).toBe('cancellations');
    expect(i.headline).toBe('Cancellations rose to 28');
    expect(i.why).toContain('28 bookings were cancelled this period vs 17');
  });
  it('does not fire from a previous of 0 (a suggestion never says "from 0")', () => {
    expect(rules(d(9, 0))).toEqual([]);
  });
  it('does not fire under +30%, under 5, or without a previous figure', () => {
    expect(rules(d(20, 17))).toEqual([]);
    expect(rules(d(4, 1))).toEqual([]);
    expect(rules(base({ branches: [], previous: { made: 10, sales: 100, avg_ticket: 800 } }))).toEqual([]);
  });
});

describe('average ticket', () => {
  const d = (now, prev, top) => base({ branches: [], current: { cancelled: 0, avg_ticket: now, top_service: top }, previous: { made: 10, sales: 100, cancelled: 0, avg_ticket: prev } });
  it('names the top service and suggests, never states', () => {
    const [i] = businessHealthInsights(d(798, 759, { name: 'Thai 90 min', share: 0.31 }));
    expect(i.rule).toBe('average_ticket');
    expect(i.headline).toBe('Average ticket rose 5%');
    expect(i.detail).toContain('Thai 90 min taking 31%');
    expect(i.detail).toMatch(/may keep the trend/);
    expect(i.view).toBe('service-revenue');
  });
  it('a fall suggests looking, and does not name a service it does not have', () => {
    const [i] = businessHealthInsights(d(700, 800, null));
    expect(i.headline).toBe('Average ticket fell 12%');
    expect(i.detail).not.toMatch(/taking/);
    expect(i.detail).toMatch(/could show why/);
  });
  it('does not fire under 5%, or without a previous ticket', () => {
    expect(rules(d(804, 800, null))).toEqual([]);
    expect(rules(d(800, null, null))).toEqual([]);
  });
});

describe('no previous data', () => {
  it('comparison insights stay quiet, the busy gap still fires', () => {
    const none = base({ previous: { made: 0, sales: 0, cash_in: 0, cancelled: 0, avg_ticket: null }, current: { cancelled: 9, avg_ticket: 900, top_service: null } });
    expect(rules(none)).toEqual(['busy_gap']);
  });
  it('has data when any of bookings, sales or cash exist', () => {
    expect(hasPreviousData({ previous: { made: 0, sales: 0, cash_in: 5 } })).toBe(true);
    expect(hasPreviousData({ previous: { made: 0, sales: 0, cash_in: 0 } })).toBe(false);
    expect(hasPreviousData({})).toBe(false);
  });
});

describe('ranking', () => {
  it('returns at most 3, best score first, and nothing without data', () => {
    const all = base({ current: { cancelled: 28, avg_ticket: 1000, top_service: null }, previous: { made: 10, sales: 100, cancelled: 17, avg_ticket: 800 } });
    const out = businessHealthInsights(all);
    expect(out.length).toBe(3);
    expect(out.map((i) => i.score)).toEqual([...out.map((i) => i.score)].sort((a, b) => b - a));
    expect(businessHealthInsights(null)).toEqual([]);
    expect(businessHealthInsights({})).toEqual([]);
  });
});

import { moneyOwedInsights, reminderText, reminderAllText } from './reportInsights';

describe('money owed: balances passing 30 days', () => {
  const row = (over) => ({ customer_name: 'Wendy Sample', ref: 'BK-1', balance: 3500, age_days: 18, date: '2026-10-12', ...over });
  const data = (rows) => ({ as_of: '2026-10-30', rows, computed_at: '2026-10-30T09:07:00Z' });
  it('fires for balances 17-30 days old, with the dates they cross 30 and the exact rows in Why', () => {
    const [i] = moneyOwedInsights(data([row(), row({ customer_name: 'Lata', ref: 'BK-2', balance: 1000, age_days: 16 + 1, date: '2026-10-13' }), row({ age_days: 3, date: '2026-10-27' })]));
    expect(i.rule).toBe('passing_30');
    expect(i.headline).toBe('2 balances are 17–18 days old (NPR 4,500)');
    expect(i.detail).toContain('between 12 Nov and 13 Nov');
    expect(i.detail).toMatch(/may bring them in/);
    expect(i.why).toContain('Wendy Sample · BK-1: NPR 3,500, 18 days old');
    expect(i.remindRows).toHaveLength(2);
  });
  it('says "is" and "on" for a single balance', () => {
    const [i] = moneyOwedInsights(data([row()]));
    expect(i.headline).toBe('1 balance is 18 days old (NPR 3,500)');
    expect(i.detail).toContain('on 12 Nov');
  });
  it('does not fire when nothing is in that window (too new, or already past 30)', () => {
    expect(moneyOwedInsights(data([row({ age_days: 16 }), row({ age_days: 31 })]))).toEqual([]);
    expect(moneyOwedInsights(data([]))).toEqual([]);
    expect(moneyOwedInsights(null)).toEqual([]);
  });
});

describe('reminder text', () => {
  const r = { customer_name: 'Wendy Sample', ref: 'BK-20261012-0003', balance: 3500, date: '2026-10-12' };
  it('names the customer, booking and balance, in plain industry-neutral words', () => {
    const t = reminderText(r);
    expect(t).toContain('Wendy Sample');
    expect(t).toContain('NPR 3,500');
    expect(t).toContain('BK-20261012-0003');
    expect(t).toContain('12 Oct');
    expect(t).not.toMatch(/therapist|spa|appointment|massage/i);
  });
  it('copes with a missing name or reference', () => {
    expect(reminderText({ balance: 100, date: '2026-10-12' })).toMatch(/^Hello, a gentle reminder: NPR 100 is still due for your visit on 12 Oct\./);
  });
  it('Remind all gives one block per balance', () => {
    expect(reminderAllText([r, { ...r, customer_name: 'Lata' }]).split('\n\n')).toHaveLength(2);
  });
});
