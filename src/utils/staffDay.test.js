import { describe, it, expect } from 'vitest';
import {
  jsDayToDbDow, dbDowToJsDay, dbDowOfDate, dayWorkingMinutes, weekWorkingMinutes, formatMinutes, effectiveHoursForDate, todayStatus, hoursFromShiftRow, todayLabels,
} from './staffDay';

describe('day-of-week mapping (DB 0=Mon, JS 0=Sun)', () => {
  it('maps JS to DB', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(jsDayToDbDow)).toEqual([6, 0, 1, 2, 3, 4, 5]);
  });
  it('round-trips', () => {
    for (let d = 0; d < 7; d++) expect(dbDowToJsDay(jsDayToDbDow(d))).toBe(d);
  });
  it('maps dates (2026-10-26 is a Monday, 2026-10-25 a Sunday)', () => {
    expect(dbDowOfDate('2026-10-26')).toBe(0);
    expect(dbDowOfDate('2026-10-25')).toBe(6);
    expect(dbDowOfDate('2026-10-31')).toBe(5);
  });
});

describe('dayWorkingMinutes', () => {
  it('is end - start with no breaks', () => expect(dayWorkingMinutes({ startTime: '09:00', endTime: '17:00' })).toBe(480));
  it('takes breaks off', () => {
    expect(dayWorkingMinutes({ startTime: '09:00:00', endTime: '17:00:00', breaks: [{ startTime: '13:00', endTime: '14:00' }, { startTime: '10:30', endTime: '10:45' }] })).toBe(405);
  });
  it('merges overlapping breaks and clips to the shift', () => {
    expect(dayWorkingMinutes({ startTime: '09:00', endTime: '12:00', breaks: [{ startTime: '08:00', endTime: '09:30' }, { startTime: '09:15', endTime: '10:00' }] })).toBe(120);
  });
  it('is 0 on a day off, or with bad times', () => {
    expect(dayWorkingMinutes({ startTime: '09:00', endTime: '17:00', isDayOff: true })).toBe(0);
    expect(dayWorkingMinutes({ startTime: '17:00', endTime: '09:00' })).toBe(0);
    expect(dayWorkingMinutes({})).toBe(0);
  });
  it('sums a week', () => {
    expect(weekWorkingMinutes([{ startTime: '09:00', endTime: '17:00' }, { startTime: '10:00', endTime: '14:00', breaks: [{ startTime: '12:00', endTime: '12:30' }] }, { isDayOff: true }])).toBe(480 + 210);
  });
});

describe('formatMinutes', () => {
  it('formats', () => {
    expect([150, 120, 45, 0, 405].map(formatMinutes)).toEqual(['2h 30m', '2h', '45m', '0h', '6h 45m']);
  });
});

describe('effectiveHoursForDate', () => {
  const weekly = [{ dayOfWeek: 0, startTime: '09:00', endTime: '17:00', isDayOff: false, breaks: [{ startTime: '13:00', endTime: '14:00' }] }];
  it('uses the weekly row for that weekday (Monday = 0)', () => {
    expect(effectiveHoursForDate('2026-10-26', weekly, [])).toMatchObject({ source: 'weekly', startTime: '09:00' });
  });
  it('an override for the exact date wins, without breaks', () => {
    expect(effectiveHoursForDate('2026-10-26', weekly, [{ date: '2026-10-26', startTime: '12:00', endTime: '18:00', isDayOff: false }])).toMatchObject({ source: 'override', startTime: '12:00', breaks: [] });
  });
  it('reports none when nothing is configured', () => {
    expect(effectiveHoursForDate('2026-10-27', weekly, []).source).toBe('none');
  });
});

describe('todayStatus', () => {
  const hours = { source: 'weekly', startTime: '09:00:00', endTime: '17:00:00', isDayOff: false };
  it('checked in', () => expect(todayStatus({ attendance: { status: 'Present', checkInTime: '2026-10-26T03:20:00Z' }, hours, nowTime: '10:00' }).key).toBe('checked-in'));
  it('not checked in once the shift has started', () => expect(todayStatus({ hours, nowTime: '09:30' }).key).toBe('not-checked-in'));
  it('upcoming before the shift', () => expect(todayStatus({ hours, nowTime: '08:00' }).key).toBe('upcoming'));
  it('leave beats the roster', () => expect(todayStatus({ attendance: { status: 'Sick Leave' }, hours, nowTime: '10:00' }).key).toBe('leave'));
  it('day off on the roster', () => expect(todayStatus({ hours: { ...hours, isDayOff: true }, nowTime: '10:00' }).key).toBe('off'));
  it('hours that cannot be read', () => expect(todayStatus({ hours: hoursFromShiftRow(null), nowTime: '10:00' }).key).toBe('no-roster'));
  it('no hours set, inside branch hours: open', () => {
    const h = hoursFromShiftRow({ works: true, source: 'none', start_time: '09:00:00', end_time: '21:00:00' });
    const st = todayStatus({ hours: h, nowTime: '10:00' });
    expect(st.key).toBe('no-hours-open');
    expect(todayLabels({ status: st, attendance: null, hours: h })).toEqual({ title: 'No hours set', sub: 'Branch hours 09:00 – 21:00' });
  });
  it('no hours set and the branch is closed that day: off', () => expect(todayStatus({ hours: hoursFromShiftRow({ works: false, source: 'none', start_time: null, end_time: null }), nowTime: '10:00' }).key).toBe('off'));
  it('after the shift with no check-in is not "needs you"', () => expect(todayStatus({ hours, nowTime: '18:00' }).key).toBe('off'));
});

describe('hoursFromShiftRow', () => {
  it('maps the rule row: roster -> override, 24:00, breaks', () => {
    const h = hoursFromShiftRow({ works: true, source: 'roster', start_time: '11:00:00', end_time: '23:59:59', breaks: [{ name: 'Lunch', start: '14:00', end: '14:30' }], off: [] });
    expect(h).toMatchObject({ source: 'override', startTime: '11:00', endTime: '24:00', isDayOff: false, openNoHours: false, missing: false });
    expect(h.breaks).toEqual([{ name: 'Lunch', startTime: '14:00', endTime: '14:30' }]);
  });
  it('not working is a day off; a missing row is "missing"', () => {
    expect(hoursFromShiftRow({ works: false, source: 'weekly', start_time: null, end_time: null })).toMatchObject({ isDayOff: true, source: 'weekly' });
    expect(hoursFromShiftRow(undefined).missing).toBe(true);
  });
});
