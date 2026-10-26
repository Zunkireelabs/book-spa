import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import {
  updateBlock,
  rescheduleBooking,
  assignTherapist,
  updateTherapistTime,
} from '../../../../../services/api';
import { findBlockOverlap, describeBlockOverlap } from '../../../../../utils/blockOverlap';
import { HOUR_HEIGHT } from '../CalendarGrid';
import { formatTimeFromSlot, calculateEndTime } from '../calendarDates';
import { isCheckedOutBlockedSlot } from '../calendarSlots';
import { useAvailabilityGuard } from '../../../../../contexts/AvailabilityOverrideContext';

// Drag-and-drop for the calendar grid: sensors, pointer tracking, drag start/move/over/end, block drag, the
// cross-column confirm state and its execution.
export function useCalendarDnd({ calendarData, setCalendarData, columnMode, refreshCalendar, showToast, gridRef, getSelectedBookingsRef }) {
  const { guard } = useAvailabilityGuard();
  // Drag state
  const [activeDragId, setActiveDragId] = useState(null);
  const [activeDragBooking, setActiveDragBooking] = useState(null);
  const [overSlotData, setOverSlotData] = useState(null); // { hour, minute, day }
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [dragGrabOffset, setDragGrabOffset] = useState(0); // Y offset from card top where user grabbed

  // Cross-column reassignment confirmation
  const [pendingReassign, setPendingReassign] = useState(null);

  const [activeDragBlock, setActiveDragBlock] = useState(null);

  // Configure drag sensors with activation constraints
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        // Require 5px movement or 150ms delay before drag starts
        // This prevents accidental drags and allows clicks to work
        distance: 5,
      },
    })
  );

  // Ref to track current pointer Y position during drag (synchronous updates)
  const pointerYRef = useRef(null);

  // Track pointer position during drag
  useEffect(() => {
    if (!activeDragId) {
      pointerYRef.current = null;
      return;
    }

    const handlePointerMove = (e) => {
      pointerYRef.current = e.clientY;
    };

    document.addEventListener('pointermove', handlePointerMove);
    return () => document.removeEventListener('pointermove', handlePointerMove);
  }, [activeDragId]);

  // Calculate time slot from pointer Y position
  const calculateTimeFromPointer = useCallback((overData) => {
    if (!overData || !gridRef.current || pointerYRef.current === null) {
      return null;
    }

    const { day, colId, openHour } = overData;
    const gridRect = gridRef.current.getBoundingClientRect();

    // Get cursor position relative to the grid body element
    // Subtract dragGrabOffset so the card's TOP edge aligns with the time slot
    // (not the cursor position which could be anywhere on the card)
    const relativeY = pointerYRef.current - gridRect.top - dragGrabOffset;

    // Calculate hour and minute from Y position — read the live (possibly
    // pinch-zoomed) effective hour height off the grid DOM rather than the
    // static constant, so drag-drop stays accurate at any zoom level.
    const effectiveHourHeight = parseFloat(gridRef.current.dataset.hourHeight) || HOUR_HEIGHT;
    const minutesFromTop = (relativeY / effectiveHourHeight) * 60;
    const hour = Math.floor(minutesFromTop / 60) + openHour;
    const rawMinute = minutesFromTop % 60;
    const minute = Math.floor(rawMinute / 10) * 10; // Snap to 10-minute intervals (matches click + hover label)

    // Clamp to valid hours
    if (hour < openHour || minute < 0) {
      return { day, colId, hour: openHour, minute: 0 };
    }

    return { day, colId, hour, minute };
  }, [dragGrabOffset]);

  // ── Drag and Drop Handlers ────────────────────────────────

  const handleDragStart = useCallback((event) => {
    const { active, activatorEvent } = event;
    setActiveDragId(active.id);

    if (active.data.current?.type === 'manual-block') {
      setActiveDragBlock(active.data.current.block);
      // Align the block's TOP edge with the slot (not wherever on the block the cursor grabbed it).
      // Same method as bookings below: expected top from the start time (the drop math has no TOP_PAD).
      const blk = active.data.current.block;
      if (blk?.fromTime && gridRef.current) {
        const gridRect = gridRef.current.getBoundingClientRect();
        const openHour = parseInt(gridRef.current.dataset?.openHour || '9', 10);
        const hourHeight = parseFloat(gridRef.current.dataset?.hourHeight || '72');
        const [bh, bm] = blk.fromTime.split(':').map(Number);
        const expectedTop = gridRect.top + (((bh - openHour) * 60 + bm) / 60) * hourHeight;
        setDragGrabOffset((activatorEvent?.clientY ?? expectedTop) - expectedTop);
      } else {
        setDragGrabOffset(0);
      }
      return;
    }

    const booking = active.data.current?.booking;
    if (booking) {
      setActiveDragBooking(booking);
    }

    // Calculate how far down the card the user grabbed
    // This offset is used to align the card's TOP edge with the time slot
    const cursorY = activatorEvent?.clientY ?? 0;

    // Calculate expected card top position based on booking's start time
    // This is more reliable than trying to get the DOM element's position
    if (booking?.startTime && gridRef.current) {
      const gridRect = gridRef.current.getBoundingClientRect();
      const openHour = parseInt(gridRef.current.dataset?.openHour || '9', 10);
      const hourHeight = parseInt(gridRef.current.dataset?.hourHeight || '120', 10);

      const [bookingHour, bookingMinute] = booking.startTime.split(':').map(Number);
      const minutesFromOpen = (bookingHour - openHour) * 60 + bookingMinute;
      const expectedCardTop = gridRect.top + (minutesFromOpen / 60) * hourHeight;

      const grabOffset = cursorY - expectedCardTop;
      setDragGrabOffset(grabOffset);
    } else {
      setDragGrabOffset(0);
    }
  }, []);

  // Called on every mouse move during drag - calculates time from position
  const handleDragMove = useCallback((event) => {
    const { over } = event;
    if (!over?.data?.current) {
      setOverSlotData(null);
      return;
    }

    const timeData = calculateTimeFromPointer(over.data.current);
    if (timeData) {
      setOverSlotData(timeData);
    }
  }, [calculateTimeFromPointer]);

  // Called when hovering over a new droppable (less frequent than dragMove)
  const handleDragOver = useCallback((event) => {
    const { over } = event;
    if (!over?.data?.current) {
      setOverSlotData(null);
      return;
    }

    const timeData = calculateTimeFromPointer(over.data.current);
    if (timeData) {
      setOverSlotData(timeData);
    }
  }, [calculateTimeFromPointer]);

  // Build column name lookup maps for confirmation dialog
  const colNameMap = useMemo(() => {
    const map = { unassigned: 'Unassigned' };
    if (calendarData?.therapists) {
      for (const t of calendarData.therapists) map[t.id] = t.name;
    }
    if (calendarData?.rooms) {
      for (const r of calendarData.rooms) map[r.id] = r.name;
    }
    return map;
  }, [calendarData]);

  // Drag a block to a new day/time/column. Scoped to this occurrence (a recurring block's dragged
  // occurrence spins off its own one-off row). Declared above handleDragEnd because that callback's
  // dependency array references it eagerly.
  const handleMoveManualBlock = useCallback(async (block, newDate, newStartTime, targetColId) => {
    const patch = { blockId: block.blockId, scope: 'this', occurrenceDate: block.day, blockDate: newDate, startTime: newStartTime };
    // A whole-branch block renders one copy per column — moving whichever copy was grabbed must only
    // change day/time, never narrow it to that one column.
    if (!block.isWholeBranch) {
      if (columnMode === 'therapist') {
        patch.therapistId = targetColId === 'unassigned' ? null : targetColId;
      } else if (columnMode === 'room') {
        patch.roomId = targetColId === 'unassigned' ? null : targetColId;
      }
    }
    const result = await updateBlock(patch);
    if (result.error) {
      showToast(result.error.message || 'Failed to move block.', 'error');
      return;
    }
    refreshCalendar();
  }, [columnMode, refreshCalendar]);

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;

    if (active.data.current?.type === 'manual-block') {
      const finalTimeData = over?.data?.current
        ? calculateTimeFromPointer(over.data.current)
        : overSlotData;
      const block = active.data.current.block;
      setActiveDragId(null);
      setActiveDragBlock(null);
      setOverSlotData(null);
      setDragGrabOffset(0);

      if (!finalTimeData || finalTimeData.hour === undefined) return;
      const { day: newDate, colId: targetColId, hour, minute } = finalTimeData;
      const newStartTime = formatTimeFromSlot(hour, minute);
      const effectiveTargetColId = targetColId || 'unassigned';
      const sourceColId = block.colId || 'unassigned';
      if (newDate === block.day && newStartTime === block.fromTime.slice(0, 5) && effectiveTargetColId === sourceColId) {
        return; // no change
      }
      handleMoveManualBlock(block, newDate, newStartTime, targetColId);
      return;
    }

    // Capture final position before clearing state
    // Fallback to last overSlotData if over is null (same-column drag may not trigger new over)
    const finalTimeData = over?.data?.current
      ? calculateTimeFromPointer(over.data.current)
      : overSlotData;

    // If not dropped on a valid target, just clear state
    if (!active.data.current?.booking || !finalTimeData) {
      setActiveDragId(null);
      setActiveDragBooking(null);
      setOverSlotData(null);
      setDragGrabOffset(0);
      return;
    }

    const booking = active.data.current.booking;
    const { day: newDate, colId: targetColId, hour, minute } = finalTimeData;

    if (hour === undefined || minute === undefined) {
      setActiveDragId(null);
      setActiveDragBooking(null);
      setOverSlotData(null);
      setDragGrabOffset(0);
      return;
    }

    const newStartTime = formatTimeFromSlot(hour, minute);
    const bookingId = booking.bookingId || booking.id;

    // Determine source column based on column mode
    // For shared bookings, use the column-specific therapist ID
    const sourceColId = columnMode === 'therapist'
      ? (booking._colTherapistId || booking.therapistId || 'unassigned')
      : (booking.roomId || 'unassigned');
    const effectiveTargetColId = targetColId || 'unassigned';

    const isCrossColumn = sourceColId !== effectiveTargetColId;

    // Check if anything actually changed
    const oldTime = booking.startTime?.slice(0, 5);
    const oldDate = booking.date;
    if (oldTime === newStartTime && oldDate === newDate && !isCrossColumn) {
      setActiveDragId(null);
      setActiveDragBooking(null);
      setOverSlotData(null);
      setDragGrabOffset(0);
      return; // No change
    }

    // Calculate new end time
    const durationMinutes = booking.serviceDuration ||
      (booking.startTime && booking.endTime
        ? (() => {
            const [sh, sm] = booking.startTime.split(':').map(Number);
            const [eh, em] = booking.endTime.split(':').map(Number);
            return (eh * 60 + em) - (sh * 60 + sm);
          })()
        : 60);
    const newEndTime = calculateEndTime(hour, minute, durationMinutes);

    // Clear drag state
    setActiveDragId(null);
    setActiveDragBooking(null);
    setOverSlotData(null);
    setDragGrabOffset(0);

    if (columnMode === 'therapist' && isCrossColumn) {
      if (isCheckedOutBlockedSlot(calendarData?.checkedOutByTherapistAndDate, effectiveTargetColId, newDate, hour, minute)) {
        showToast('This therapist has already checked out for the day and is not bookable after their check-out time.', 'error');
        return;
      }
    }

    const manualBlockOnDrop = findBlockOverlap([...(calendarData?.blockOccurrences || []), ...(calendarData?.transferOccurrences || [])], {
      date: newDate,
      startTime: newStartTime,
      endTime: newEndTime,
      therapistId: columnMode === 'therapist' ? effectiveTargetColId : null,
      roomId: columnMode === 'room' ? effectiveTargetColId : null,
    });
    if (manualBlockOnDrop) {
      showToast(describeBlockOverlap(manualBlockOnDrop), 'error');
      return;
    }

    if (isCrossColumn) {
      // Cross-column drop → show confirmation dialog
      setPendingReassign({
        booking,
        bookingId,
        newDate,
        newStartTime,
        newEndTime,
        durationMinutes,
        targetColId: effectiveTargetColId,
        sourceColId,
        targetColName: colNameMap[effectiveTargetColId] || effectiveTargetColId,
        sourceColName: colNameMap[sourceColId] || sourceColId,
        type: columnMode,
        timeChanged: oldTime !== newStartTime || oldDate !== newDate,
        isSharedReassign: booking.isShared && columnMode === 'therapist',
      });
    } else if (booking.isShared && booking._colTherapistId) {
      // Shared booking, same column — default: move ALL therapists together (reschedule whole booking)
      // Cmd/Ctrl selected = move only selected ones independently
      const selectedBookings = getSelectedBookingsRef.current();
      const draggedKey = `${booking.id}__${booking._colTherapistId}`;
      const isPartOfSelection = selectedBookings.length > 0 && selectedBookings.some(b => `${b.id}__${b._colTherapistId}` === draggedKey);

      if (isPartOfSelection) {
        // Cmd/Ctrl selected: move only selected cards independently
        const [oldH, oldM] = (booking.startTime || '').split(':').map(Number);
        const [newH, newM] = newStartTime.split(':').map(Number);
        const deltaMins = (newH * 60 + newM) - (oldH * 60 + oldM);

        const updates = selectedBookings.map(b => () => {
          const [sh, sm] = (b.startTime || '').split(':').map(Number);
          const [eh, em] = (b.endTime || '').split(':').map(Number);
          const ns = sh * 60 + sm + deltaMins;
          const ne = eh * 60 + em + deltaMins;
          return guard((overrideReason) => updateTherapistTime({
            bookingId: b.bookingId || b.id,
            therapistId: b._colTherapistId,
            startTime: `${String(Math.floor(ns / 60)).padStart(2, '0')}:${String(ns % 60).padStart(2, '0')}`,
            endTime: `${String(Math.floor(ne / 60)).padStart(2, '0')}:${String(ne % 60).padStart(2, '0')}`,
            overrideReason,
          }));
        });
        // one at a time: a "Book anyway" prompt may open for any of them
        (async () => {
          const results = [];
          for (const run of updates) results.push(await run());
          const failed = results.find(r => r.error);
          if (failed) showToast(failed.error.message || 'Failed to update.', 'error');
          else showToast(`Moved ${selectedBookings.length} selected`, 'success');
          refreshCalendar();
        })();
      } else {
        // Default: show confirmation dialog to reschedule entire booking (moves all therapists)
        setPendingReassign({
          booking,
          bookingId,
          newDate,
          newStartTime,
          newEndTime,
          durationMinutes,
          targetColId: effectiveTargetColId,
          sourceColId,
          targetColName: colNameMap[effectiveTargetColId] || effectiveTargetColId,
          sourceColName: colNameMap[sourceColId] || sourceColId,
          type: columnMode,
          timeChanged: true,
          timeOnly: true,
          isSharedReschedule: true,
        });
      }
      return;
    } else {
      // Same column — time-only reschedule, show confirmation dialog
      setPendingReassign({
        booking,
        bookingId,
        newDate,
        newStartTime,
        newEndTime,
        durationMinutes,
        targetColId: effectiveTargetColId,
        sourceColId,
        targetColName: colNameMap[effectiveTargetColId] || effectiveTargetColId,
        sourceColName: colNameMap[sourceColId] || sourceColId,
        type: columnMode,
        timeChanged: true,
        timeOnly: true,
      });
    }
  }, [refreshCalendar, calculateTimeFromPointer, columnMode, colNameMap, calendarData, handleMoveManualBlock, overSlotData, guard]);

  // Handle cross-column reassignment confirmation
  const handleConfirmReassign = useCallback(async () => {
    if (!pendingReassign) return;

    const { bookingId, newDate, newStartTime, newEndTime, targetColId, sourceColId, type, targetColName, timeOnly, isSharedReassign, isSharedReschedule } = pendingReassign;

    setPendingReassign(null);
    setIsRescheduling(true);

    try {
      if (isSharedReschedule) {
        // Shared booking time-only reschedule: moves all therapists together
        const result = await guard((overrideReason) => rescheduleBooking({ bookingId, newDate, newStartTime, overrideReason }));
        if (result.error) {
          showToast(result.error.message || 'Failed to reschedule.', 'error');
        } else {
          showToast(`Rescheduled to ${newStartTime}`, 'success');
        }
        refreshCalendar();
      } else if (isSharedReassign) {
        // Shared booking: swap therapist in junction table
        // Get current therapist IDs from the booking_therapists
        const currentBooking = calendarData?.bookings?.find(b => b.id === bookingId);
        const currentTherapistIds = currentBooking?.booking_therapists?.map(bt => bt.therapist_id) || [];

        if (currentTherapistIds.includes(targetColId) && targetColId !== sourceColId) {
          // Dragged to a therapist who already has this booking → consolidate (remove source)
          const newIds = currentTherapistIds.filter(id => id !== sourceColId);
          const result = await guard((overrideReason) => assignTherapist({ bookingId, therapistIds: newIds, overrideReason }));
          if (result.error) {
            showToast(result.error.message || 'Failed to consolidate assignment.', 'error');
          } else if (result.data?.warning) {
            showToast(`Assignment partially saved: ${result.data.warning}`, 'error');
          } else {
            showToast(`Consolidated to ${targetColName}`, 'success');
          }
        } else {
          // Dragged to a new therapist → replace source with target
          const newIds = currentTherapistIds.map(id => id === sourceColId ? targetColId : id);
          const result = await guard((overrideReason) => assignTherapist({ bookingId, therapistIds: newIds, overrideReason }));
          if (result.error) {
            showToast(result.error.message || 'Failed to reassign therapist.', 'error');
          } else if (result.data?.warning) {
            showToast(`Assignment partially saved: ${result.data.warning}`, 'error');
          } else {
            showToast(`Reassigned from ${colNameMap[sourceColId] || 'therapist'} to ${targetColName}`, 'success');
          }
        }
        refreshCalendar();
      } else {
        // Standard reassignment (non-shared)
        const apiParams = { bookingId, newDate, newStartTime };
        const optimisticFields = { date: newDate, start_time: newStartTime, end_time: newEndTime };

        if (!timeOnly) {
          if (type === 'therapist') {
            apiParams.newTherapistId = targetColId === 'unassigned' ? 'unassigned' : targetColId;
            optimisticFields.therapist_id = targetColId === 'unassigned' ? null : targetColId;
          } else {
            apiParams.newRoomId = targetColId === 'unassigned' ? 'unassigned' : targetColId;
            optimisticFields.room_id = targetColId === 'unassigned' ? null : targetColId;
          }
        }

        // Optimistic UI update
        setCalendarData(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            bookings: prev.bookings.map(b => {
              if (b.id === bookingId) return { ...b, ...optimisticFields };
              return b;
            }),
          };
        });

        const result = await guard((overrideReason) => rescheduleBooking({ ...apiParams, overrideReason }));
        if (result.error) {
          showToast(result.error.message || 'Failed to reassign booking.', 'error');
          refreshCalendar();
        } else {
          showToast(timeOnly ? `Rescheduled to ${newStartTime}` : `Reassigned to ${targetColName}`, 'success');
        }
      }
    } catch (err) {
      showToast('An error occurred while reassigning.', 'error');
      refreshCalendar();
    } finally {
      setIsRescheduling(false);
    }
  }, [pendingReassign, refreshCalendar, calendarData, colNameMap, guard]);

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
    setActiveDragBooking(null);
    setActiveDragBlock(null);
    setOverSlotData(null);
    setDragGrabOffset(0);
  }, []);


  return {
    sensors, activeDragId, activeDragBooking, activeDragBlock, overSlotData, isRescheduling, pendingReassign, setPendingReassign,
    handleDragStart, handleDragMove, handleDragOver, handleDragEnd, handleDragCancel, handleConfirmReassign,
  };
}
