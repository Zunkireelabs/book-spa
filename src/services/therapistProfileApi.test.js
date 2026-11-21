import { describe, it, expect } from 'vitest';
import { isOnTime, nepalMinutesOfDay, classifyAttendanceDay, weekDates, formatActivityText, buildActivityItems, canSeePay } from './therapistProfileApi';

describe('on-time rule (10 min grace, Nepal time)', () => {
  // 2026-10-26T03:20:00Z = 09:05 Nepal (UTC+5:45)
  it('converts UTC to Nepal minutes', () => expect(nepalMinutesOfDay('2026-10-26T03:20:00Z')).toBe(9 * 60 + 5));
  it('09:05 against a 09:00 shift is on time', () => expect(isOnTime('2026-10-26T03:20:00Z', '09:00')).toBe(true));
  it('exactly start + 10 is on time, +11 is late', () => {
    expect(isOnTime('2026-10-26T03:25:00Z', '09:00')).toBe(true);
    expect(isOnTime('2026-10-26T03:26:00Z', '09:00')).toBe(false);
  });
  it('no shift -> unknown (null), never "late"', () => expect(isOnTime('2026-10-26T03:20:00Z', null)).toBeNull());
  it('wraps past midnight UTC correctly (19:00Z = 00:45 next day Nepal)', () => expect(nepalMinutesOfDay('2026-10-26T19:00:00Z')).toBe(45));
});

describe('classifyAttendanceDay', () => {
  const hours = { source: 'weekly', startTime: '09:00', isDayOff: false };
  it('on time / late', () => {
    expect(classifyAttendanceDay({ attendance: { status: 'Present', check_in_time: '2026-10-26T03:20:00Z' }, hours })).toBe('on-time');
    expect(classifyAttendanceDay({ attendance: { status: 'Present', check_in_time: '2026-10-26T04:30:00Z' }, hours })).toBe('late');
  });
  it('leave, absent, marked day off, rostered day off, nothing', () => {
    expect(classifyAttendanceDay({ attendance: { status: 'Sick Leave' }, hours })).toBe('leave');
    expect(classifyAttendanceDay({ attendance: { status: 'Absent' }, hours })).toBe('absent');
    expect(classifyAttendanceDay({ attendance: { status: 'Day Off' }, hours })).toBe('off');
    expect(classifyAttendanceDay({ attendance: null, hours: { source: 'weekly', isDayOff: true } })).toBe('off');
    expect(classifyAttendanceDay({ attendance: null, hours })).toBe('none');
  });
  it('checked in with no shift configured counts as on time', () => {
    expect(classifyAttendanceDay({ attendance: { status: 'Present', check_in_time: '2026-10-26T03:20:00Z' }, hours: { source: 'none' } })).toBe('on-time');
  });
});

describe('weekDates', () => {
  it('is Monday-first and contains the date (2026-10-28 is a Wednesday)', () => {
    const w = weekDates('2026-10-28');
    expect(w[0]).toBe('2026-10-26'); expect(w[6]).toBe('2026-11-01'); expect(w).toContain('2026-10-28');
  });
  it('a Sunday belongs to the week that started the Monday before', () => expect(weekDates('2026-10-25')[0]).toBe('2026-10-19'));
});

describe('role gate', () => {
  it("pay follows Payroll's rule: admin + admin_viewer only; manager, staff and unknown roles never", () => {
    expect(['staff', 'admin_viewer', 'manager', 'admin', undefined, null, ''].map(canSeePay)).toEqual([false, true, false, true, false, false, false]);
  });
});

describe('formatActivityText (no raw column names)', () => {
  it('pay', () => {
    expect(formatActivityText({ table_name: 'staff_compensation', action_type: 'UPDATE', old_data: { commission_rate: 10 }, new_data: { commission_rate: 12 } })).toBe('Service commission 10% → 12%');
    expect(formatActivityText({ table_name: 'staff_compensation', action_type: 'UPDATE', old_data: { monthly_salary: 30000 }, new_data: { monthly_salary: 32000 } })).toBe('Monthly salary Rs 30,000 → Rs 32,000');
    expect(formatActivityText({ table_name: 'staff_compensation', action_type: 'UPDATE', old_data: { product_commission_rate: 5 }, new_data: { product_commission_rate: 7.5 } })).toBe('Product commission 5% → 7.5%');
  });
  it('profile', () => {
    const t = formatActivityText({ table_name: 'therapists', action_type: 'UPDATE', old_data: { is_active: true, phone: '9800000001' }, new_data: { is_active: false, phone: '9800000002' } });
    expect(t).toBe('Phone 9800000001 → 9800000002 · Deactivated');
    expect(t).not.toMatch(/is_active|_/);
    expect(formatActivityText({ table_name: 'therapists', action_type: 'UPDATE', old_data: { is_service_staff: true }, new_data: { is_service_staff: false } }, { staffLabel: 'Stylist', supportLabel: 'Support' })).toBe('Type Stylist → Support');
  });
  it('hours and date changes', () => {
    expect(formatActivityText({ table_name: 'therapist_working_hours', action_type: 'UPDATE', old_data: { start_time: '09:00:00' }, new_data: { start_time: '09:30:00', day_of_week: 1 } })).toBe('Tuesday starts 09:00 → 09:30');
    expect(formatActivityText({ table_name: 'staff_roster_overrides', action_type: 'INSERT', old_data: null, new_data: { override_date: '2030-01-07', start_time: '10:00:00', end_time: '18:00:00', is_day_off: false } })).toBe('Date change added for Mon 7 Jan: 10:00–18:00');
    expect(formatActivityText({ table_name: 'staff_roster_overrides', action_type: 'INSERT', old_data: null, new_data: { override_date: '2030-01-07', is_day_off: true } })).toBe('Date change added for Mon 7 Jan: day off');
  });
  it('transfers', () => {
    expect(formatActivityText({ table_name: 'staff_transfers', action_type: 'TRANSFER', new_data: { is_permanent: false }, from_branch_name: 'Lazimpat', to_branch_name: 'Thamel' })).toBe('Transferred from Lazimpat to Thamel');
  });
});

describe('buildActivityItems: breaks grouped per day, re-saves cancel out', () => {
  const brk = (id, action, at, d) => ({ id, table_name: 'therapist_working_hours_breaks', action_type: action, at, actor_name: 'Admin', old_data: action === 'INSERT' ? null : d, new_data: action === 'DELETE' ? null : d });
  const lunch = { therapist_id: 't', day_of_week: 1, break_name: 'Lunch', start_time: '13:00:00', end_time: '14:00:00' };
  const tea = { therapist_id: 't', day_of_week: 1, break_name: 'Tea', start_time: '11:00:00', end_time: '11:15:00' };

  it('an identical remove + add (the app re-saves every break) produces no line', () => {
    const items = buildActivityItems([brk('1', 'DELETE', '2026-10-26T05:00:00Z', lunch), brk('2', 'INSERT', '2026-10-26T05:00:01Z', lunch)]);
    expect(items).toEqual([]);
  });
  it('real changes are one line per day', () => {
    const items = buildActivityItems([
      brk('1', 'DELETE', '2026-10-26T05:00:00Z', lunch), brk('2', 'INSERT', '2026-10-26T05:00:01Z', lunch),
      brk('3', 'INSERT', '2026-10-26T05:00:02Z', tea),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ category: 'hours', text: "Tuesday breaks: added Tea 11:00–11:15" });
  });
  it('different days stay separate; newest first with other rows', () => {
    const wed = { ...tea, day_of_week: 2 };
    const items = buildActivityItems([
      brk('1', 'INSERT', '2026-10-26T05:00:00Z', tea), brk('2', 'INSERT', '2026-10-26T05:00:01Z', wed),
      { id: '3', table_name: 'therapists', action_type: 'UPDATE', at: '2026-10-26T06:00:00Z', actor_name: 'Admin', old_data: { bio: 'a' }, new_data: { bio: 'b' } },
    ]);
    expect(items.map((i) => i.text)).toEqual(['Bio updated', 'Wednesday breaks: added Tea 11:00–11:15', 'Tuesday breaks: added Tea 11:00–11:15']);
  });
});
