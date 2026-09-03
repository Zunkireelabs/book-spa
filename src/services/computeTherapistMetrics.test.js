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
});
