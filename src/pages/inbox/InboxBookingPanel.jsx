import React, { useCallback, useEffect, useRef, useState } from 'react';
import BookingActionModal from '../../components/ui/BookingActionModal';
import SidePanel from '../../components/ui/SidePanel';
import { useAuth } from '../../contexts/AuthContext';
import { useAvailabilityGuard } from '../../contexts/AvailabilityOverrideContext';
import { supabase } from '../../lib/supabase';
import {
  fetchBookingById, fetchServices, fetchTherapists, fetchRooms, updateBookingStatus, updateBookingDetails, assignTherapist,
  recordPayment, recordTip, applyDiscount,
} from '../../services/api';
import { transformBooking, toDbStatus } from '../../services/bookingTransformers';
import { friendlyError } from '../../utils/friendlyError';
import { useIndustry } from '../../hooks/useIndustry';
import { bookingWords } from '../../components/ui/NotificationBell';
import { teamMemberLower, teamMemberCap } from '../../utils/industryTerms';

// The Bookings page's side panel, opened from an Inbox row (ZNLY-135 V35b). Same BookingActionModal, same API calls;
// it loads just what the panel needs (this booking's branch lists) instead of the whole list.
const InboxBookingPanel = ({ bookingId, onClose, onChanged }) => {
  const { profile } = useAuth();
  const { guard } = useAvailabilityGuard();
  const industry = useIndustry();
  const words = bookingWords(industry);
  const role = profile?.role || 'staff';
  const readOnly = !profile?.role || role === 'admin_viewer';
  const [booking, setBooking] = useState(null);
  const [missing, setMissing] = useState(false);
  const [lists, setLists] = useState({ services: [], therapists: [], rooms: [], branchHours: undefined });
  const [toast, setToast] = useState(null);
  const idRef = useRef(bookingId);
  idRef.current = bookingId;
  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const refresh = useCallback(async (id = idRef.current) => {
    if (!id) return;
    const r = await fetchBookingById(id);
    if (id !== idRef.current) return;
    if (r.error || !r.data) { setMissing(true); setBooking(null); return; }
    setMissing(false);
    setBooking(transformBooking(r.data));
  }, []);

  useEffect(() => {
    setBooking(null); setMissing(false);
    if (bookingId) refresh(bookingId);
  }, [bookingId, refresh]);

  // Branch lists for the panel's dropdowns, once the booking tells us its branch and day.
  const branchId = booking?.branchId || booking?.branch_id || null;
  const day = booking?.date;
  useEffect(() => {
    if (!branchId) return undefined;
    let alive = true;
    (async () => {
      const [sv, th, rm, br] = await Promise.all([
        fetchServices(branchId),
        fetchTherapists(branchId, { date: day }),
        fetchRooms(branchId),
        supabase.from('branches').select('open_time, close_time').eq('id', branchId).maybeSingle(),
      ]);
      if (!alive) return;
      setLists({
        services: sv.data || [],
        therapists: (th.data || []).map((t) => ({ id: t.id, name: t.name, gender: t.gender, specialties: t.specialties || [], room: null, status: 'available', currentBooking: null })),
        rooms: rm.data || [],
        branchHours: br.data ? { openTime: br.data.open_time || '09:00:00', closeTime: br.data.close_time || '21:00:00' } : undefined,
      });
    })();
    return () => { alive = false; };
  }, [branchId, day]);

  const after = async (id) => { await refresh(id); onChanged?.(); };

  const handleStatusUpdate = async (id, newStatus, reason, opts) => {
    const r = await updateBookingStatus({ bookingId: id, newStatus: toDbStatus(newStatus), reason });
    if (r.error && opts?.inline) return { error: r.error };
    if (r.error) { showToast(friendlyError(r.error, 'Failed to update status.'), 'error'); return; }
    showToast(`Status updated to ${newStatus}`);
    await after(id);
  };
  const handleAssignTherapist = async (id, therapistIds, notes, roomId, therapistRoomOverrides, companionName, companionPhone, opts) => {
    const ids = Array.isArray(therapistIds) ? therapistIds : (therapistIds ? [therapistIds] : []);
    const r = await guard((overrideReason) => assignTherapist({
      bookingId: id, therapistIds: ids, roomId: roomId !== undefined ? (roomId || null) : undefined, therapistRoomOverrides, companionName, companionPhone, overrideReason,
    }));
    if (r.error && opts?.inline) return { error: r.error };
    if (r.error) { showToast(friendlyError(r.error, `Failed to assign ${teamMemberLower()}.`), 'error'); return; }
    showToast(`${teamMemberCap()} assigned successfully`);
    await after(id);
  };
  const handleRecordPayment = async (id, opts) => {
    const { tipSplits, ...paymentOpts } = opts;
    const r = await recordPayment({ bookingId: id, ...paymentOpts });
    if (r.error) return { error: r.error };
    for (const split of (tipSplits || [])) {
      const t = await recordTip({ bookingId: id, amount: split.amount, receivedBy: split.receivedBy });
      if (t.error) console.warn('[Tips] recordTip failed:', t.error.message);
    }
    showToast('Payment recorded successfully');
    await after(id);
    return { error: null };
  };
  const handleGroupPaymentRecorded = async () => { showToast('Payment recorded successfully'); await after(idRef.current); };
  const handleApplyDiscount = async (id, { discountType, discountValue, discountReason, requestedTo }) => {
    const r = await applyDiscount({ bookingId: id, discountType, discountValue, discountReason, requestedTo });
    if (r.error) return { error: r.error };
    showToast(r.data?.isPending ? 'Discount request sent for approval' : Number(discountValue) === 0 ? 'Discount removed' : 'Discount applied successfully');
    await after(id);
    return { data: r.data };
  };
  const handleEditBooking = async (id, updates, opts) => {
    const r = await guard((overrideReason) => updateBookingDetails({ bookingId: id, ...updates, overrideReason }));
    if (r.error) { if (!opts?.inline) showToast(friendlyError(r.error, 'Failed to update booking.'), 'error'); return { error: r.error }; }
    showToast('Booking updated successfully');
    await after(id);
    return { error: null };
  };

  if (missing) {
    return (
      <SidePanel isOpen={!!bookingId} title={`This ${words.one} no longer exists`} onClose={onClose}>
        <p className="px-5 py-4 text-[13px] text-text-secondary">It was deleted after this notification was sent. The notification stays here as a record.</p>
      </SidePanel>
    );
  }
  return (
    <>
      <BookingActionModal
        variant="panel"
        isOpen={!!bookingId}
        previewBooking={null}
        onRefreshBooking={refresh}
        onClose={onClose}
        booking={booking}
        therapists={lists.therapists}
        rooms={lists.rooms}
        services={lists.services}
        branchHours={lists.branchHours}
        onAssignTherapist={handleAssignTherapist}
        onUpdateStatus={handleStatusUpdate}
        onRecordPayment={handleRecordPayment}
        onGroupPaymentRecorded={handleGroupPaymentRecorded}
        onApplyDiscount={handleApplyDiscount}
        onEditBooking={readOnly ? undefined : handleEditBooking}
        userRole={role}
        onViewBooking={() => {}}
      />
      {toast && (
        <div className={`fixed toast-top left-1/2 -translate-x-1/2 z-toast px-5 py-3 rounded-lg shadow-lg ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}>
          <span className="text-sm font-medium">{toast.msg}</span>
        </div>
      )}
    </>
  );
};

export default InboxBookingPanel;
