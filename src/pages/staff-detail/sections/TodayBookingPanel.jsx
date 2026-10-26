import React, { useCallback, useEffect, useRef, useState } from 'react';
import BookingActionModal from '../../../components/ui/BookingActionModal';
import { useAuth } from '../../../contexts/AuthContext';
import { useIndustry } from '../../../hooks/useIndustry';
import { fetchBookingById, fetchServices, fetchRooms, fetchTherapistsForManagement } from '../../../services/api';
import { transformBooking } from '../../../services/bookingTransformers';
import { useBookingActions } from '../../branch-manager-dashboard/components/calendar/hooks/useBookingActions';

// The Calendar's right-hand booking panel, opened from a Today timeline block. Same component, same actions
// (status, assign, payment, discount, edit) as the Calendar; this only supplies what the Calendar's hooks normally do.
// Rebook / reschedule / quick-create are Calendar flows, so they are left out and the panel hides those buttons.
const TodayBookingPanel = ({ booking, branchId, onClose, onChanged }) => {
  const { profile } = useAuth();
  const { staffLabel } = useIndustry();
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState(null);
  const [lists, setLists] = useState({ services: [], rooms: [], therapists: [] });
  const bookingId = booking?.id;
  const openRef = useRef(null);
  openRef.current = bookingId;

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const refresh = useCallback(() => { onChanged?.(); }, [onChanged]);
  const actions = useBookingActions({ showToast, refreshCalendar: refresh, selectedBooking: selected, setSelectedBooking: setSelected, getSelectedBookingsRef: { current: () => [] }, staffLabel });

  useEffect(() => {
    if (!bookingId) { setSelected(null); return; }
    let live = true;
    fetchBookingById(bookingId).then((r) => {
      if (!live || openRef.current !== bookingId) return;
      if (r.error) { showToast(r.error.message || 'Failed to load booking.', 'error'); onClose(); return; }
      setSelected(transformBooking(r.data));
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  useEffect(() => {
    if (!bookingId || !branchId || lists.services.length) return;
    Promise.all([fetchServices(branchId), fetchRooms(branchId), fetchTherapistsForManagement(branchId)]).then(([s, r, t]) => {
      setLists({
        services: s.data || [],
        rooms: r.data || [],
        therapists: (t.data || []).filter((x) => x.is_service_staff !== false && x.is_active !== false).map((x) => ({ id: x.id, name: x.name, gender: x.gender, specialties: x.specialties || [] })),
      });
    });
  }, [bookingId, branchId, lists.services.length]);

  const refreshOpen = async (id) => {
    const r = await fetchBookingById(id);
    if (!r.error) setSelected(transformBooking(r.data));
    refresh();
  };

  return (
    <>
      <BookingActionModal
        variant="panel"
        isOpen={!!bookingId}
        previewBooking={booking ? { ...booking, bookingId: booking.id } : null}
        onRefreshBooking={refreshOpen}
        onClose={() => { setSelected(null); onClose(); refresh(); }}
        booking={selected}
        therapists={lists.therapists}
        rooms={lists.rooms}
        services={lists.services}
        onUpdateStatus={actions.handleStatusUpdate}
        onAssignTherapist={actions.handleAssignTherapist}
        onRecordPayment={actions.handleRecordPayment}
        onApplyDiscount={actions.handleApplyDiscount}
        onEditBooking={actions.handleEditBooking}
        onGroupPaymentRecorded={actions.handleGroupPaymentRecorded}
        userRole={profile?.role || 'staff'}
      />
      {toast && (
        <div role="status" className={`fixed top-20 left-1/2 -translate-x-1/2 z-toast px-5 py-3 rounded-spa-lg shadow-spa-elevated text-sm text-white ${toast.type === 'error' ? 'bg-error' : 'bg-text-primary'}`}>{toast.message}</div>
      )}
    </>
  );
};

export default TodayBookingPanel;
