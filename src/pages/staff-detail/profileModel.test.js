import { describe, it, expect } from 'vitest';
import {
  changedKeys, normalizeHours, hoursChanged, changedHourDays, payChanged, diffServiceIds, categoryState, toggleCategory,
  serviceCounts, filterCategories, attendanceTone, attendanceSummary,
} from './profileModel';

describe('changedKeys', () => {
  it('lists only differing keys, arrays by value', () => {
    expect(changedKeys({ a: 1, b: ['x'], c: 'z' }, { a: 1, b: ['x'], c: 'y' }, ['a', 'b', 'c'])).toEqual(['c']);
    expect(changedKeys({ b: ['x'] }, { b: ['x', 'y'] }, ['b'])).toEqual(['b']);
  });
  it('is empty without a baseline', () => expect(changedKeys(null, { a: 1 }, ['a'])).toEqual([]));
});

describe('hours dirty tracking', () => {
  const base = [{ dayOfWeek: 0, dayLabel: 'Monday', startTime: '09:00:00', endTime: '17:00:00', isDayOff: false, breaks: [{ id: 'b1', name: 'Lunch', startTime: '13:00', endTime: '14:00' }] },
    { dayOfWeek: 1, dayLabel: 'Tuesday', startTime: null, endTime: null, isDayOff: true, breaks: [] }];
  it('ignores ids, seconds and labels', () => {
    const same = [{ dayOfWeek: 0, startTime: '09:00', endTime: '17:00', isDayOff: false, breaks: [{ name: ' Lunch ', startTime: '13:00:00', endTime: '14:00:00' }] }, { dayOfWeek: 1, isDayOff: true }];
    expect(hoursChanged(base, same)).toBe(false);
  });
  it('sees a new break and names the day', () => {
    const next = JSON.parse(JSON.stringify(base));
    next[0].breaks.push({ name: 'Tea', startTime: '16:00', endTime: '16:15' });
    expect(hoursChanged(base, next)).toBe(true);
    expect(changedHourDays(base, next)).toEqual([0]);
  });
  it('a day-off row ignores stale times', () => {
    expect(normalizeHours([{ dayOfWeek: 2, isDayOff: true, startTime: '09:00', endTime: '10:00', breaks: [{ name: 'x', startTime: '09:10', endTime: '09:20' }] }])[0]).toMatchObject({ s: null, e: null, b: [] });
  });
});

describe('payChanged', () => {
  it('compares numerically', () => {
    expect(payChanged({ monthlySalary: 28000, commissionRate: 12, productCommissionRate: 5 }, { monthlySalary: '28000', commissionRate: '12.0', productCommissionRate: 5 })).toBe(false);
    expect(payChanged({ monthlySalary: 28000, commissionRate: 12, productCommissionRate: 5 }, { monthlySalary: 28000, commissionRate: 15, productCommissionRate: 5 })).toBe(true);
    expect(payChanged({ monthlySalary: 0, commissionRate: 0, productCommissionRate: 0 }, { monthlySalary: '', commissionRate: '', productCommissionRate: '' })).toBe(false);
  });
});

describe('service selection', () => {
  const svcs = [{ id: 'a', name: 'Deep tissue' }, { id: 'b', name: 'Facial' }, { id: 'c', name: 'Combo', openToAll: true }];
  it('diffs ids', () => expect(diffServiceIds(['a', 'b'], ['b', 'x'])).toEqual({ added: ['x'], removed: ['a'] }));
  it('tri-state counts locked as ticked', () => {
    expect(categoryState(svcs, new Set(['a', 'b']))).toBe('all');
    expect(categoryState(svcs, new Set(['a']))).toBe('some');
    expect(categoryState([{ id: 'z', name: 'z' }], new Set())).toBe('none');
    expect(categoryState([], new Set())).toBe('none');
  });
  it('category toggle never touches locked services', () => {
    const all = toggleCategory(svcs, new Set());
    expect([...all].sort()).toEqual(['a', 'b']);
    expect([...toggleCategory(svcs, all)]).toEqual([]);
    expect([...toggleCategory(svcs, new Set(['a']))].sort()).toEqual(['a', 'b']);
  });
  it('counts and filters', () => {
    const cats = [{ id: '1', name: 'Massage', services: svcs }];
    const ticked = new Set(['a']);
    expect(serviceCounts(cats, ticked)).toEqual({ total: 3, ticked: 2, notTicked: 1 });
    expect(filterCategories(cats, { filter: 'ticked', tickedSet: ticked })[0].services.map((s) => s.id)).toEqual(['a', 'c']);
    expect(filterCategories(cats, { filter: 'unticked', tickedSet: ticked })[0].services.map((s) => s.id)).toEqual(['b']);
    expect(filterCategories(cats, { search: 'FAC', tickedSet: ticked })[0].services.map((s) => s.id)).toEqual(['b']);
    expect(filterCategories(cats, { search: 'nothing', tickedSet: ticked })).toEqual([]);
  });
});

describe('attendance strip', () => {
  it('maps statuses', () => {
    expect(attendanceTone({ status: 'Present' })).toBe('on-time');
    expect(attendanceTone({ status: 'Present', late: true })).toBe('late');
    expect(attendanceTone({ status: 'Sick Leave' })).toBe('leave');
    expect(attendanceTone({ status: 'Day Off' })).toBe('off');
    expect(attendanceTone({ status: 'Absent' })).toBe('absent');
    expect(attendanceTone(null)).toBe('none');
    expect(attendanceTone({ status: 'late' })).toBe('late'); // already classified by the API
    expect(attendanceTone({ status: 'none' })).toBe('none');
  });
  it('summarises', () => {
    const rows = [...Array(3).fill({ status: 'Present' }), { status: 'Present', late: true }, { status: 'Leave' }, { status: 'Day Off' }];
    expect(attendanceSummary(rows)).toBe('3 of 4 shifts on time · 1 late · 1 day of leave');
    expect(attendanceSummary([{ status: 'none' }, { status: 'off' }])).toBe('');
  });
});

import { buildTimeline } from './profileModel';

describe('buildTimeline', () => {
  const shift = { startTime: '10:00', endTime: '19:00', isDayOff: false, breaks: [{ name: 'Lunch', startTime: '13:00', endTime: '14:00' }] };
  const bk = (id, s, e, status = 'Confirmed') => ({ id, startTime: s, endTime: e, status });
  it('spans the shift, marks done / next, finds the gap after now', () => {
    const t = buildTimeline({ shift, nowTime: '12:00', bookings: [bk('a', '10:00', '11:00', 'Completed'), bk('b', '11:15', '12:15', 'Completed'), bk('c', '14:00', '15:00'), bk('d', '15:00', '16:00')] });
    expect([t.from, t.to]).toEqual([600, 1140]);
    expect(t.blocks.map((b) => b.kind)).toEqual(['done', 'done', 'next', 'up']);
    expect([t.done, t.toCome]).toEqual([2, 2]);
    expect(t.gap).toEqual({ from: 12 * 60 + 15, to: 13 * 60 }); // 45 min before lunch
  });
  it('stacks overlaps in two lanes and counts the third as hidden', () => {
    const t = buildTimeline({ shift, nowTime: '09:00', bookings: [bk('a', '10:00', '11:00'), bk('b', '10:30', '11:30'), bk('c', '10:45', '11:45')] });
    expect(t.blocks.map((b) => b.lane)).toEqual([0, 1]);
    expect(t.hidden).toBe(1);
  });
  it('ignores cancelled bookings and returns null with nothing to show', () => {
    expect(buildTimeline({ shift: { isDayOff: true }, bookings: [bk('a', '10:00', '11:00', 'Cancelled')] })).toBeNull();
  });
});
