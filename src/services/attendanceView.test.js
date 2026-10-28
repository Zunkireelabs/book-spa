import { describe, it, expect } from 'vitest';
import { awayWholeShift, clipVisitWindow, visitWindowOn, deriveRow, bulkPresentTime, needsReason, diffPatch, payEffect, durationText } from './attendanceView';

const settings = { lateGraceMinutes: 10, openCheckoutHours: 4, expectCheckIn: true };
const shift = { start: '09:00', end: '18:00' };
const d = (over) => deriveRow({ person: {}, date: '2026-10-28', today: '2026-10-28', nowMin: 10 * 60, shift, settings, ...over });

describe('deriveRow', () => {
  it('not in yet inside grace, no show after it, later before 15 min of the start', () => {
    expect(d({ nowMin: 9 * 60 + 5 }).kind).toBe('not_in_yet');
    expect(d({ nowMin: 9 * 60 + 11 }).kind).toBe('no_show');
    expect(d({ nowMin: 8 * 60 + 30 }).kind).toBe('later');
    expect(d({ nowMin: 8 * 60 + 50 }).kind).toBe('not_in_yet');
  });
  it('late only past grace; within grace is a quiet note', () => {
    expect(d({ person: { status: 'Present', checkIn: '09:04' } })).toMatchObject({ kind: 'in', lateMin: 0, minAfterStart: 4 });
    expect(d({ person: { status: 'Present', checkIn: '10:13' } })).toMatchObject({ kind: 'in', lateMin: 73 });
  });
  it('visitors are never late', () => {
    expect(d({ person: { status: 'Present', checkIn: '10:13' }, visitor: true }).lateMin).toBe(0);
  });
  it('open check-out after shift end + hours, and on any past day', () => {
    expect(d({ person: { status: 'Present', checkIn: '09:00' }, nowMin: 21 * 60 }).kind).toBe('in');
    expect(d({ person: { status: 'Present', checkIn: '09:00' }, nowMin: 22 * 60 }).kind).toBe('no_checkout');
    expect(d({ person: { status: 'Present', checkIn: '09:00' }, date: '2026-10-27' }).kind).toBe('no_checkout');
    expect(d({ person: { status: 'Present', checkIn: '09:00', checkOut: '17:00' }, date: '2026-10-27' }).kind).toBe('out');
  });
  it('leave, off, absent, half day', () => {
    expect(d({ person: { status: 'Sick Leave' } }).kind).toBe('leave');
    expect(d({ person: { status: 'Day Off' } }).kind).toBe('off');
    expect(d({ person: { status: 'Absent' } }).kind).toBe('absent');
    expect(d({ person: { status: '2nd-Half Day', checkIn: '09:00' } }).kind).toBe('half');
  });
  it('past unmarked, future later, no shift = not scheduled', () => {
    expect(d({ date: '2026-10-27' }).kind).toBe('unmarked');
    expect(d({ date: '2026-10-29' }).kind).toBe('later');
    expect(d({ shift: null }).kind).toBe('not_scheduled');
  });
});

describe('deriveRow with the switch OFF (present by default)', () => {
  const off = { ...settings, expectCheckIn: false };
  it('scheduled and nothing saved = grey Present, never No show / Not marked', () => {
    expect(d({ settings: off, nowMin: 12 * 60 }).kind).toBe('present_default');
    expect(d({ settings: off, date: '2026-10-27' }).kind).toBe('present_default');
  });
  it('before the shift starts it is still Later; not scheduled stays not scheduled', () => {
    expect(d({ settings: off, nowMin: 8 * 60 }).kind).toBe('later');
    expect(d({ settings: off, shift: null }).kind).toBe('not_scheduled');
  });
  it('a real check-in still tracks lateness; a missed check-out is still flagged', () => {
    expect(d({ settings: off, person: { status: 'Present', checkIn: '10:13' } })).toMatchObject({ kind: 'in', lateMin: 73 });
    expect(d({ settings: off, person: { status: 'Present', checkIn: '09:00' }, date: '2026-10-27' }).kind).toBe('no_checkout');
  });
});

describe('bulkPresentTime', () => {
  it('shift start, never in the future', () => {
    expect(bulkPresentTime({ shift, date: '2026-10-28', today: '2026-10-28', nowMin: 10 * 60 })).toBe('09:00');
    expect(bulkPresentTime({ shift: { start: '14:00', end: '21:00' }, date: '2026-10-28', today: '2026-10-28', nowMin: 10 * 60 })).toBeNull();
    expect(bulkPresentTime({ shift: null, date: '2026-10-28', today: '2026-10-28', nowMin: 600 })).toBeNull();
  });
});

describe('needsReason (mirrors the DB trigger)', () => {
  const today = '2026-10-28';
  const saved = { status: 'Present', checkIn: '09:00', checkOut: null };
  it('fresh mark today is free; any past date needs one', () => {
    expect(needsReason({ existing: null, next: { status: 'Present', checkIn: '09:00' }, date: today, today })).toBe(false);
    expect(needsReason({ existing: null, next: { status: 'Present' }, date: '2026-10-27', today })).toBe(true);
  });
  it('status or a recorded time change needs one; filling an empty time does not', () => {
    expect(needsReason({ existing: saved, next: { ...saved, status: 'Absent' }, date: today, today })).toBe(true);
    expect(needsReason({ existing: saved, next: { ...saved, checkIn: '09:30' }, date: today, today })).toBe(true);
    expect(needsReason({ existing: saved, next: { ...saved, checkOut: '17:00' }, date: today, today })).toBe(false);
  });
});

describe('diffPatch', () => {
  it('keeps only changed fields', () => {
    expect(diffPatch({ status: 'Present', checkIn: '09:00' }, { status: 'Present', checkIn: '09:00', checkOut: '17:00' })).toEqual({ checkOut: '17:00' });
    expect(diffPatch({ checkOut: '17:00' }, { checkOut: '' })).toEqual({ checkOut: null });
  });
});

describe('payEffect (Payroll formula)', () => {
  const ctx = { monthlySalary: 30000, daysInMonth: 30, sickUsed: 13, annualUsed: 0, sickCap: 14, annualCap: 18 };
  it('absent = 1 day, half day = 1/2 day', () => {
    expect(payEffect({ status: 'Absent', date: '2026-10-28', ctx })).toMatchObject({ deduction: 1000, days: 1 });
    expect(payEffect({ status: '1st-Half Day', date: '2026-10-28', ctx })).toMatchObject({ deduction: 500, days: 0.5 });
  });
  it('leave is paid up to the yearly cap, then unpaid like absent', () => {
    expect(payEffect({ status: 'Sick Leave', date: '2026-10-28', ctx })).toMatchObject({ deduction: 0, days: 0 });
    expect(payEffect({ status: 'Sick Leave', date: '2026-10-28', ctx }).text).toContain('the next one will be unpaid (NPR 1,000)');
    expect(payEffect({ status: 'Sick Leave', date: '2026-10-28', ctx: { ...ctx, sickUsed: 14 } })).toMatchObject({ deduction: 1000, days: 1 });
  });
  it('day off and present cost nothing; late never changes pay; salary may be unreadable', () => {
    expect(payEffect({ status: 'Day Off', date: '2026-10-28', ctx }).deduction).toBe(0);
    expect(payEffect({ status: 'Present', date: '2026-10-28', ctx, lateMin: 20 }).text).toContain("Late doesn't change pay");
    expect(payEffect({ status: 'Absent', date: '2026-10-28', ctx: { ...ctx, monthlySalary: null } }).deduction).toBeNull();
  });
});

describe('durationText', () => {
  it('formats', () => { expect(durationText('08:30', '10:30')).toBe('2h 0m'); });
});

describe('awayWholeShift', () => {
  const tr = { effectiveDate: '2026-10-28', startTime: '00:00:00', revertAt: '2026-10-29T00:00:00+05:45' };
  it('whole shift covered = away; partly away is not', () => {
    expect(awayWholeShift({ transfer: tr, date: '2026-10-28', shift: { start: '09:00', end: '21:00' } })).toBe(true);
    expect(awayWholeShift({ transfer: { ...tr, startTime: '14:00:00', revertAt: '2026-10-28T16:00:00+05:45' }, date: '2026-10-28', shift: { start: '09:00', end: '18:00' } })).toBe(false);
    expect(awayWholeShift({ transfer: { ...tr, reverted: true, revertedAt: '2026-10-28T12:00:00+05:45' }, date: '2026-10-28', shift: { start: '09:00', end: '21:00' } })).toBe(false);
    expect(awayWholeShift({ transfer: tr, date: '2026-10-29', shift: { start: '09:00', end: '21:00' } })).toBe(false);
  });
});

describe('clipVisitWindow', () => {
  it('a whole-day window shows the branch hours, never midnight', () => {
    expect(clipVisitWindow({ fromParts: { date: '2026-10-28', hm: '00:00' }, toParts: { date: '2026-10-29', hm: '00:00' }, date: '2026-10-28', openTime: '09:00', closeTime: '21:00' })).toEqual({ start: '09:00', end: '21:00', allDay: true });
    expect(clipVisitWindow({ fromParts: { date: '2026-10-28', hm: '11:15' }, toParts: { date: '2026-10-28', hm: '13:15' }, date: '2026-10-28', openTime: '09:00', closeTime: '21:00' })).toEqual({ start: '11:15', end: '13:15', allDay: false });
  });
});

describe('present_saved (Present with no times)', () => {
  it('is "Present", not "In", and not counted as checked in', () => {
    expect(d({ person: { status: 'Present' } })).toMatchObject({ kind: 'present_saved', checkedIn: false });
    expect(d({ person: { status: 'Present', checkIn: '09:05' } }).kind).toBe('in');
  });
});

describe('visitWindowOn (past dates use THAT day\'s window)', () => {
  const T = (over) => ({ to_branch_id: 'sanepa', is_return_leg: false, is_permanent: false, reverted: false, reverted_at: null, ...over });
  const transfers = [
    T({ effective_date: '2026-10-27', start_time: '18:55:00', revert_at: '2026-10-27T21:55:00+05:45' }),     // Tue 27: 6:55-9:55 pm
    T({ effective_date: '2026-10-28', start_time: '11:15:00', revert_at: '2026-10-28T13:15:00+05:45' }),     // Wed 28: 11:15-1:15 pm
  ];
  it('Tuesday uses Tuesday\'s window, so a 6:55 pm check-in is not late (never judged against today\'s 11:15)', () => {
    const w = visitWindowOn({ transfers, toBranchId: 'sanepa', date: '2026-10-27', checkIn: '18:55' });
    expect(w).toEqual({ start: '18:55', end: '21:55' });
    expect(deriveRow({ person: { status: 'Present', checkIn: '18:55' }, date: '2026-10-27', today: '2026-10-28', nowMin: 10 * 60, shift: w, settings }).lateMin).toBe(0);
  });
  it('today uses today\'s window; another branch or no window = null', () => {
    expect(visitWindowOn({ transfers, toBranchId: 'sanepa', date: '2026-10-28' })).toEqual({ start: '11:15', end: '13:15' });
    expect(visitWindowOn({ transfers, toBranchId: 'thamel', date: '2026-10-28' })).toBeNull();
    expect(visitWindowOn({ transfers, toBranchId: 'sanepa', date: '2026-10-20' })).toBeNull();
  });
});
