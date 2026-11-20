import { describe, it, expect } from 'vitest';
import { dayAssignCount, firstGroupLabel, buildAssignList, needsStaff, isLate, straightToStaff, durationLabel, clock12, listSummary } from './unassignedList';

const b = (o) => ({ id: o.id, date: '2026-11-20', start_time: '10:00:00', end_time: '11:00:00', status: 'Confirmed', created_by: 'u1', therapist_id: null, booking_therapists: [], service: { name: 'X', duration_minutes: 60, requires_therapist: true }, customer_name: 'A', ...o });
const ctx = { today: '2026-11-20', nowHm: '12:00' };

describe('unassignedList', () => {
  it('needsStaff filters assigned, closed and self-service rows', () => {
    expect(needsStaff(b({ id: 1 }))).toBe(true);
    expect(needsStaff(b({ id: 1, therapist_id: 't' }))).toBe(false);
    expect(needsStaff(b({ id: 1, booking_therapists: [{ therapist_id: 't' }] }))).toBe(false);
    expect(needsStaff(b({ id: 1, status: 'Cancelled' }))).toBe(false);
    expect(needsStaff(b({ id: 1, service: { requires_therapist: false } }))).toBe(false);
  });
  it('late = today, past start, Pending/Confirmed', () => {
    expect(isLate(b({ id: 1, start_time: '09:00:00' }), ctx)).toBe(true);
    expect(isLate(b({ id: 1, start_time: '13:00:00' }), ctx)).toBe(false);
    expect(isLate(b({ id: 1, start_time: '09:00:00', status: 'In-Progress' }), ctx)).toBe(false);
    expect(isLate(b({ id: 1, date: '2026-11-21', start_time: '09:00:00' }), ctx)).toBe(false);
  });
  it('sorts today late-first then by time; upcoming by date then time; drops >7 days and past days; dedupes', () => {
    const rows = [
      b({ id: 'a', start_time: '16:15:00' }), b({ id: 'b', start_time: '09:00:00' }), b({ id: 'c', start_time: '13:15:00' }),
      b({ id: 'u2', date: '2026-11-24', start_time: '14:30:00', created_by: null }), b({ id: 'u1', date: '2026-11-21', start_time: '10:00:00', created_by: null }),
      b({ id: 'far', date: '2026-11-28' }), b({ id: 'old', date: '2026-11-19' }), b({ id: 'a', start_time: '16:15:00' }),
    ];
    const l = buildAssignList(rows, ctx);
    expect(l.today.map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(l.today[0].late).toBe(true);
    expect(l.upcoming.map((x) => x.id)).toEqual(['u1', 'u2']);
    expect(l.upcoming[0].online).toBe(true);
    expect(listSummary(l)).toBe('3 today · 2 upcoming');
  });
  it('late ones come before earlier-on-time rows', () => {
    const l = buildAssignList([b({ id: 'x', start_time: '12:30:00' }), b({ id: 'y', start_time: '11:00:00' })], ctx);
    expect(l.today.map((x) => x.id)).toEqual(['y', 'x']);
  });
  it('straightToStaff only when exactly one today', () => {
    expect(straightToStaff(buildAssignList([b({ id: 1 })], ctx))?.id).toBe(1);
    expect(straightToStaff(buildAssignList([b({ id: 1 }), b({ id: 2 })], ctx))).toBeNull();
    expect(straightToStaff(buildAssignList([b({ id: 1, date: '2026-11-21' })], ctx))).toBeNull();
  });
  it('labels', () => {
    expect(durationLabel(120)).toBe('2 h'); expect(durationLabel(45)).toBe('45 min'); expect(durationLabel(90)).toBe('1 h 30 min');
    expect(clock12('16:15:00')).toBe('4:15pm'); expect(clock12('00:05')).toBe('12:05am');
  });
  it('bar count equals the first group for any day shown, self-service excluded', () => {
    const rows = [b({ id: 1 }), b({ id: 2, service: { requires_therapist: false } }), b({ id: 3, date: '2026-11-21' }), b({ id: 4, date: '2026-11-21', therapist_id: 't' })];
    expect(dayAssignCount(rows, '2026-11-20')).toBe(1);
    expect(dayAssignCount(rows, '2026-11-20')).toBe(buildAssignList(rows, ctx).today.length);
    const other = buildAssignList(rows, { today: '2026-11-21', realToday: '2026-11-20', nowHm: '12:00' });
    expect(dayAssignCount(rows, '2026-11-21')).toBe(other.today.length);
    expect(other.today[0].late).toBe(false);
    expect(firstGroupLabel('2026-11-20', '2026-11-20')).toBe('today');
  });
});
