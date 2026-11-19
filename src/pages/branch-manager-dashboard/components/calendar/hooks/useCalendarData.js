import { useState, useEffect, useCallback } from 'react';
import {
  getCalendarBookings,
  fetchBlocksForRange,
  fetchTransferOccurrences,
  fetchShiftsForRange,
  isTransferFeatureMissing,
  fetchAttendance,
  LEAVE_LIKE_ATTENDANCE_STATUSES,
  updateTherapistOrder,
  updateRoomOrder,
  invalidateBookingDayCounts,
} from '../../../../../services/api';
import { getDateRange } from '../calendarDates';
import { indexShifts } from '../../../../../services/availabilityShading';

// Calendar data for the visible range: bookings/therapists/rooms, block + transfer occurrences, attendance, the
// blocks/transfers availability flags, and the optimistic column-reorder handlers. Auto-refresh is wired by the
// caller (it needs the panel/drag state that decides when to pause).
export function useCalendarData({ branchId, currentDate, viewMode }) {
  // Calendar data state
  const [calendarData, setCalendarData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Attendance indicators
  const [attendanceMap, setAttendanceMap] = useState({});
  // { [therapistId]: { status, checkInTime, checkOutTime } } for the first visible day: feeds today's column-header status line.
  const [attendanceByTherapist, setAttendanceByTherapist] = useState({});
  // Availability rule rows for the visible range, { [therapistId]: { [date]: row } } (therapist_shifts_for_range).
  const [shiftsByTherapist, setShiftsByTherapist] = useState({});

  // False when the DB has no manual_blocks table yet (migration-001 not applied): hides "Add block".
  const [blocksAvailable, setBlocksAvailable] = useState(true);
  // Staff transfers. False when the DB has no transfer tables/RPCs yet (migrations 003–005 not applied).
  const [transfersAvailable, setTransfersAvailable] = useState(true);

  // ── Data fetching ──────────────────────────────────────────

  const fetchData = useCallback(async (startDate, endDate) => {
    if (!branchId || !startDate || !endDate) return;

    setLoading(true);
    setError(null);

    const [result, attResult, blocksResult, transferResult, shiftsResult] = await Promise.all([
      getCalendarBookings(branchId, startDate, endDate),
      fetchAttendance({ branchId, date: startDate }),
      fetchBlocksForRange(branchId, startDate, endDate),
      fetchTransferOccurrences(branchId, startDate, endDate),
      fetchShiftsForRange({ branchId, startDate, endDate }),
    ]);

    if (result.error) {
      setError(result.error.message || 'Failed to load calendar data.');
      setLoading(false);
      return;
    }

    // Blocks are best-effort: a failure (e.g. DB without migration-001) must not break the calendar.
    const blocksTableMissing = ['PGRST205', '42P01'].includes(blocksResult.error?.code);
    setBlocksAvailable(!blocksTableMissing);
    setTransfersAvailable(!isTransferFeatureMissing(transferResult.error));
    setCalendarData({ ...result.data, blockOccurrences: blocksResult.data || [], transferOccurrences: transferResult.data || [] });

    const attMap = {};
    if (attResult.data) {
      for (const a of attResult.data) {
        if (a.status === 'Absent' || LEAVE_LIKE_ATTENDANCE_STATUSES.includes(a.status)) {
          attMap[a.therapistId] = a.status === 'Absent' ? 'Absent' : 'Leave';
        }
      }
    }
    setAttendanceMap(attMap);
    setAttendanceByTherapist(Object.fromEntries((attResult.data || []).filter((a) => a.status).map((a) => [a.therapistId, { status: a.status, checkInTime: a.checkInTime || null, checkOutTime: a.checkOutTime || null }])));
    setShiftsByTherapist(indexShifts(shiftsResult.data));
    setLoading(false);
  }, [branchId]);

  // Reload when date or view changes
  useEffect(() => {
    if (!branchId) return;
    const { start, end } = getDateRange(currentDate, viewMode);
    fetchData(start, end);
  }, [branchId, currentDate, viewMode, fetchData]);

  const refreshCalendar = useCallback(() => {
    invalidateBookingDayCounts(); // picker counts must reflect what just changed
    const { start, end } = getDateRange(currentDate, viewMode);
    fetchData(start, end);
  }, [currentDate, viewMode, fetchData]);

  const handleTherapistReorder = useCallback(async (orderedIds) => {
    if (!branchId) return;
    // Optimistic: reorder therapists array in local state
    setCalendarData(prev => {
      if (!prev) return prev;
      const therapistMap = {};
      prev.therapists.forEach(t => { therapistMap[t.id] = t; });
      const reordered = orderedIds
        .map(id => therapistMap[id])
        .filter(Boolean);
      // Append any therapists not in orderedIds (safety)
      prev.therapists.forEach(t => {
        if (!orderedIds.includes(t.id)) reordered.push(t);
      });
      return { ...prev, therapists: reordered };
    });

    // Persist to DB
    const { error } = await updateTherapistOrder({ branchId, orderedIds });
    if (error) {
      console.error('[Calendar] Failed to persist therapist order:', error.message);
      refreshCalendar();
    }
  }, [branchId, refreshCalendar]);

  // ── Room column reorder ───────────────────────────────────
  const handleRoomReorder = useCallback(async (orderedIds) => {
    if (!branchId) return;
    // Optimistic: reorder rooms array in local state
    setCalendarData(prev => {
      if (!prev) return prev;
      const roomMap = {};
      prev.rooms.forEach(r => { roomMap[r.id] = r; });
      const reordered = orderedIds
        .map(id => roomMap[id])
        .filter(Boolean);
      // Append any rooms not in orderedIds (safety)
      prev.rooms.forEach(r => {
        if (!orderedIds.includes(r.id)) reordered.push(r);
      });
      return { ...prev, rooms: reordered };
    });

    // Persist to DB
    const { error } = await updateRoomOrder({ branchId, orderedIds });
    if (error) {
      console.error('[Calendar] Failed to persist room order:', error.message);
      refreshCalendar();
    }
  }, [branchId, refreshCalendar]);


  return {
    calendarData, setCalendarData, loading, error, attendanceMap, attendanceByTherapist, shiftsByTherapist, blocksAvailable, transfersAvailable,
    fetchData, refreshCalendar, handleTherapistReorder, handleRoomReorder,
  };
}
