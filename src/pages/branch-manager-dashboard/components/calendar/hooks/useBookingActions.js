import { useCallback } from 'react';
import { refreshLight } from '../refreshLight';
import {
  updateBookingStatus,
  assignTherapist,
  recordPayment,
  recordTip,
  updateBookingDetails,
  fetchBookingById,
  applyDiscount,
  updateTherapistTime,
  resizeSharedBookingTime,
} from '../../../../../services/api';
import { transformBooking, toDbStatus } from '../../../../../services/bookingTransformers';
import { useAvailabilityGuard } from '../../../../../contexts/AvailabilityOverrideContext';
import { teamMemberLower } from '../../../../../utils/industryTerms';

// Booking-level actions wired to the booking panel (status, assignment, edit, discount, payment) plus the
// shared-booking card resize from the grid.
export function useBookingActions({ showToast, refreshCalendar, selectedBooking, setSelectedBooking, getSelectedBookingsRef, staffLabel, showGuide }) {
  const { guard } = useAvailabilityGuard();
  const handleStatusUpdate = async (bookingId, newStatus, reason, opts) => {
    const dbStatus = toDbStatus(newStatus);
    const result = await updateBookingStatus({ bookingId, newStatus: dbStatus, reason });
    if (result.error) {
      // The booking panel shows the ✦ guidance card itself (opts.inline): no toast, just hand the error back.
      if (opts?.inline) return { error: result.error };
      showToast(result.error.message || 'Failed to update status.', 'error');
      return;
    }
    showToast(`Status updated to ${newStatus}`);
  };

  const handleAssignTherapist = async (bookingId, therapistIds, notes, roomId, therapistRoomOverrides, companionName, companionPhone, opts) => {
    const ids = Array.isArray(therapistIds) ? therapistIds : (therapistIds ? [therapistIds] : []);
    const result = await guard((overrideReason) => assignTherapist({
      bookingId,
      therapistIds: ids,
      roomId: roomId !== undefined ? (roomId || null) : undefined,
      // Couple services only (the booking panel gates these on is_couple): per-companion room override + companion info.
      therapistRoomOverrides,
      companionName,
      companionPhone,
      overrideReason,
    }));
    if (result.error) {
      if (opts?.inline) return { error: result.error };
      showToast(result.error.message || `Failed to assign ${staffLabel.toLowerCase()}.`, 'error');
      return;
    }
    if (result.data?.warning) {
      showToast(`Assignment partially saved: ${result.data.warning}`, 'error');
      return;
    }
    showToast('Assignment saved successfully');
  };

  const handleBookingResize = useCallback(async (booking, deltaMinutes, direction) => {
    if (!booking.isShared || !booking._colTherapistId) return;

    const [sh, sm] = (booking.startTime || '').split(':').map(Number);
    const [eh, em] = (booking.endTime || '').split(':').map(Number);
    if (isNaN(sh) || isNaN(eh)) return;

    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;
    let newStartMins = startMins;
    let newEndMins = endMins;

    if (direction === 'top') {
      newStartMins = Math.max(startMins + deltaMinutes, 0);
    } else {
      newEndMins = Math.max(endMins + deltaMinutes, 0);
    }

    // Ensure minimum 5 min duration
    if (newEndMins - newStartMins < 5) {
      showToast('Minimum duration is 5 minutes.', 'error');
      return;
    }

    const newStartTime = `${String(Math.floor(newStartMins / 60)).padStart(2, '0')}:${String(newStartMins % 60).padStart(2, '0')}`;
    const newEndTime = `${String(Math.floor(newEndMins / 60)).padStart(2, '0')}:${String(newEndMins % 60).padStart(2, '0')}`;

    // Same default-vs-independent gate as the drag handler above: resizing an
    // explicitly Cmd/Ctrl-selected card moves only that therapist; otherwise the
    // whole shared booking (every co-therapist + the canonical bookings row)
    // resizes together, so one resize can never silently desync a co-therapist
    // from the rest of the booking (see resizeSharedBookingTime in api.js).
    const selectedBookings = getSelectedBookingsRef.current();
    const draggedKey = `${booking.id}__${booking._colTherapistId}`;
    const isPartOfSelection = selectedBookings.length > 0 && selectedBookings.some(b => `${b.id}__${b._colTherapistId}` === draggedKey);

    const bookingId = booking.bookingId || booking.id;
    const result = isPartOfSelection
      ? await guard((overrideReason) => updateTherapistTime({
          bookingId,
          therapistId: booking._colTherapistId,
          startTime: newStartTime,
          endTime: newEndTime,
          overrideReason,
        }))
      : await guard((overrideReason) => resizeSharedBookingTime({ bookingId, startTime: newStartTime, endTime: newEndTime, overrideReason }));

    if (result.error) {
      if (showGuide) showGuide(result.error, {}, 'calendar-resize'); else showToast(result.error.message || 'Failed to resize.', 'error');
    } else if (isPartOfSelection) {
      showToast(`Resized ${booking.therapistName || teamMemberLower()} independently to ${newStartTime} – ${newEndTime}`, 'success');
    } else {
      showToast(`Resized to ${newStartTime} – ${newEndTime}`, 'success');
    }
    refreshLight(refreshCalendar);
  }, [refreshCalendar, guard]);

  const handleEditBooking = async (bookingId, updates, opts) => {
    const result = await guard((overrideReason) => updateBookingDetails({ bookingId, ...updates, overrideReason }));
    if (result.error) {
      if (!opts?.inline) showToast(result.error.message || 'Failed to update booking.', 'error');
      return { error: result.error };
    }
    showToast('Booking updated successfully');
    // Re-fetch the booking to update modal data
    const refreshed = await fetchBookingById(bookingId);
    if (!refreshed.error) {
      setSelectedBooking(transformBooking(refreshed.data));
    }
    refreshLight(refreshCalendar);
    return { error: null };
  };

  const handleApplyDiscount = async (bookingId, { discountType, discountValue, discountReason, requestedTo }) => {
    const result = await applyDiscount({ bookingId, discountType, discountValue, discountReason, requestedTo });
    if (result.error) return { error: result.error };
    showToast(result.data?.isPending ? 'Discount request sent for approval' : Number(discountValue) === 0 ? 'Discount removed' : 'Discount applied successfully');
    // Refresh booking in modal
    const refreshed = await fetchBookingById(bookingId);
    if (!refreshed.error) setSelectedBooking(transformBooking(refreshed.data));
    refreshLight(refreshCalendar);
    return { data: result.data };
  };

  const handleRecordPayment = async (bookingId, opts) => {
    // Zennly: PaymentModal's multi-recipient tip split. (Kept here so a typed tip is never silently dropped; step 7 owns the rest of the tips/group-payment re-apply.)
    const { tipSplits, ...paymentOpts } = opts;
    const result = await recordPayment({ bookingId, ...paymentOpts });
    if (result.error) {
      return { error: result.error };
    }
    // Best-effort — tip is a separate, independent record (migration-240) and must never undo or block a payment that already succeeded.
    for (const split of (tipSplits || [])) {
      const tipResult = await recordTip({ bookingId, amount: split.amount, receivedBy: split.receivedBy });
      if (tipResult.error) console.warn('[Tips] recordTip failed:', tipResult.error.message);
    }
    showToast('Payment recorded successfully');
    // Only refresh the modal's displayed booking when this payment was for the
    // booking currently open (not a bundled previous-due/related payment for a
    // different booking) — otherwise the modal would flip to showing whichever
    // bundled booking happened to be paid last.
    if (selectedBooking && bookingId === selectedBooking.bookingId) {
      const refreshed = await fetchBookingById(bookingId);
      if (!refreshed.error) setSelectedBooking(transformBooking(refreshed.data));
    }
    refreshLight(refreshCalendar);
    return { error: null };
  };

  // Tail-only counterpart to handleRecordPayment for the atomic recordGroupPayment path (BookingActionModal): the write already
  // happened in one transaction covering every booking in the bundle, so just toast and refresh once.
  const handleGroupPaymentRecorded = () => {
    showToast('Payment recorded successfully');
    refreshLight(refreshCalendar);
    if (selectedBooking) {
      fetchBookingById(selectedBooking.bookingId).then((refreshed) => {
        if (!refreshed.error) setSelectedBooking(transformBooking(refreshed.data));
      });
    }
  };

  return { handleStatusUpdate, handleAssignTherapist, handleBookingResize, handleEditBooking, handleApplyDiscount, handleRecordPayment, handleGroupPaymentRecorded };
}
