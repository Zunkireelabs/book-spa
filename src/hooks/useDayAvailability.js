import { useEffect, useMemo, useState } from 'react';
import { getCalendarBookings, fetchAttendance, fetchShiftsForRange, LEAVE_LIKE_ATTENDANCE_STATUSES } from '../services/api';
import { indexShifts } from '../services/availabilityShading';
import { offStaffReasons } from '../utils/staffFit';

// ZNLY-312: Free / Busy / Off for ONE day of ONE branch, for panels whose caller did not pass the calendar's own data.
// Same sources the calendar uses (getCalendarBookings + attendance + roster). Fetches only while `enabled`; keyed on
// branch + date (+ `refreshKey`, e.g. the booking's assigned staff, so a saved assignment is re-read).
// Returns { ready, failed, bookings, offById }. Not ready (loading, error, disabled) => the caller keeps the plain staff list.
export function useDayAvailability({ branchId, date, enabled, refreshKey = '' }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!enabled || !branchId || !date) { setState(null); return undefined; }
    let live = true;
    Promise.all([getCalendarBookings(branchId, date, date), fetchAttendance({ branchId, date }), fetchShiftsForRange({ branchId, startDate: date, endDate: date })])
      .then(([cal, att, sh]) => {
        if (!live) return;
        if (cal.error || !cal.data) { setState({ key: `${branchId}|${date}`, failed: true }); return; } // error: stay on the plain list, no message
        const attMap = {};
        for (const a of att.data || []) if (a.status === 'Absent' || LEAVE_LIKE_ATTENDANCE_STATUSES.includes(a.status)) attMap[a.therapistId] = a.status === 'Absent' ? 'Absent' : 'Leave';
        const people = (cal.data.therapists || []).filter((t) => t.is_service_staff !== false);
        setState({ key: `${branchId}|${date}`, bookings: cal.data.bookings || [], offById: offStaffReasons(people, { attendanceMap: attMap, shiftsByTherapist: indexShifts(sh.data), date }) });
      })
      .catch(() => { if (live) setState({ key: `${branchId}|${date}`, failed: true }); });
    return () => { live = false; };
  }, [enabled, branchId, date, refreshKey]);
  return useMemo(() => {
    if (!enabled || !state || state.key !== `${branchId}|${date}`) return { ready: false, failed: false, bookings: null, offById: {} };
    if (state.failed) return { ready: false, failed: true, bookings: null, offById: {} };
    return { ready: true, failed: false, bookings: state.bookings, offById: state.offById };
  }, [enabled, state, branchId, date]);
}
