import { describe, it, expect } from 'vitest';
import { scoreParts, scoreFormula, tierOf, TIERS, buildRows, sortRows, searchRows, buildTiles, exportRows, isEmptyPerformance, hasPrevious, DEFAULT_SORT } from './therapistPerformanceView';
import { therapistPerformanceInsights } from 'lib/reportInsights';

const row = (o = {}) => ({
  therapist_id: o.id || 'a', name: 'A', branch_id: 'b1', branch_name: 'Lazimpat', service_sales: 1000, completed: 10, bookings: 10, due: 10, no_show: 0, avg_ticket: 100,
  customers: 8, rebooked: 4, rebook_rate: 0.5, booked_min: 600, working_min: 1000, busy: 0.6, att_days: 10, att_present: 10, top_services: [], sales_by_week: [500, 500], ...o,
});

describe('score', () => {
  it('uses the old weights: sales vs the top earner 40 + completion 25 + attendance 20 + busy 15', () => {
    const { parts, score } = scoreParts(row({ service_sales: 500, completed: 8, bookings: 10, due: 10, att_present: 9, att_days: 10, busy: 0.5 }), 1000);
    expect(parts).toEqual({ sales: 20, completion: 20, attendance: 18, busy: 7.5 });
    expect(score).toBe(66); // 65.5 rounds up
  });
  it('the top earner with a perfect record scores 100, and the score never leaves 0..100', () => {
    expect(scoreParts(row({ completed: 10, bookings: 10, busy: 1 }), 1000).score).toBe(100);
    expect(scoreParts(row({ service_sales: 0, completed: 0, bookings: 0, att_present: 0, att_days: 5, busy: null }), 0).score).toBe(0);
    expect(scoreParts(row({ busy: 3 }), 1000).score).toBeLessThanOrEqual(100);
  });
  it('completion = Completed ÷ due: future and No Show bookings are not in the denominator, so 8 of 10 due beats 8 of 14 booked', () => {
    const base = { service_sales: 1000, att_days: 0, att_present: 0, busy: 0 };
    expect(scoreParts(row({ ...base, completed: 8, bookings: 14, due: 10 }), 1000).parts.completion).toBe(20);
    expect(scoreParts(row({ ...base, completed: 0, bookings: 3, due: 0 }), 1000).parts.completion).toBe(0); // nothing due yet: no divide by zero
  });
  it('no attendance marked: that part is n/a and the other three are rescaled (÷ 80 × 100)', () => {
    const { parts, score } = scoreParts(row({ service_sales: 1000, completed: 10, due: 10, att_days: 0, att_present: 0, busy: 0.5 }), 1000);
    expect(parts.attendance).toBeNull();
    expect(score).toBe(Math.round(((40 + 25 + 7.5) / 80) * 100)); // 91, not 72.5 + 20 free points
  });
  it('no working hours: busy is n/a and the other three are rescaled (÷ 85 × 100)', () => {
    const { parts, score } = scoreParts(row({ service_sales: 500, completed: 10, due: 10, att_present: 10, att_days: 10, busy: null }), 1000);
    expect(parts.busy).toBeNull();
    expect(score).toBe(Math.round(((20 + 25 + 20) / 85) * 100));
  });
  it('neither attendance nor hours: rescaled over sales + completion only; all four present keeps the plain sum', () => {
    expect(scoreParts(row({ service_sales: 1000, completed: 5, due: 10, att_days: 0, att_present: 0, busy: null }), 1000).score).toBe(Math.round(((40 + 12.5) / 65) * 100));
    expect(scoreParts(row({ service_sales: 500, completed: 8, due: 10, att_present: 9, att_days: 10, busy: 0.5 }), 1000).score).toBe(66);
  });
  it('the formula says n/a for a missing part', () => {
    expect(scoreFormula({ sales: 40, completion: 25, attendance: null, busy: 12 })).toBe('sales 40 + completion 25 + attendance n/a + busy 12 (rescaled to 100)');
  });
  it('shows the formula with one decimal', () => {
    expect(scoreFormula({ sales: 40, completion: 24.26, attendance: 19.6, busy: 12.34 })).toBe('sales 40 + completion 24.3 + attendance 19.6 + busy 12.3');
  });
});

describe('completion with a due count that lags (today\'s later bookings are not yet due)', () => {
  it('a booking closed early cannot push completion past 100%', () => {
    expect(scoreParts(row({ service_sales: 1000, completed: 5, due: 4, att_days: 0, att_present: 0, busy: 0 }), 1000).parts.completion).toBe(25);
  });
});

describe('one score per person across branch blocks', () => {
  it('buildRows on a branch block scores against that branch; the report must reuse the team score for the same person', () => {
    const team = buildRows({ therapists: [row({ id: 'a', service_sales: 1000 }), row({ id: 'b', service_sales: 400, busy: 0.2 })] });
    const branch = buildRows({ therapists: [row({ id: 'b', service_sales: 400, busy: 0.2 })] }); // alone in the branch, so it is its own top earner
    const teamB = team.find((r) => r.id === 'b'); const branchB = branch[0];
    expect(branchB.score).toBeGreaterThan(teamB.score); // re-scoring inside the branch would inflate it: the report overrides with teamB
    expect(teamB.rank).toBe(2);
  });
});

describe('tiers', () => {
  it.each([[100, 'Top performer'], [85, 'Top performer'], [84, 'Strong'], [70, 'Strong'], [69, 'Average'], [55, 'Average'], [54, 'Needs support'], [0, 'Needs support']])('%i is %s', (s, label) => {
    expect(tierOf(s).label).toBe(label);
  });
  it('the lowest tier is amber, never red', () => {
    const low = TIERS[TIERS.length - 1];
    expect(low.cls).toContain('warning');
    expect(TIERS.some((t) => /error|red/.test(t.cls))).toBe(false);
  });
});

const block = { therapists: [
  row({ id: 'a', name: 'Asha', service_sales: 1000, busy: 0.9 }),
  row({ id: 'b', name: 'Bina', service_sales: 600, busy: 0.3, rebook_rate: null, avg_ticket: null, att_days: 0, att_present: 0 }),
  row({ id: 'c', name: 'Chhaya', service_sales: 600, busy: null, no_show: 3, bookings: 10 }),
] };
const prev = { therapists: [row({ id: 'a', service_sales: 800 })] };

describe('rows, sort, search', () => {
  it('ranks by score, then service sales, then name; the top earner is the 100% of sales', () => {
    const rows = buildRows(block, prev);
    // Chhaya has no hours (busy left out, 69 of 85 -> 81) and beats Bina, who has no attendance and low busy (53.5 of 80 -> 67)
    expect(rows.map((r) => r.name)).toEqual(['Asha', 'Chhaya', 'Bina']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(rows[0].parts.sales).toBe(40);
    expect(rows[2].parts.sales).toBe(24);
  });
  it('carries the sales change vs the previous period (none when they had no previous row)', () => {
    const rows = buildRows(block, prev);
    expect(rows[0].salesDelta.text).toBe('▲ 25%');
    expect(rows[2].salesDelta).toBeNull();
  });
  it('every column sorts; missing values (no hours, under 5 customers) go last in both directions', () => {
    const rows = buildRows(block, prev);
    expect(sortRows(rows, { key: 'busy', dir: 'desc' }).map((r) => r.name)).toEqual(['Asha', 'Bina', 'Chhaya']);
    expect(sortRows(rows, { key: 'busy', dir: 'asc' }).map((r) => r.name)).toEqual(['Bina', 'Asha', 'Chhaya']);
    expect(sortRows(rows, { key: 'rebook', dir: 'asc' }).map((r) => r.name).at(-1)).toBe('Bina');
    expect(sortRows(rows, { key: 'no_show', dir: 'desc' })[0].name).toBe('Chhaya');
    expect(sortRows(rows, { key: 'name', dir: 'asc' }).map((r) => r.name)).toEqual(['Asha', 'Bina', 'Chhaya']);
    expect(sortRows(rows, DEFAULT_SORT).map((r) => r.name)).toEqual(['Asha', 'Chhaya', 'Bina']);
  });
  it('searches by name, ignoring case and spaces around it', () => {
    const rows = buildRows(block, prev);
    expect(searchRows(rows, '  chh ').map((r) => r.name)).toEqual(['Chhaya']);
    expect(searchRows(rows, '')).toHaveLength(3);
    expect(searchRows(rows, 'zzz')).toHaveLength(0);
  });
});

const team = (o = {}) => ({ active: 4, service_sales: 4000, completed: 40, bookings: 50, no_show: 2, busy: 0.64, rebook_rate: 0.43, att_days: 10, att_present: 9, avg_ticket: 100, customers: 30, ...o });
const data = (cur = {}, pre = {}) => ({ current: { therapists: block.therapists, team: team(cur) }, previous: { therapists: prev.therapists, team: team({ service_sales: 3600, busy: 0.67, rebook_rate: 0.41, no_show: 3, ...pre }) }, weeks: ['2026-10-05', '2026-10-12'], branches: [] });

describe('tiles', () => {
  it('shows per-therapist sales, active, busy, rebook and no-show with the previous value', () => {
    const t = Object.fromEntries(buildTiles(data()).map((x) => [x.key, x]));
    expect(t.per_head.value).toBe('1,000');
    expect(t.per_head.prevText).toBe('vs 900');
    expect(t.per_head.delta.text).toBe('▲ 11%');
    expect(t.active.prevText).toBe('same as before');
    expect(t.busy.value).toBe('64%');
    expect(t.busy.delta.text).toBe('▼ 3 pts');
    expect(t.rebook.value).toBe('43%');
    expect(t.no_show.value).toBe('4%');
  });
  it('a falling no-show rate is good (green), a falling busy is bad', () => {
    const t = Object.fromEntries(buildTiles(data()).map((x) => [x.key, x]));
    expect(t.no_show.delta.dir).toBe('down');
    expect(t.no_show.delta.tone).toBe('good');
    expect(t.busy.delta.tone).toBe('bad');
  });
  it('no hours, no rebook data: says so instead of 0', () => {
    const t = Object.fromEntries(buildTiles(data({ busy: null, rebook_rate: null })).map((x) => [x.key, x]));
    expect(t.busy.value).toBe('No hours set');
    expect(t.rebook.value).toBe('—');
  });
  it('no previous data: no "vs" and no arrows', () => {
    const d = data(); d.previous = { therapists: [], team: team({ bookings: 0, service_sales: 0 }) };
    expect(hasPrevious(d)).toBe(false);
    for (const t of buildTiles(d)) { expect(t.delta).toBeNull(); expect(t.prevText).toBe(''); }
  });
  it('a previous period with only rostered therapists (no bookings, no sales) is not comparable', () => {
    const d = data(); d.previous = { therapists: [row()], team: team({ bookings: 0, service_sales: 0, active: 17 }) };
    expect(hasPrevious(d)).toBe(false);
    for (const t of buildTiles(d)) { expect(t.delta).toBeNull(); expect(t.prevText).toBe(''); }
  });
  it('an empty period is detected', () => {
    expect(isEmptyPerformance({ current: { therapists: [], team: team() } })).toBe(true);
    expect(isEmptyPerformance(data())).toBe(false);
  });
});

describe('CSV', () => {
  it('Ranking: header, one line per therapist as shown, then the team line', () => {
    const d = data();
    const rows = sortRows(buildRows(d.current, d.previous), DEFAULT_SORT);
    const csv = exportRows(d, 'ranking', rows, 'Therapist');
    expect(csv[0][0]).toBe('Therapist');
    expect(csv).toHaveLength(1 + 3 + 1);
    expect(csv[1][0]).toBe('Asha');
    expect(csv.at(-1)[0]).toBe('All');
    expect(csv.at(-1)[5]).toBe(4000);
  });
  it('Trend: one column per week and a total', () => {
    const d = data();
    const csv = exportRows(d, 'trend', buildRows(d.current, d.previous), 'Therapist');
    expect(csv[0]).toEqual(['Therapist', '2026-10-05', '2026-10-12', 'Total']);
    expect(csv[1].slice(1)).toEqual([500, 500, 1000]);
  });
});

describe('✦ rules', () => {
  const d = {
    computed_at: '2026-10-30T08:00:00Z',
    current: {
      team: team({ no_show: 2, bookings: 48 }),
      therapists: [
        row({ id: 'a', name: 'Asha T.', branch_name: 'Sanepa', busy: 0.36, booked_min: 360, working_min: 1000, no_show: 2, bookings: 24 }),
        row({ id: 'b', name: 'Bina', branch_name: 'Sanepa', busy: 0.3, no_show: 0 }),
        row({ id: 'c', name: 'Chhaya', branch_name: 'Sanepa', busy: 0.39 }),
        row({ id: 'd', name: 'Dolma', busy: 0.4 }),
        row({ id: 'e', name: 'Esha', busy: null, working_min: 0 }),
      ],
    },
  };
  it('busy < 40%: counts only therapists with hours, under the line, and says why', () => {
    const [i] = therapistPerformanceInsights(d, { staffLabel: 'Therapist', staffLabelPlural: 'Therapists' });
    expect(i.rule).toBe('low_busy');
    expect(i.headline).toBe('3 therapists were busy less than 40% of their hours');
    expect(i.detail).toContain('Bina 30% + 2 more, all Sanepa');
    expect(i.why).toContain('Asha T.: 36% (6 h of 16 h 40 min)');
    expect(i.why).not.toContain('Dolma');
    expect(i.why).not.toContain('Esha');
    expect(i.view).toBe('utilization');
  });
  it('no-show: needs 2+ no-shows and twice the team rate', () => {
    const items = therapistPerformanceInsights(d, {});
    const ns = items.find((x) => x.rule === 'no_show');
    expect(ns.headline).toBe("Asha T.'s no-show rate is 8.3%");
    expect(ns.detail).toContain('2 of 24');
    expect(ns.detail).toContain("the team's 4.2%");
    const one = { ...d, current: { ...d.current, therapists: [row({ id: 'z', name: 'Zed', no_show: 1, bookings: 4 })] } };
    expect(therapistPerformanceInsights(one, {}).find((x) => x.rule === 'no_show')).toBeUndefined(); // only 1 no-show
  });
  it('fires nothing without data, and wording is a suggestion', () => {
    expect(therapistPerformanceInsights(null, {})).toEqual([]);
    expect(therapistPerformanceInsights({ current: { therapists: [], team: team() } }, {})).toEqual([]);
    for (const i of therapistPerformanceInsights(d, {})) expect(i.detail).toMatch(/may|could/);
  });
});

describe('empty / null view model', () => {
  it('null or team-less data builds no tiles and no rows', () => {
    expect(buildTiles(null)).toEqual([]);
    expect(buildTiles({ current: null, previous: null })).toEqual([]);
    expect(buildRows(null)).toEqual([]);
    expect(buildRows({ therapists: [] })).toEqual([]);
  });
  it('null and empty-team data count as empty, with no previous', () => {
    expect(isEmptyPerformance(null)).toBe(true);
    expect(isEmptyPerformance({ current: { therapists: [], team: { active: 0 } } })).toBe(true);
    expect(hasPrevious(null)).toBe(false);
  });
});
