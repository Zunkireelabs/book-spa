import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import StaffSidebar from '../../components/ui/StaffSidebar';
import BookingActionModal from '../../components/ui/BookingActionModal';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';
import {
  fetchBookingById,
  fetchTherapists,
  fetchRooms,
  fetchServices,
  recordPayment,
  recordTip,
  updateBookingStatus,
  assignTherapist,
  applyDiscount,
  updateBookingDetails,
  createBooking,
} from '../../services/api';
import { transformBooking, toDbStatus } from '../../services/bookingTransformers';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';

// Same component the branch-manager calendar uses for its booking dialog
// (BookingActionModal) — this route page is just a URL-addressable wrapper
// around it, so a booking looks and behaves identically whether it was
// opened from the calendar grid or linked to directly (e.g. from a report).
const BookingDetailsAssignmentModal = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { bookingId: paramBookingId, orgSlug: urlOrgSlug } = useParams();
  const { profile } = useAuth();
  const { branchId } = useBranch();
  const userRole = profile?.role || 'staff';

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [booking, setBooking] = useState(null);
  const [therapists, setTherapists] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [services, setServices] = useState([]);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const bookingIdFromUrl = paramBookingId || new URLSearchParams(location.search).get('id');

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Only the very first load shows the full-page skeleton — background
  // auto-refresh ticks swap the booking in silently instead of blanking the
  // modal every 30s while a staff member is actively viewing/editing it.
  const hasLoadedRef = useRef(false);
  const loadBooking = useCallback(async () => {
    if (!bookingIdFromUrl) {
      setPageLoading(false);
      setError('No booking ID specified. Navigate here from the staff dashboard.');
      return;
    }

    if (!hasLoadedRef.current) setPageLoading(true);
    const bookingResult = await fetchBookingById(bookingIdFromUrl);

    if (bookingResult.error) {
      setError(bookingResult.error.message || 'Failed to load booking.');
      hasLoadedRef.current = true;
      setPageLoading(false);
      return;
    }

    setBooking(transformBooking(bookingResult.data));
    hasLoadedRef.current = true;
    setPageLoading(false);
  }, [bookingIdFromUrl]);

  useEffect(() => { loadBooking(); }, [loadBooking]);
  useAutoRefresh(loadBooking, { intervalMs: 30000 });

  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    fetchTherapists(branchId, { date: booking?.date }).then(({ data }) => {
      if (cancelled || !data) return;
      setTherapists(data.filter(t => t.is_service_staff !== false).map(t => ({
        id: t.id,
        name: t.name,
        gender: t.gender,
        specialties: t.specialties || [],
      })));
    });
    fetchRooms(branchId).then(({ data }) => { if (!cancelled && data) setRooms(data); });
    fetchServices(branchId).then(({ data }) => { if (!cancelled && data) setServices(data); });
    return () => { cancelled = true; };
    // Re-fetch therapists when the booking's own date changes (availability is
    // date-scoped) — everything else only needs the branch.
  }, [branchId, booking?.date]);

  const handleClose = useCallback(() => {
    const from = location.state?.from;
    if (from) {
      navigate(from);
      return;
    }
    const orgSlug = urlOrgSlug || profile?.organizations?.slug;
    if (orgSlug) {
      navigate(`/${orgSlug}/dashboard`);
    } else {
      navigate(['manager', 'admin'].includes(userRole) ? '/branch-manager-dashboard' : '/branch-staff-dashboard');
    }
  }, [location.state?.from, navigate, userRole, urlOrgSlug, profile?.organizations?.slug]);

  useEffect(() => {
    const handleEscape = (e) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handleClose]);

  const handleUpdateStatus = async (bookingId, newStatus, reason) => {
    const result = await updateBookingStatus({ bookingId, newStatus: toDbStatus(newStatus), reason });
    if (result.error) {
      showToast(result.error.message || 'Failed to update status.', 'error');
      return;
    }
    showToast(`Status updated to ${newStatus}`);
    await loadBooking();
  };

  const handleAssignTherapist = async (bookingId, therapistIds, notes, roomId, therapistRoomOverrides, companionName, companionPhone) => {
    const ids = Array.isArray(therapistIds) ? therapistIds : (therapistIds ? [therapistIds] : []);
    const result = await assignTherapist({
      bookingId,
      therapistIds: ids,
      roomId: roomId !== undefined ? (roomId || null) : undefined,
      therapistRoomOverrides,
      companionName,
      companionPhone,
    });
    if (result.error) {
      showToast(result.error.message || 'Failed to assign therapist.', 'error');
      return;
    }
    if (result.data?.warning) {
      showToast(`Assignment partially saved: ${result.data.warning}`, 'error');
      return;
    }
    showToast('Assignment saved successfully');
    await loadBooking();
  };

  const handleRecordPayment = async (bookingId, opts) => {
    const { tipSplits, ...paymentOpts } = opts;
    const result = await recordPayment({ bookingId, ...paymentOpts });
    if (result.error) return { error: result.error };
    // Best-effort — tip is a separate, independent record and must never
    // undo or block a payment that already succeeded.
    for (const split of (tipSplits || [])) {
      const tipResult = await recordTip({ bookingId, amount: split.amount, receivedBy: split.receivedBy });
      if (tipResult.error) console.warn('[Tips] recordTip failed:', tipResult.error.message);
    }
    showToast('Payment recorded successfully');
    if (booking && bookingId === booking.bookingId) await loadBooking();
    return { error: null };
  };

  const handleGroupPaymentRecorded = () => {
    showToast('Payment recorded successfully');
    loadBooking();
  };

  const handleApplyDiscount = async (bookingId, { discountType, discountValue, discountReason, requestedTo }) => {
    const result = await applyDiscount({ bookingId, discountType, discountValue, discountReason, requestedTo });
    if (result.error) return { error: result.error };
    showToast(result.data?.isPending ? 'Discount request sent for approval' : 'Discount applied successfully');
    await loadBooking();
    return { data: result.data };
  };

  const handleEditBooking = async (bookingId, updates) => {
    const result = await updateBookingDetails({ bookingId, ...updates });
    if (result.error) {
      showToast(result.error.message || 'Failed to update booking.', 'error');
      return { error: result.error };
    }
    showToast('Booking updated successfully');
    await loadBooking();
    return { error: null };
  };

  const handleCreateBooking = async (formData) => {
    if (!branchId) return 'Missing branch info.';
    const result = await createBooking({
      branchId,
      serviceId: formData.serviceId,
      date: formData.bookingDate,
      startTime: formData.bookingTime,
      customerName: formData.customerName,
      customerPhone: formData.customerPhone,
      therapistIds: formData.therapistId ? [formData.therapistId] : null,
      roomId: formData.roomId || 'none',
    });
    if (result.error) return result.error.message || 'Failed to create booking.';
    showToast(
      result.data?._therapistAssignmentWarning
        ? `Booking created, but: ${result.data._therapistAssignmentWarning}`
        : 'Booking created successfully'
    );
    return null;
  };

  const orgSlug = urlOrgSlug || profile?.organizations?.slug;
  const handleViewBooking = (id) => {
    if (orgSlug) navigate(`/${orgSlug}/bookings/${id}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <StaffSidebar userRole={userRole} onCollapseChange={setSidebarCollapsed} />

      <div className={`${sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-60'} lg:mb-0 mb-16 spa-transition-slow`}>
        {pageLoading && (
          <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal flex items-center justify-center p-4">
            <div className="bg-surface rounded-spa-lg spa-shadow-modal p-12 text-center">
              <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
              <p className="font-body font-body-normal text-text-secondary">Loading booking...</p>
            </div>
          </div>
        )}

        {!pageLoading && error && (
          <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal flex items-center justify-center p-4">
            <div className="bg-surface rounded-spa-lg spa-shadow-modal p-12 text-center max-w-md">
              <Icon name="AlertCircle" size={48} className="text-error mx-auto mb-4" />
              <h3 className="font-heading font-heading-semibold text-xl text-text-primary mb-2">Error</h3>
              <p className="font-body font-body-normal text-text-secondary mb-4">{error}</p>
              <Button variant="primary" onClick={handleClose}>Go Back</Button>
            </div>
          </div>
        )}
      </div>

      <BookingActionModal
        isOpen={!pageLoading && !error && !!booking}
        onClose={handleClose}
        booking={booking}
        therapists={therapists}
        rooms={rooms}
        services={services}
        onUpdateStatus={handleUpdateStatus}
        onAssignTherapist={handleAssignTherapist}
        onRecordPayment={handleRecordPayment}
        onGroupPaymentRecorded={handleGroupPaymentRecorded}
        onApplyDiscount={handleApplyDiscount}
        onEditBooking={handleEditBooking}
        onCreateBooking={handleCreateBooking}
        userRole={userRole}
        onViewBooking={handleViewBooking}
      />

      {toast && (
        <div className={`fixed top-20 left-1/2 transform -translate-x-1/2 z-notification px-5 py-3 rounded-spa-lg spa-shadow-elevated animate-fade-in flex items-center space-x-2 ${
          toast.type === 'error' ? 'bg-error text-white' : 'bg-success text-white'
        }`}>
          <Icon name={toast.type === 'error' ? 'AlertCircle' : 'CheckCircle'} size={16} />
          <span className="font-body font-body-medium text-sm">{toast.msg}</span>
        </div>
      )}
    </div>
  );
};

export default BookingDetailsAssignmentModal;
