import { describe, it, expect } from 'vitest';
import {
  toConflictList, conflictReasonLabel, hoursChange, rosterChange, blockChange, leaveChange, transferChange, defaultHalfDayOff, validateHalfDay,
} from './availabilityConflicts';

describe('toConflictList', () => {
  it('turns RPC rows into display lines (HH:MM, reason phrase, fallbacks)', () => {
    const [a, b] = toConflictList([
      { booking_id: 'b1', booking_number: 'BK-1', booking_date: '2026-10-27', start_time: '10:00:00', end_time: '11:00:00', customer_name: 'Priya S.', service: 'Thai massage', reason: 'before_shift', who: 'Rojina', therapist_id: 't1' },
      { booking_id: 'b2', booking_date: '2026-11-03', start_time: '11:30:00', end_time: '12:30:00', customer_name: null, service: null, reason: 'weird' },
    ]);
    expect(a).toMatchObject({ id: 'b1', date: '2026-10-27', time: '10:00', endTime: '11:00', customer: 'Priya S.', service: 'Thai massage', text: 'before the new hours', who: 'Rojina', therapistId: 't1' });
    expect(b).toMatchObject({ customer: 'Guest', service: '', text: 'outside availability' });
    expect(toConflictList(undefined)).toEqual([]);
  });
  it('has a phrase for every reason the database returns', () => {
    for (const r of ['before_shift', 'after_shift', 'day_off', 'break', 'block', 'leave', 'other_branch']) expect(conflictReasonLabel(r)).not.toBe('outside availability');
  });
});

describe('change payloads', () => {
  it('hours: day off carries no times; working carries trimmed times and only complete breaks', () => {
    expect(hoursChange({ dayOfWeek: 1, isDayOff: true, start: '09:00', end: '17:00' })).toEqual({ type: 'hours', day_of_week: 1, is_day_off: true });
    expect(hoursChange({ dayOfWeek: 1, isDayOff: false, start: '12:00:00', end: '20:00:00', breaks: [{ start: '14:00:00', end: '14:30:00' }, { start: '', end: '' }] }))
      .toEqual({ type: 'hours', day_of_week: 1, is_day_off: false, start: '12:00', end: '20:00', breaks: [{ start: '14:00', end: '14:30' }] });
  });
  it('roster, block, leave (full / half day), transfer', () => {
    expect(rosterChange({ date: '2026-10-28', isDayOff: false, start: '11:00', end: '20:00', breaks: [{ start: '14:00', end: '14:30' }] }))
      .toEqual({ type: 'roster', date: '2026-10-28', is_day_off: false, start: '11:00', end: '20:00', breaks: [{ start: '14:00', end: '14:30' }] });
    expect(blockChange({ date: '2026-10-26', start: '13:00', durationMinutes: 180 })).toEqual({ type: 'block', date: '2026-10-26', start: '13:00', duration_minutes: 180 });
    expect(leaveChange({ from: '2026-10-26' })).toEqual({ type: 'leave', from: '2026-10-26', to: '2026-10-26' });
    expect(leaveChange({ from: '2026-10-26', offStart: '09:00', offEnd: '13:00' })).toEqual({ type: 'leave', from: '2026-10-26', to: '2026-10-26', off_start: '09:00', off_end: '13:00' });
    expect(transferChange({ fromTs: '2026-10-26T00:00:00+05:45', toBranchId: 'br' })).toEqual({ type: 'transfer', from_ts: '2026-10-26T00:00:00+05:45', to_ts: null, to_branch_id: 'br' });
  });
});

describe('half day', () => {
  const shift = { start: '09:00', end: '18:00', breaks: [{ start_min: 13 * 60, end_min: 14 * 60 }] };
  it('prefills with the split rule: longest break start, else the midpoint on a 30 minute step', () => {
    expect(defaultHalfDayOff({ status: '1st-Half Day', shift })).toEqual({ start: '09:00', end: '13:00' });
    expect(defaultHalfDayOff({ status: '2nd-Half Day', shift })).toEqual({ start: '13:00', end: '18:00' });
    expect(defaultHalfDayOff({ status: '1st-Half Day', shift: { start: '09:00', end: '18:00', breaks: [] } })).toEqual({ start: '09:00', end: '13:30' });
  });
  it('a shift to 24:00 (23:59:59) and no shift', () => {
    expect(defaultHalfDayOff({ status: '2nd-Half Day', shift: { start: '12:00', end: '23:59:59', breaks: [] } })).toEqual({ start: '18:00', end: '24:00' });
    expect(defaultHalfDayOff({ status: '1st-Half Day', shift: null })).toBeNull();
    expect(defaultHalfDayOff({ status: 'Present', shift })).toBeNull();
  });
  it('validates inside that day\'s shift', () => {
    expect(validateHalfDay({ offStart: '09:00', offEnd: '13:00', shift })).toBeNull();
    expect(validateHalfDay({ offStart: '', offEnd: '13:00', shift })).toBe('Enter both times.');
    expect(validateHalfDay({ offStart: '13:00', offEnd: '13:00', shift })).toBe('Off start must be before off end.');
    expect(validateHalfDay({ offStart: '08:00', offEnd: '12:00', shift })).toBe('Must be inside the shift (09:00–18:00).');
    expect(validateHalfDay({ offStart: '12:00', offEnd: '19:00', shift })).toBe('Must be inside the shift (09:00–18:00).');
    expect(validateHalfDay({ offStart: '12:00', offEnd: '19:00', shift: null })).toBeNull();   // nothing to check against
  });
});
