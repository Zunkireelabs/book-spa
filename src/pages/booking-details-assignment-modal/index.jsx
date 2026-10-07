import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import StaffSidebar from '../../components/ui/StaffSidebar';
import PaymentModal from '../../components/ui/PaymentModal';
import BookingDetailsPanel from './components/BookingDetailsPanel';
import TherapistAssignmentPanel from './components/TherapistAssignmentPanel';
import BookingTimelinePanel from './components/BookingTimelinePanel';
import CustomerCommunicationPanel from './components/CustomerCommunicationPanel';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';
import { fetchBookingById, fetchTherapists, fetchRooms, recordPayment, recordTip, updateBookingStatus, assignTherapist, fetchDueHolderNames, getCustomerFirstBookingFlag, rescheduleBookingAsNewBooking, fetchServiceTherapists, filterEligibleTherapists } from '../../services/api';
import { transformBooking, toDbStatus } from '../../services/bookingTransformers';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';

const BookingDetailsAssignmentModal = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { bookingId: paramBookingId, orgSlug: urlOrgSlug } = useParams();
  const { profile } = useAuth();
  const { branchId } = useBranch();
  const userRole = profile?.role || 'staff';

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState('details');
  const [isLoading, setIsLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [booking, setBooking] = useState(null);
  const [isFirstBooking, setIsFirstBooking] = useState(false);
  const [therapists, setTherapists] = useState([]);
  const [eligibleTherapistIds, setEligibleTherapistIds] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [error, setError] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [dueHolderSuggestions, setDueHolderSuggestions] = useState([]);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [actionError, setActionError] = useState(null);

  // Resolve booking ID from URL params or query string
  const bookingIdFromUrl = paramBookingId || new URLSearchParams(location.search).get('id');

  // Only the very first load shows the full-page skeleton — background
  // auto-refresh ticks (see useAutoRefresh below) swap the booking in
  // silently instead of blanking the whole details/payment UI every 30s
  // while a staff member is actively viewing (or mid-payment-entry on) it.
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

    const transformed = transformBooking(bookingResult.data);
    setBooking(transformed);

    const firstBookingResult = await getCustomerFirstBookingFlag(transformed.customerId, transformed.bookingId, transformed.date, transformed.startTime);
    setIsFirstBooking(!!firstBookingResult.data?.isFirstBooking);

    if (branchId) {
      const therapistsResult = await fetchTherapists(branchId, { date: bookingResult.data?.date });
      if (therapistsResult.data) {
        setTherapists(therapistsResult.data.map(t => ({
          id: t.id,
          name: t.name,
          gender: t.gender,
          specialties: t.specialties || [],
        })));
      }

      const roomsResult = await fetchRooms(branchId);
      if (roomsResult.data) setRooms(roomsResult.data);
    }

    if (transformed.serviceId) {
      // Scoped to the booking's own branch (migration-257/258 made the allow-list
      // per-branch) — not the viewer's current branch context, which can differ.
      const eligibleResult = await fetchServiceTherapists(transformed.serviceId, transformed.branchId);
      setEligibleTherapistIds(eligibleResult.data || null);
    } else {
      setEligibleTherapistIds(null);
    }

    hasLoadedRef.current = true;
    setPageLoading(false);
  }, [bookingIdFromUrl, branchId]);

  useEffect(() => { loadBooking(); }, [loadBooking]);

  // Paused entirely while the payment modal is open or submitting — a
  // background refetch replacing `booking` mid-payment-entry is worse than
  // just going 30s stale for that one screen.
  useAutoRefresh(loadBooking, { intervalMs: 30000, enabled: !showPaymentModal && !paymentSubmitting });

  const tabs = [
    { id: 'details', label: 'Details', icon: 'FileText' },
    { id: 'assignment', label: 'Assignment', icon: 'UserCheck' },
    { id: 'timeline', label: 'Timeline', icon: 'Clock' },
    { id: 'communication', label: 'Communication', icon: 'MessageCircle' }
  ];

  const handleClose = useCallback(() => {
    const from = location.state?.from;
    if (from) {
      navigate(from);
    } else {
      // Get org slug from URL or profile
      const orgSlug = urlOrgSlug || profile?.organizations?.slug;

      // Use org-scoped URL if available, otherwise fall back to legacy routes
      if (orgSlug) {
        navigate(`/${orgSlug}/dashboard`);
      } else {
        // Legacy fallback
        const fallback = ['manager', 'admin'].includes(userRole)
          ? '/branch-manager-dashboard'
          : '/branch-staff-dashboard';
        navigate(fallback);
      }
    }
  }, [location.state?.from, navigate, userRole, urlOrgSlug, profile?.organizations?.slug]);

  const showActionError = (msg) => {
    setActionError(msg);
    setTimeout(() => setActionError(null), 5000);
  };

  const handleStatusUpdate = async (newStatus, reason) => {
    if (!booking) return;
    setIsLoading(true);
    setActionError(null);

    const dbStatus = toDbStatus(newStatus);
    const result = await updateBookingStatus({ bookingId: booking.bookingId, newStatus: dbStatus, reason });

    if (result.error) {
      showActionError(result.error.message || 'Failed to update status.');
    } else {
      await loadBooking();
    }
    setIsLoading(false);
  };

  // "Reschedule" creates a new booking at the chosen date/time/therapist/room
  // (same customer + service as the original) and then cancels the original —
  // it does not update the existing row in place. Mirrors the Rebook pattern
  // used on the calendar, just driven by a form instead of click-a-slot since
  // this page has no calendar grid. Both steps run in one DB transaction via
  // reschedule_booking() (migration-243), so there's no partial-failure state
  // to handle here.
  const handleReschedule = async ({ date, startTime, therapistId, roomId }) => {
    if (!booking) return { error: { message: 'No booking loaded.' } };
    setIsLoading(true);
    setActionError(null);

    const result = await rescheduleBookingAsNewBooking({
      bookingId: booking.bookingId,
      date,
      startTime,
      therapistId: therapistId || null,
      roomId: roomId || null,
      reason: `Rescheduled to ${date} ${startTime}`,
    });

    if (result.error) {
      setIsLoading(false);
      return { error: result.error };
    }

    setIsLoading(false);
    const newBookingId = result.data?.id;
    const orgSlug = urlOrgSlug || profile?.organizations?.slug;
    if (newBookingId && orgSlug) {
      navigate(`/${orgSlug}/bookings/${newBookingId}`);
    } else if (newBookingId) {
      navigate(`/booking-details/${newBookingId}`);
    } else {
      await loadBooking();
    }
    return { error: null };
  };

  const handleAssignTherapist = async (therapistId, notes) => {
    if (!booking) return;
    setIsLoading(true);
    setActionError(null);

    const result = await assignTherapist({ bookingId: booking.bookingId, therapistId });

    if (result.error) {
      showActionError(result.error.message || 'Failed to assign therapist.');
    } else {
      await loadBooking();
    }
    setIsLoading(false);
  };

  const handleSendMessage = async (messageData) => {
    // Communication not implemented yet
  };

  const handleRecordPayment = async (opts) => {
    if (!booking) return { error: { message: 'No booking loaded.' } };
    setPaymentSubmitting(true);

    const { tipAmount, tipReceivedBy, ...paymentOpts } = opts;
    const result = await recordPayment({ bookingId: booking.bookingId, ...paymentOpts });

    if (result.error) {
      setPaymentSubmitting(false);
      return { error: result.error };
    }

    // Best-effort — must never undo or block a payment that already succeeded.
    if (tipAmount > 0) {
      const tipResult = await recordTip({ bookingId: booking.bookingId, amount: tipAmount, receivedBy: tipReceivedBy });
      if (tipResult.error) console.warn('[Tips] recordTip failed:', tipResult.error.message);
    }

    setPaymentSuccess(true);
    setShowPaymentModal(false);
    setPaymentSubmitting(false);
    await loadBooking();
    return { error: null };
  };

  useEffect(() => {
    if (!showPaymentModal) return;
    let cancelled = false;
    fetchDueHolderNames(branchId).then(({ data }) => {
      if (!cancelled && Array.isArray(data)) setDueHolderSuggestions(data);
    });
    return () => { cancelled = true; };
  }, [showPaymentModal, branchId]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handleClose]);

  // Build assignment data for the panel
  const currentAssignment = booking?.therapist ? {
    therapistId: booking.therapist.id,
    therapistName: booking.therapist.name,
    assignedAt: '',
    notes: ''
  } : null;

  return (
    <div className="min-h-screen bg-background">
      <StaffSidebar userRole={userRole} onCollapseChange={setSidebarCollapsed} />

      <div className={`${sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64'} lg:mb-0 mb-16 spa-transition-slow`}>
        <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal flex items-center justify-center p-4">
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-6xl max-h-[90vh] overflow-hidden animate-fade-in">

            {/* Loading state */}
            {pageLoading && (
              <div className="p-12 text-center">
                <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                <p className="font-body font-body-normal text-text-secondary">Loading booking...</p>
              </div>
            )}

            {/* Error state */}
            {!pageLoading && error && (
              <div className="p-12 text-center">
                <Icon name="AlertCircle" size={48} className="text-error mx-auto mb-4" />
                <h3 className="font-heading font-heading-semibold text-xl text-text-primary mb-2">Error</h3>
                <p className="font-body font-body-normal text-text-secondary mb-4">{error}</p>
                <Button variant="primary" onClick={handleClose}>Go Back</Button>
              </div>
            )}

            {/* Loaded booking */}
            {!pageLoading && !error && booking && (
              <>
                {/* Modal Header */}
                <div className="flex items-center justify-between p-6 border-b border-border">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                      <Icon name="Calendar" size={20} className="text-primary" />
                    </div>
                    <div>
                      <h1 className="font-heading font-heading-semibold text-xl text-text-primary">
                        Booking Management
                      </h1>
                      <p className="font-caption font-caption-normal text-sm text-text-secondary">
                        {booking.id} — {booking.customerName} — {booking.service}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.print()}
                      iconName="Printer"
                      iconPosition="left"
                    >
                      Print
                    </Button>
                    <button
                      onClick={handleClose}
                      className="p-2 rounded-spa hover:bg-background spa-transition-fast spa-touch-target"
                    >
                      <Icon name="X" size={20} className="text-text-secondary" />
                    </button>
                  </div>
                </div>

                {/* Action Error Toast */}
                {actionError && (
                  <div className="mx-6 mt-4 p-3 bg-error/5 border border-error/20 rounded-spa flex items-center space-x-2">
                    <Icon name="AlertCircle" size={16} className="text-error shrink-0" />
                    <p className="font-body font-body-normal text-sm text-error">{actionError}</p>
                  </div>
                )}

                {/* Modal Tabs */}
                <div className="border-b border-border">
                  <nav className="flex space-x-8 px-6">
                    {tabs.map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center space-x-2 py-4 border-b-2 spa-transition-fast ${
                          activeTab === tab.id
                            ? 'border-primary text-primary' :'border-transparent text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        <Icon name={tab.icon} size={16} />
                        <span className="font-body font-body-medium text-sm">{tab.label}</span>
                      </button>
                    ))}
                  </nav>
                </div>

                {/* Modal Content */}
                <div className="flex-1 overflow-hidden">
                  <div className="h-[60vh] overflow-y-auto">
                    <div className="p-6">
                      {activeTab === 'details' && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                          <div>
                            <BookingDetailsPanel
                              booking={{
                                ...booking,
                                base_amount: booking.baseAmount,
                                discount_amount: booking.discountAmount,
                                final_amount: booking.finalAmount,
                                booking_number: booking.id,
                              }}
                              onStatusUpdate={handleStatusUpdate}
                              onRecordPayment={() => setShowPaymentModal(true)}
                              onReschedule={handleReschedule}
                              therapists={therapists}
                              rooms={rooms}
                              isLoading={isLoading}
                              isFirstBooking={isFirstBooking}
                            />
                          </div>

                          <div className="space-y-6">
                            <div className="bg-background rounded-spa p-4 space-y-3">
                              <h4 className="font-heading font-heading-medium text-base text-text-primary">
                                Quick Actions
                              </h4>
                              <div className="grid grid-cols-2 gap-2">
                                {booking.customerPhone && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    iconName="Phone"
                                    iconPosition="left"
                                    onClick={() => window.open(`tel:${booking.customerPhone}`)}
                                  >
                                    Call Customer
                                  </Button>
                                )}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  iconName="Mail"
                                  iconPosition="left"
                                  onClick={() => setActiveTab('communication')}
                                >
                                  Send Email
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {activeTab === 'assignment' && (
                        <TherapistAssignmentPanel
                          booking={booking}
                          availableTherapists={filterEligibleTherapists(therapists, eligibleTherapistIds).map(t => ({
                            ...t,
                            conflictReason: null,
                            schedule: [],
                          }))}
                          onAssignTherapist={handleAssignTherapist}
                          isLoading={isLoading}
                          currentAssignment={currentAssignment}
                        />
                      )}

                      {activeTab === 'timeline' && (
                        <BookingTimelinePanel
                          booking={booking}
                          timeline={[]}
                        />
                      )}

                      {activeTab === 'communication' && (
                        <CustomerCommunicationPanel
                          booking={booking}
                          onSendMessage={handleSendMessage}
                          isLoading={isLoading}
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-between p-6 border-t border-border bg-background/50">
                  <div className="flex items-center space-x-4 text-text-secondary">
                    <div className="flex items-center space-x-1">
                      <Icon name="User" size={14} />
                      <span className="font-caption font-caption-normal text-xs capitalize">
                        Viewing as: {userRole}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    <Button variant="outline" onClick={handleClose}>
                      Close
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      {showPaymentModal && booking && (
        <PaymentModal
          booking={{
            id: booking.id,
            booking_number: booking.id,
            base_amount: booking.baseAmount,
            discount_amount: booking.discountAmount,
            final_amount: booking.finalAmount,
            amountPaid: booking.amountPaid,
            dueHolderName: booking.dueHolderName,
          }}
          dueHolderSuggestions={dueHolderSuggestions}
          onConfirm={handleRecordPayment}
          onClose={() => setShowPaymentModal(false)}
          isSubmitting={paymentSubmitting}
        />
      )}

      {/* Payment Success Toast */}
      {paymentSuccess && (
        <div className="fixed bottom-6 right-6 z-toast flex items-center space-x-3 bg-success text-white px-5 py-3 rounded-spa-lg spa-shadow-elevated animate-fade-in">
          <Icon name="CheckCircle" size={20} />
          <span className="font-body font-body-medium text-sm">Payment recorded successfully</span>
          <button onClick={() => setPaymentSuccess(false)} className="ml-2 hover:opacity-80">
            <Icon name="X" size={16} />
          </button>
        </div>
      )}
    </div>
  );
};

export default BookingDetailsAssignmentModal;
