import { describe, it, expect } from 'vitest';
import { todayStatusLine, nextWorkingDay } from './todayStatusLine';
import { hoursFromShiftRow } from './staffDay';

const row = (o = {}) => ({ works: true, start_time: '09:00:00', end_time: '18:00:00', source: 'weekly', breaks: [], off: [], ...o });
const H = (o) => hoursFromShiftRow(row(o));
const min = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const run = (o, at, extra = {}) => todayStatusLine({ hours: H(o), nowMin: min(at), ...extra });
const NOHRS = { source: 'none', start_time: '09:00:00', end_time: '21:00:00' };

describe('todayStatusLine: the 13 rows', () => {
  it('1 before start', () => expect(run({}, '08:00')).toMatchObject({ row: 1, full: 'Starts 09:00 · Shift 09:00–18:00', short: '09:00–18:00', dot: 'grey' }));
  it('2 started, not checked in', () => expect(run({}, '10:00')).toMatchObject({ row: 2, full: 'Not checked in · Shift started 09:00', short: 'Not checked in', dot: 'amber' }));
  it('3 checked in', () => expect(run({}, '10:00', { attendance: { status: 'Present', checkInTime: '09:07' } })).toMatchObject({ row: 3, full: 'Checked in 09:07 · Shift 09:00–18:00', short: '09:00–18:00', dot: 'green' }));
  it('4 on a break', () => expect(run({ breaks: [{ name: 'Lunch', start: '13:00', end: '14:00' }] }, '13:30', { attendance: { status: 'Present', checkInTime: '09:07' } }))
    .toMatchObject({ row: 4, full: 'On break until 14:00 · Shift 09:00–18:00', short: 'Break till 14:00', dot: 'amber' }));
  it('5 shift over (and checked out)', () => {
    expect(run({}, '19:00')).toMatchObject({ row: 5, full: 'Shift ended 18:00', short: 'Finished', dot: 'grey' });
    expect(run({}, '19:00', { attendance: { status: 'Present', checkInTime: '09:07', checkOutTime: '18:05' } }).full).toBe('Checked out 18:05');
  });
  it('6 day off, back', () => expect(run({ works: false, start_time: null, end_time: null }, '10:00', { back: { date: '2026-11-03', startTime: '09:00' } }))
    .toMatchObject({ row: 6, full: 'Off today · back Tue 09:00', short: 'Day off', dot: 'grey' }));
  it('7 full leave', () => expect(run({ off: [{ code: 'ON_LEAVE', reason: 'leave_full', start_min: 0, end_min: 1440 }] }, '10:00', { back: { date: '2026-11-05', startTime: '09:00' } }))
    .toMatchObject({ row: 7, full: 'On leave · back Thu', short: 'On leave', dot: 'purple' }));
  it('8 half day', () => expect(run({ off: [{ code: 'ON_LEAVE', reason: 'leave_half', start_min: 810, end_min: 1080 }] }, '10:00'))
    .toMatchObject({ row: 8, full: 'Half day · off 13:30–18:00', short: 'Away 13:30–18:00', dot: 'purple' }));
  it('9 at another branch', () => expect(run({ off: [{ code: 'OTHER_BRANCH', label: 'Sanepa', start_min: 540, end_min: 960 }] }, '10:00'))
    .toMatchObject({ row: 9, full: 'At Sanepa until 16:00', short: 'At Sanepa', dot: 'grey' }));
  it('10 no hours, not checked in', () => expect(run(NOHRS, '10:00')).toMatchObject({ row: 10, full: 'No hours set · bookable in branch hours 09:00–21:00', short: 'No set hours', dot: 'green' }));
  it('11 no hours, checked in', () => expect(run(NOHRS, '10:00', { attendance: { status: 'Present', checkInTime: '09:07' } }))
    .toMatchObject({ row: 11, full: 'Checked in 09:07 · No hours set · bookable in branch hours 09:00–21:00', short: 'No set hours', dot: 'green' }));
  it('12 no hours, branch closed now', () => expect(run(NOHRS, '22:00')).toMatchObject({ row: 12, full: 'No hours set · branch closed now', short: 'No set hours', dot: 'grey' }));
  it('13 branch closed date', () => expect(run({}, '10:00', { branchClosed: true })).toMatchObject({ row: 13, full: 'Branch closed today', short: 'Closed', dot: 'grey' }));
});

describe('todayStatusLine: rules', () => {
  it('"Shift" never appears for a no-hours day', () => {
    for (const at of ['08:00', '10:00', '22:00']) expect(run(NOHRS, at).full).not.toMatch(/Shift/);
  });
  it('a missing row (rule unavailable) is "No shift set"', () => expect(todayStatusLine({ hours: null }).key).toBe('no-roster'));
});

describe('nextWorkingDay', () => {
  it('skips days off and full leave', () => {
    const rows = { '2026-11-02': H({ works: false, start_time: null, end_time: null }), '2026-11-03': H({ off: [{ code: 'ON_LEAVE', reason: 'leave_full' }] }), '2026-11-04': H({}) };
    expect(nextWorkingDay('2026-11-01', (d) => rows[d])).toEqual({ date: '2026-11-04', startTime: '09:00' });
  });
  it('null when nothing in the horizon', () => expect(nextWorkingDay('2026-11-01', () => H({ works: false, start_time: null, end_time: null }))).toBeNull());
});

describe('todayStatusLine: a visitor reads from the visit window (ZNLY-113 A+)', () => {
  // Sanepa 09:00-21:00; visit 18:55-21:00 -> the rest of the day is OTHER_BRANCH
  const visit = { source: 'window', start_time: '09:00:00', end_time: '21:00:00', off: [{ code: 'OTHER_BRANCH', start_min: 0, end_min: 1135, label: 'Lazimpat' }] };
  it('inside the window: Here 6:55 – 9:00 pm, never "Shift ended"', () => {
    expect(run(visit, '19:40').full).toBe('Here 6:55 – 9:00 pm');
    expect(run(visit, '19:40').full).not.toMatch(/Shift/);
  });
  it('before the window the home stretch still reads At <home>', () => expect(run(visit, '12:00').full).toBe('At Lazimpat until 18:55'));
  it('after the window: visit ended, not "Shift ended"', () => expect(run({ ...visit, off: [{ code: 'OTHER_BRANCH', start_min: 0, end_min: 600, label: 'Lazimpat' }] }, '22:00').full).toMatch(/^Visit ended/));
  it('two windows the same day: the next one is announced between them', () => {
    const two = { ...visit, off: [{ code: 'OTHER_BRANCH', start_min: 0, end_min: 720 }, { code: 'OTHER_BRANCH', start_min: 930, end_min: 1135 }] };
    expect(run(two, '12:30').full).toBe('Here 12:00 – 3:30 pm');
    expect(run(two, '16:00').full).toBe('At another branch until 18:55');
  });
});
