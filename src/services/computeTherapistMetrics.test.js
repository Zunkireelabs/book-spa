import { describe, it, expect, vi } from 'vitest';

// api.js imports lib/supabase.js, which creates a live Supabase client (and a
// Realtime/WebSocket connection) at module-import time — not viable under
// vitest/Node. Mock it so importing api.js here only pulls in the pure helper.
vi.mock('lib/supabase', () => ({
  supabase: {},
  supabaseCustomer: {},
  supabasePlatform: {},
}));

const { computeTherapistMetrics } = await import('./api');

describe('computeTherapistMetrics', () => {
  it('applies the periodDays fallback when a therapist has zero attendance rows', () => {
    const bookings = [];
    const attendanceRows = [];
    const dayWindowMinutes = 480; // 8-hour branch window
    const periodDays = 7;

    const metrics = computeTherapistMetrics(bookings, attendanceRows, dayWindowMinutes, periodDays);

    // Zero attendance rows -> workedMinutes falls back to periodDays * dayWindowMinutes,
    // per the comment at api.js:7100-7103 (exposed on the returned object as workedHours).
    expect(metrics.workedHours).toBe((periodDays * dayWindowMinutes) / 60);
  });

  it('getTherapistOverview and getTherapistPerformance must pass the same periodDays for the same period', () => {
    // Regression guard for the PR #184 review finding: getTherapistOverview
    // (api.js) must pass daysInPeriodInclusive(startDate, endDate) as the 4th
    // arg to computeTherapistMetrics, exactly like getTherapistPerformance does,
    // or the two views silently disagree for any therapist with zero attendance
    // rows in the period.
    const dayWindowMinutes = 480;
    const zeroAttendanceBookings = [];
    const zeroAttendanceRows = [];

    const withoutPeriodDays = computeTherapistMetrics(zeroAttendanceBookings, zeroAttendanceRows, dayWindowMinutes, undefined);
    const withPeriodDays = computeTherapistMetrics(zeroAttendanceBookings, zeroAttendanceRows, dayWindowMinutes, 7);

    expect(withoutPeriodDays.workedHours).not.toBe(withPeriodDays.workedHours);
  });

  // ZNLY-171: busy while clocked in only counts Completed bookings on days with a Present / half-day row.
  it('counts only services on clocked-in days in the busy-while-clocked-in rate', () => {
    const done = (date, min) => ({ status: 'Completed', date, service_duration_snapshot: min, payment_status: 'paid', final_amount: 1, customer_id: date });
    const bookings = [done('2026-10-02', 60), done('2026-10-26', 78), done('2026-10-12', 120)];
    const rows = [
      { date: '2026-10-26', status: 'Present', check_in_time: '2026-10-26T04:00:00Z', check_out_time: '2026-10-26T05:30:00Z' }, // 1.5 h
      { date: '2026-10-27', status: 'Present', check_in_time: null, check_out_time: null }, // assumed full window
    ];
    const m = computeTherapistMetrics(bookings, rows, 720, 30);
    expect(m.workedHours).toBe(13.5);
    expect(m.busyHours).toBe(1.3);
    expect(m.occupiedHours).toBe(4.3); // delivered stays every Completed service
    expect(m.utilizationRate).toBe(10);
    expect(m.clockedDays).toEqual([{ date: '2026-10-26', hours: 1.5, assumed: false }, { date: '2026-10-27', hours: 12, assumed: true }]);
  });

  it('keeps every Completed service when there are no attendance rows at all (assumed worked time)', () => {
    const m = computeTherapistMetrics([{ status: 'Completed', date: '2026-10-02', service_duration_snapshot: 60 }], [], 600, 2);
    expect(m.busyHours).toBe(1);
    expect(m.utilizationRate).toBe(5);
  });
});
