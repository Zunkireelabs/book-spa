import React, { useState, useEffect, useCallback } from 'react';
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
import { fetchBookingById, fetchTherapists, recordPayment, updateBookingStatus, assignTherapist } from '../../services/api';
import { transformBooking, toDbStatus } from '../../services/bookingTransformers';

const BookingDetailsAssignmentModal = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { bookingId: paramBookingId } = useParams();
  const { profile } = useAuth();
  const { branchId } = useBranch();
  const userRole = profile?.role || 'staff';

  const [activeTab, setActiveTab] = useState('details');
  const [isLoading, setIsLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [booking, setBooking] = useState(null);
  const [therapists, setTherapists] = useState([]);
  const [error, setError] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [actionError, setActionError] = useState(null);

  // Resolve booking ID from URL params or query string
  const bookingIdFromUrl = paramBookingId || new URLSearchParams(location.search).get('id');

  const loadBooking = useCallback(async () => {
    if (!bookingIdFromUrl) {
      setPageLoading(false);
      setError('No booking ID specified. Navigate here from the staff dashboard.');
      return;
    }

    setPageLoading(true);
    const [bookingResult, therapistsResult] = await Promise.all([
      fetchBookingById(bookingIdFromUrl),
      branchId ? fetchTherapists(branchId) : Promise.resolve({ data: [] }),
    ]);

    if (bookingResult.error) {
      setError(bookingResult.error.message || 'Failed to load booking.');
      setPageLoading(false);
      return;
    }

    setBooking(transformBooking(bookingResult.data));

    if (therapistsResult.data) {
      setTherapists(therapistsResult.data.map(t => ({
        id: t.id,
        name: t.name,
        gender: t.gender,
        specialties: t.specialties || [],
      })));
    }

    setPageLoading(false);
  }, [bookingIdFromUrl, branchId]);

  useEffect(() => { loadBooking(); }, [loadBooking]);

  const tabs = [
    { id: 'details', label: 'Details', icon: 'FileText' },
    { id: 'assignment', label: 'Assignment', icon: 'UserCheck' },
    { id: 'timeline', label: 'Timeline', icon: 'Clock' },
    { id: 'communication', label: 'Communication', icon: 'MessageCircle' }
  ];

  const handleClose = () => {
    const from = location.state?.from;
    if (from) {
      navigate(from);
    } else {
      // Role-aware fallback: managers/admins go to manager dashboard, staff to staff dashboard
      const fallback = ['manager', 'admin'].includes(userRole)
        ? '/branch-manager-dashboard'
        : '/branch-staff-dashboard';
      navigate(fallback);
    }
  };

  const showActionError = (msg) => {
    setActionError(msg);
    setTimeout(() => setActionError(null), 5000);
  };

  const handleStatusUpdate = async (newStatus) => {
    if (!booking) return;
    setIsLoading(true);
    setActionError(null);

    const dbStatus = toDbStatus(newStatus);
    const result = await updateBookingStatus({ bookingId: booking.bookingId, newStatus: dbStatus });

    if (result.error) {
      showActionError(result.error.message || 'Failed to update status.');
    } else {
      await loadBooking();
    }
    setIsLoading(false);
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
    console.log('Message sent:', messageData);
  };

  const handleRecordPayment = async ({ paymentMode, notes }) => {
    if (!booking) return { error: { message: 'No booking loaded.' } };
    setPaymentSubmitting(true);

    const result = await recordPayment({ bookingId: booking.bookingId, paymentMode, notes });

    if (result.error) {
      setPaymentSubmitting(false);
      return { error: result.error };
    }

    setPaymentSuccess(true);
    setShowPaymentModal(false);
    setPaymentSubmitting(false);
    await loadBooking();
    return { error: null };
  };

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  // Build assignment data for the panel
  const currentAssignment = booking?.therapist ? {
    therapistId: booking.therapist.id,
    therapistName: booking.therapist.name,
    assignedAt: '',
    notes: ''
  } : null;

  return (
    <div className="min-h-screen bg-background">
      <StaffSidebar userRole={userRole} />

      <div className="lg:ml-64 lg:mb-0 mb-16">
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
                              isLoading={isLoading}
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
                          availableTherapists={therapists.map(t => ({
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
          }}
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
