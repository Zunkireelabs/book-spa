import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Button from './Button';
import CustomSelect from './CustomSelect';
import PaymentModal from './PaymentModal';
import Icon from '../AppIcon';
import { fetchRelatedUnpaidBookings, fetchBookingCreator, fetchDiscountApprovers } from '../../services/api';

// Convert "HH:MM" or "HH:MM:SS" to 12h format
function to12h(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// Format an ISO timestamp as "5 Jun 2026, 2:14 pm"
function formatCreatedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

// Status badge styles
const STATUS_STYLES = {
  pending: 'bg-warning/10 text-warning',
  confirmed: 'bg-success/10 text-success',
  'in-progress': 'bg-primary/10 text-primary',
  completed: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-error/10 text-error',
  'no show': 'bg-gray-100 text-gray-500',
};

const BookingActionModal = ({
  isOpen = false,
  onClose,
  booking = null,
  therapists = [],
  rooms = [],
  services = [],
  onAssignTherapist,
  onUpdateStatus,
  onRecordPayment,
  onApplyDiscount,
  onEditBooking,
  onCreateBooking,
  onRebookStart,
  branchHours,
  defaultNewBookingMode,
  userRole = 'staff'
}) => {
  const [activeTab, setActiveTab] = useState('details');
  const [selectedTherapists, setSelectedTherapists] = useState([]);
  const [therapistSearch, setTherapistSearch] = useState('');
  const [selectedRoom, setSelectedRoom] = useState('');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [actionError, setActionError] = useState(null);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [editError, setEditError] = useState(null);

  // Discount state
  const [discountType, setDiscountType] = useState('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [discountError, setDiscountError] = useState(null);
  const [discountSuccess, setDiscountSuccess] = useState(false);
  // Approver routing when a discount exceeds the user's limit
  const [approvers, setApprovers] = useState([]);
  const [selectedApprover, setSelectedApprover] = useState('');

  // Add another service / Rebook state
  const [newBookingMode, setNewBookingMode] = useState(null); // 'add-service' | 'rebook' | null
  const [newBookingForm, setNewBookingForm] = useState({});
  const [newBookingError, setNewBookingError] = useState(null);
  const [newBookingSubmitting, setNewBookingSubmitting] = useState(false);

  // Who created this booking (lazy-loaded on open)
  const [creator, setCreator] = useState(null);

  // Multi-payment/discount: related unpaid bookings for same customer
  const [relatedBookings, setRelatedBookings] = useState([]);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState(new Set());
  const [selectedDiscountIds, setSelectedDiscountIds] = useState(new Set()); // includes current booking ID by default

  // Pre-select current therapists/room when booking changes or assign tab opens
  useEffect(() => {
    if (booking) {
      const ids = booking.therapists?.length > 0
        ? booking.therapists.map(t => t.id)
        : (booking.therapist?.id ? [booking.therapist.id] : []);
      setSelectedTherapists(ids);
      setSelectedRoom(booking.roomId || '');
    }
  }, [booking?.bookingId]);

  // Reset edit state when booking changes
  useEffect(() => {
    setIsEditing(false);
    setEditError(null);
    setActionError(null);
    setTherapistSearch('');
    setNewBookingMode(null);
    setNewBookingError(null);
    setNewBookingForm({});
    setNewBookingSubmitting(false);
  }, [booking?.bookingId]);

  // Fetch related unpaid bookings when payment tab opens
  useEffect(() => {
    if ((activeTab === 'payment' || activeTab === 'discount') && booking) {
      fetchRelatedUnpaidBookings({
        customerName: booking.customerName,
        date: booking.date,
        excludeBookingId: booking.bookingId,
      }).then(result => {
        setRelatedBookings(result.data || []);
        setSelectedPaymentIds(new Set());
        setSelectedDiscountIds(new Set([booking.bookingId]));
        setSelectedApprover('');
        setDiscountSuccess(false);
      });
    }
  }, [activeTab, booking?.bookingId, booking?.paymentStatus]);

  // Load who created this booking when the modal opens
  useEffect(() => {
    if (isOpen && booking?.bookingId) {
      fetchBookingCreator(booking.bookingId).then(result => setCreator(result.data || null));
    } else {
      setCreator(null);
    }
  }, [isOpen, booking?.bookingId]);

  // Load eligible approvers the first time the discount tab is opened
  useEffect(() => {
    if (isOpen && activeTab === 'discount' && approvers.length === 0) {
      fetchDiscountApprovers().then(result => setApprovers(result.data || []));
    }
  }, [isOpen, activeTab]);

  // Auto-open rebook form when triggered via Escape fallback
  useEffect(() => {
    if (defaultNewBookingMode && booking) {
      openNewBookingForm(defaultNewBookingMode);
    }
  }, [defaultNewBookingMode, booking?.bookingId]);

  const tabs = [
    { id: 'details', label: 'Details', labelFull: 'Booking Details', icon: 'FileText' },
    { id: 'assign', label: 'Assigned', labelFull: 'Assigned', icon: 'UserCheck' },
    { id: 'discount', label: 'Discount', labelFull: 'Discount', icon: 'Percent' },
    { id: 'payment', label: 'Payment', labelFull: 'Payment', icon: 'CreditCard' }
  ];

  // Valid next-status transitions (lowercase UI values)
  const getNextStatuses = (currentStatus) => {
    const transitions = {
      'pending': ['confirmed', 'cancelled'],
      'confirmed': ['in-progress', 'cancelled', 'no show'],
      'in-progress': ['completed'],
    };
    return transitions[currentStatus] || [];
  };

  // Service preview when editing
  const selectedService = useMemo(() => {
    if (!isEditing || !editForm.serviceId || !services?.length) return null;
    return services.find(s => s.id === editForm.serviceId);
  }, [isEditing, editForm.serviceId, services]);

  const startEditing = () => {
    setEditForm({
      customerName: booking.customerName || '',
      customerPhone: booking.customerPhone || '',
      serviceId: booking.serviceId || '',
      date: booking.date || '',
      startTime: booking.startTime ? booking.startTime.slice(0, 5) : booking.time || '',
      specialRequests: booking.specialRequests || '',
    });
    setEditError(null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!booking || !onEditBooking) return;
    setEditError(null);

    if (!editForm.customerName.trim()) {
      setEditError('Customer name is required.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await onEditBooking(booking.bookingId, {
        customerName: editForm.customerName.trim(),
        customerPhone: editForm.customerPhone.trim() || null,
        serviceId: editForm.serviceId || undefined,
        date: editForm.date || undefined,
        startTime: editForm.startTime ? editForm.startTime + ':00' : undefined,
        specialRequests: editForm.specialRequests.trim() || null,
      });
      if (result?.error) {
        setEditError(result.error.message || 'Failed to update booking.');
      } else {
        setIsEditing(false);
      }
    } catch (error) {
      setEditError('An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Time options for new booking forms ──
  const timeOptions = useMemo(() => {
    const [openH] = (branchHours?.openTime || '09:00:00').split(':').map(Number);
    const [closeH, closeM] = (branchHours?.closeTime || '21:00:00').split(':').map(Number);
    const opts = [];
    for (let h = openH; h <= closeH; h++) {
      for (let m = 0; m < 60; m += 15) {
        if (h === closeH && m > closeM) break;
        opts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    return opts;
  }, [branchHours]);

  const format12h = (time24) => {
    const [h, m] = time24.split(':').map(Number);
    const suffix = h >= 12 ? 'pm' : 'am';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, '0')}${suffix}`;
  };

  const openNewBookingForm = (mode) => {
    const today = new Date().toISOString().slice(0, 10);
    setNewBookingForm({
      serviceId: mode === 'rebook' ? (booking.serviceId || '') : '',
      date: mode === 'rebook' ? '' : (booking.date || today),
      startTime: '',
      therapistId: '',
      roomId: '',
    });
    setNewBookingError(null);
    setNewBookingSubmitting(false);
    setNewBookingMode(mode);
  };

  const handleNewBookingSubmit = async () => {
    if (!booking || !onCreateBooking) return;
    if (!newBookingForm.serviceId) {
      setNewBookingError('Please select a service.');
      return;
    }
    if (!newBookingForm.date) {
      setNewBookingError('Please select a date.');
      return;
    }
    if (!newBookingForm.startTime) {
      setNewBookingError('Please select a time.');
      return;
    }

    setNewBookingSubmitting(true);
    setNewBookingError(null);

    try {
      const result = await onCreateBooking({
        serviceId: newBookingForm.serviceId,
        customerName: booking.customerName,
        customerPhone: booking.customerPhone || null,
        bookingDate: newBookingForm.date,
        bookingTime: newBookingForm.startTime,
        therapistId: newBookingForm.therapistId || null,
        roomId: newBookingForm.roomId || null,
      });

      if (result) {
        setNewBookingError(result);
      } else {
        setNewBookingMode(null);
        onClose();
      }
    } catch (err) {
      setNewBookingError(err?.message || 'Unexpected error. Please try again.');
    } finally {
      setNewBookingSubmitting(false);
    }
  };

  const handleAssignTherapist = async () => {
    if (!booking) return;

    setIsLoading(true);
    setActionError(null);
    try {
      if (onAssignTherapist) {
        await onAssignTherapist(booking.bookingId, selectedTherapists, notes, selectedRoom || null);
      }
      onClose();
    } catch (error) {
      setActionError(error?.message || 'Assignment failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStatusUpdate = async (newStatus) => {
    if (!booking) return;
    setIsLoading(true);
    setActionError(null);
    try {
      if (onUpdateStatus) {
        await onUpdateStatus(booking.bookingId, newStatus);
      }
      onClose();
    } catch (error) {
      setActionError(error?.message || 'Status update failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePaymentConfirm = async ({ paymentMode, notes: paymentNotes }) => {
    if (!booking || !onRecordPayment) return { error: { message: 'No payment handler available.' } };
    setPaymentSubmitting(true);
    try {
      // Pay the current booking
      const result = await onRecordPayment(booking.bookingId, { paymentMode, notes: paymentNotes });
      if (result?.error) return result;

      // Pay any selected additional bookings
      const additionalIds = [...selectedPaymentIds];
      for (const rbId of additionalIds) {
        await onRecordPayment(rbId, { paymentMode, notes: paymentNotes });
      }

      setShowPaymentModal(false);
      setSelectedPaymentIds(new Set());
      onClose();
      return result;
    } finally {
      setPaymentSubmitting(false);
    }
  };

  const handleApplyDiscount = async () => {
    if (!booking || !onApplyDiscount) return;
    setDiscountError(null);
    setDiscountSuccess(false);

    if (!discountValue || Number(discountValue) <= 0) {
      setDiscountError('Please enter a valid discount value.');
      return;
    }
    if (!discountReason.trim()) {
      setDiscountError('Reason is required.');
      return;
    }

    // Over-limit discounts are routed to a chosen approver instead of blocked.
    const maxPercent = userRole === 'admin' ? 50 : userRole === 'manager' ? 50 : 15;
    const baseAmount = booking.baseAmount || 0;
    const effectivePercent = discountType === 'percentage'
      ? Number(discountValue)
      : baseAmount > 0 ? (Number(discountValue) / baseAmount) * 100 : 0;

    // Hard ceiling: nobody can exceed 50% (staff requests included).
    if (effectivePercent > 50) {
      setDiscountError('Discount cannot exceed 50%.');
      return;
    }

    const exceedsLimit = effectivePercent > maxPercent;

    if (exceedsLimit && !selectedApprover) {
      setDiscountError('Select a manager or admin to send this discount request to.');
      return;
    }

    setIsLoading(true);
    try {
      // Apply to all selected bookings
      const bookingIdsToDiscount = [...selectedDiscountIds];
      let lastResult = null;
      let failed = false;

      for (const bid of bookingIdsToDiscount) {
        // For related bookings, compute the discount based on their base amount
        let dValue = Number(discountValue);
        if (discountType === 'fixed' && bid !== booking.bookingId) {
          // For fixed amount on related bookings, compute proportional or use same percentage
          const rb = relatedBookings.find(r => r.id === bid);
          const rbBase = Number(rb?.base_amount || 0);
          // Convert the effective percentage and apply to this booking's base
          const pct = baseAmount > 0 ? (dValue / baseAmount) : 0;
          dValue = Math.round(rbBase * pct * 100) / 100;
        }

        const result = await onApplyDiscount(bid, {
          discountType: discountType === 'percentage' ? 'percentage' : 'fixed',
          discountValue: discountType === 'percentage' ? Number(discountValue) : dValue,
          discountReason: discountReason.trim(),
          requestedTo: exceedsLimit ? selectedApprover : undefined
        });
        lastResult = result;
        if (result?.error) { failed = true; break; }
      }

      if (failed) {
        setDiscountError(lastResult?.error?.message || 'Failed to apply discount.');
      } else if (lastResult?.data?.isPending) {
        setDiscountSuccess('pending');
        setDiscountValue('');
        setDiscountReason('');
        setSelectedApprover('');
      } else {
        setDiscountSuccess('approved');
        setDiscountValue('');
        setDiscountReason('');
      }
    } catch (error) {
      setDiscountError('An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen || !booking) return null;

  const isTerminal = ['completed', 'cancelled', 'no show'].includes(booking.status);
  const isLocked = booking.isLocked || false;
  const isMutationBlocked = isTerminal || isLocked;
  // "Rebook" reads as booking-again-after on terminal states; on active bookings "Reschedule" is clearer
  const rebookLabel = isTerminal ? 'Rebook' : 'Reschedule';

  const nextStatuses = getNextStatuses(booking.status);
  // Payment is allowed on Completed bookings (pay-after-service is standard cash-spa flow).
  // Only day-lock and already-paid block it — not terminal status.
  const canPay = ['confirmed', 'in-progress', 'completed'].includes(booking.status) && booking.paymentStatus !== 'paid' && !isLocked;
  // Allow discounts on completed-but-unpaid bookings (standard cash-spa flow: service done → apply discount → pay)
  const canDiscount = booking.paymentStatus !== 'paid' && !isLocked
    && !['cancelled', 'no show'].includes(booking.status);
  const discountLimitLabel = userRole === 'admin' ? '50%' : userRole === 'manager' ? '50%' : '15%';

  // Request-mode derivations: a discount over the user's role limit must be
  // routed to a chosen approver instead of being applied directly.
  const DISCOUNT_HARD_CAP = 50; // absolute ceiling for any role / request
  const discountMaxPercent = userRole === 'admin' ? 50 : userRole === 'manager' ? 50 : 15;
  const discountEffPercent = discountType === 'percentage'
    ? Number(discountValue || 0)
    : (booking.baseAmount > 0 ? (Number(discountValue || 0) / booking.baseAmount) * 100 : 0);
  const discountExceedsCap = Number(discountValue) > 0 && discountEffPercent > DISCOUNT_HARD_CAP;
  // Routable request range only — above the hard cap it's blocked, not requestable.
  const discountExceedsLimit = Number(discountValue) > 0 && discountEffPercent > discountMaxPercent && !discountExceedsCap;
  const previewDiscountAmount = discountType === 'percentage'
    ? Math.round((booking.baseAmount || 0) * Number(discountValue || 0) / 100)
    : Number(discountValue || 0);
  const selectedApproverName = approvers.find(a => a.id === selectedApprover)?.fullName || '';

  const inputClasses = 'w-full px-3 py-2 border border-border rounded-spa bg-surface text-text-primary text-sm focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast';

  // Use Portal to render modal at document body level, escaping any stacking context
  return createPortal(
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal flex items-end sm:items-center justify-center sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-modal-title"
      >
        {/* Modal Container - Bottom sheet on mobile (85vh to clear iOS notch), centered card on desktop */}
        <div className="bg-surface w-full sm:max-w-2xl h-[85vh] sm:h-auto sm:max-h-[90vh] rounded-t-2xl sm:rounded-spa-lg spa-shadow-modal overflow-hidden animate-fade-in flex flex-col">
          {/* Header - Responsive padding */}
          <div className="flex items-center justify-between p-4 sm:p-6 border-b border-border flex-shrink-0">
            <div className="flex items-center space-x-3 min-w-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                <Icon name="Calendar" size={18} className="text-primary sm:w-5 sm:h-5" />
              </div>
              <div className="min-w-0">
                <h2 id="booking-modal-title" className="font-heading font-heading-semibold text-base sm:text-lg text-text-primary truncate">
                  Booking Management
                </h2>
                <p className="font-caption font-caption-normal text-xs sm:text-sm text-text-secondary truncate">
                  {booking.id} — {booking.customerName}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-spa hover:bg-background spa-transition-fast min-h-[44px] min-w-[44px] flex items-center justify-center flex-shrink-0"
            >
              <Icon name="X" size={20} className="text-text-secondary" />
            </button>
          </div>

          {/* Tabs - Horizontal scroll on mobile with padding for last item visibility */}
          <div className="border-b border-border flex-shrink-0">
            <nav className="flex overflow-x-auto scrollbar-hide pl-4 sm:pl-6 gap-1 sm:gap-6">
              {tabs.map((tab, index) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setActionError(null);
                    if (tab.id !== 'details') setIsEditing(false);
                  }}
                  className={`flex items-center gap-1.5 sm:gap-2 py-3 sm:py-4 px-3 sm:px-1 border-b-2 spa-transition-fast whitespace-nowrap flex-shrink-0 min-h-[44px] ${
                    index === tabs.length - 1 ? 'mr-4 sm:mr-6' : ''
                  } ${
                    activeTab === tab.id
                      ? 'border-primary text-primary bg-primary/5 sm:bg-transparent rounded-t-lg sm:rounded-none'
                      : 'border-transparent text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <Icon name={tab.icon} size={16} />
                  {/* Short label on mobile, full on desktop */}
                  <span className="font-body font-body-medium text-sm sm:hidden">{tab.label}</span>
                  <span className="font-body font-body-medium text-sm hidden sm:inline">{tab.labelFull}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* Content - Scrollable area takes remaining space, extra bottom padding on mobile for bottom nav */}
          <div className="p-4 sm:p-6 pb-24 sm:pb-6 overflow-y-auto flex-1">
            {/* Details Tab */}
            {activeTab === 'details' && (
              <div className="space-y-4 sm:space-y-6">
                {/* Lock / Immutability Banner — payment-aware on Completed so it complements the Record Payment button */}
                {isMutationBlocked && (() => {
                  const banner = isLocked
                    ? { bg: 'bg-amber-50', border: 'border-amber-200', iconColor: 'text-amber-600', textColor: 'text-amber-700', icon: 'Lock', label: 'Day Closed — Locked' }
                    : booking.status === 'completed'
                      ? booking.paymentStatus === 'paid'
                        ? { bg: 'bg-success/5', border: 'border-success/20', iconColor: 'text-success', textColor: 'text-success', icon: 'ShieldCheck', label: 'Completed — Settled' }
                        : { bg: 'bg-warning/5', border: 'border-warning/20', iconColor: 'text-warning', textColor: 'text-warning', icon: 'Clock', label: 'Service Completed — Payment Pending' }
                      : { bg: 'bg-gray-50', border: 'border-gray-200', iconColor: 'text-gray-500', textColor: 'text-gray-600', icon: 'ShieldCheck', label: booking.status === 'cancelled' ? 'Cancelled — Immutable' : 'No Show — Immutable' };
                  return (
                    <div className={`flex items-center space-x-2 px-3 py-2.5 rounded-spa ${banner.bg} border ${banner.border}`}>
                      <Icon name={banner.icon} size={16} className={banner.iconColor} />
                      <span className={`font-body font-body-medium text-xs ${banner.textColor}`}>
                        {banner.label}
                      </span>
                    </div>
                  );
                })()}

                {/* Status and Actions - Stack on mobile */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center space-x-2">
                    <span className="font-body font-body-medium text-sm text-text-primary">Status:</span>
                    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-caption font-caption-normal capitalize ${STATUS_STYLES[booking.status] || 'bg-gray-100 text-gray-500'}`}>
                      {booking.status.replace('-', ' ')}
                    </span>
                  </div>
                  {!isMutationBlocked && nextStatuses.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {nextStatuses.map((status) => (
                        <Button
                          key={status}
                          variant={status === 'cancelled' || status === 'no show' ? 'outline' : 'primary'}
                          size="sm"
                          className="min-h-[40px] sm:min-h-0 sm:h-auto"
                          onClick={() => handleStatusUpdate(status)}
                          loading={isLoading}
                        >
                          {status === 'in-progress' ? 'Start' : status === 'no show' ? 'No Show' : status.charAt(0).toUpperCase() + status.slice(1)}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Customer & Service Information - Responsive grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                  <div className="space-y-3 sm:space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">
                        Customer Information
                      </h3>
                      {!isMutationBlocked && !isEditing && onEditBooking && (
                        <button
                          onClick={startEditing}
                          className="p-1.5 rounded-spa hover:bg-background spa-transition-fast text-text-secondary hover:text-primary"
                          title="Edit booking details"
                        >
                          <Icon name="Pencil" size={14} />
                        </button>
                      )}
                    </div>
                    <div className="space-y-2.5 sm:space-y-3">
                      <div>
                        <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Name</label>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editForm.customerName}
                            onChange={(e) => setEditForm(f => ({ ...f, customerName: e.target.value }))}
                            className={inputClasses}
                          />
                        ) : (
                          <p className="font-body font-body-normal text-sm text-text-primary">{booking.customerName}</p>
                        )}
                      </div>
                      {(booking.customerEmail && !isEditing) && (
                        <div>
                          <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Email</label>
                          <p className="font-body font-body-normal text-sm text-text-primary break-all">{booking.customerEmail}</p>
                        </div>
                      )}
                      <div>
                        <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Phone</label>
                        {isEditing ? (
                          <input
                            type="tel"
                            value={editForm.customerPhone}
                            onChange={(e) => setEditForm(f => ({ ...f, customerPhone: e.target.value }))}
                            className={inputClasses}
                            placeholder="Phone number"
                          />
                        ) : (
                          booking.customerPhone ? (
                            <p className="font-body font-body-normal text-sm text-text-primary">{booking.customerPhone}</p>
                          ) : (
                            <p className="font-body font-body-normal text-sm text-text-secondary italic">Not provided</p>
                          )
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 sm:space-y-4">
                    <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">
                      Service Details
                    </h3>
                    <div className="space-y-2.5 sm:space-y-3">
                      <div>
                        <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Service</label>
                        {isEditing && services?.length > 0 ? (
                          <>
                            <CustomSelect
                              value={editForm.serviceId}
                              onChange={(val) => setEditForm(f => ({ ...f, serviceId: val }))}
                              options={services.map(s => ({ value: s.id, label: s.name }))}
                              placeholder="Select service"
                              searchable
                              size="sm"
                            />
                            {selectedService && (
                              <p className="font-caption text-xs text-text-secondary mt-1">
                                {selectedService.duration_minutes} min — NPR {selectedService.price_npr?.toLocaleString('en-IN')}
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="font-body font-body-normal text-sm text-text-primary">{booking.service}</p>
                        )}
                      </div>
                      {!isEditing && (
                        <div className="flex gap-4">
                          <div>
                            <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Duration</label>
                            <p className="font-body font-body-normal text-sm text-text-primary">{booking.duration}</p>
                          </div>
                          <div>
                            <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Price</label>
                            <p className="font-body font-body-normal text-sm text-text-primary">{booking.price}</p>
                          </div>
                        </div>
                      )}
                      <div>
                        <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Date & Time</label>
                        {isEditing ? (
                          <div className="flex gap-2">
                            <input
                              type="date"
                              value={editForm.date}
                              onChange={(e) => setEditForm(f => ({ ...f, date: e.target.value }))}
                              className={inputClasses}
                            />
                            <input
                              type="time"
                              value={editForm.startTime}
                              onChange={(e) => setEditForm(f => ({ ...f, startTime: e.target.value }))}
                              className={inputClasses}
                            />
                          </div>
                        ) : (
                          <p className="font-body font-body-normal text-sm text-text-primary">{booking.date} at {to12h(booking.time || booking.startTime)}</p>
                        )}
                      </div>
                      <div>
                        <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Payment</label>
                        <p className={`font-body font-body-medium text-sm ${booking.paymentStatus === 'paid' ? 'text-success' : 'text-warning'}`}>
                          {booking.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Therapist(s) */}
                {(booking.therapists?.length > 0 || booking.therapist) && !isEditing && (
                  <div className="space-y-1.5 sm:space-y-2">
                    <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">
                      Assigned Therapist{(booking.therapists?.length || 0) > 1 ? 's' : ''}
                    </label>
                    <div className="font-body font-body-normal text-sm text-text-primary">
                      {(booking.therapists?.length > 0 ? booking.therapists : [booking.therapist]).filter(Boolean).map((t, i) => (
                        <span key={t.id}>
                          {i > 0 && ', '}
                          {t.name}{t.gender ? ` (${t.gender})` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Special Requests */}
                <div className="space-y-1.5 sm:space-y-2">
                  <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Special Requests</label>
                  {isEditing ? (
                    <textarea
                      value={editForm.specialRequests}
                      onChange={(e) => setEditForm(f => ({ ...f, specialRequests: e.target.value }))}
                      rows={2}
                      placeholder="Any special requests or notes..."
                      className={`${inputClasses} resize-none`}
                    />
                  ) : booking.specialRequests ? (
                    <div className="p-2.5 sm:p-3 bg-background rounded-spa">
                      <p className="font-body font-body-normal text-sm text-text-primary">{booking.specialRequests}</p>
                    </div>
                  ) : (
                    <p className="font-body font-body-normal text-sm text-text-secondary italic">None</p>
                  )}
                </div>

                {/* Created-by audit line — only when a staff creator was recorded */}
                {!isEditing && creator?.createdByName && (
                  <div className="pt-3 border-t border-border">
                    <p className="font-caption text-xs text-text-tertiary">
                      <Icon name="UserPlus" size={12} className="inline-block mr-1 -mt-0.5" />
                      Created by{' '}
                      <span className="text-text-secondary">{creator.createdByName}</span>
                      {creator.createdAt ? ` · ${formatCreatedAt(creator.createdAt)}` : ''}
                    </p>
                  </div>
                )}

                {/* Action error (status update failures) */}
                {actionError && !editError && (
                  <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-error/10 border border-error/20">
                    <Icon name="AlertTriangle" size={14} className="text-error flex-shrink-0" />
                    <span className="font-body font-body-normal text-xs text-error">{actionError}</span>
                  </div>
                )}

                {/* Edit error */}
                {editError && (
                  <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-error/10 border border-error/20">
                    <Icon name="AlertTriangle" size={14} className="text-error flex-shrink-0" />
                    <span className="font-body font-body-normal text-xs text-error">{editError}</span>
                  </div>
                )}
              </div>
            )}

            {/* Assigned Tab */}
            {activeTab === 'assign' && (
              <div className="space-y-4 sm:space-y-6">
                {isMutationBlocked && (
                  <div className={`flex items-center space-x-2 px-3 py-2.5 rounded-spa ${isLocked ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50 border border-gray-200'}`}>
                    <Icon name="Lock" size={16} className={isLocked ? 'text-amber-600' : 'text-gray-500'} />
                    <span className={`font-body font-body-medium text-xs ${isLocked ? 'text-amber-700' : 'text-gray-600'}`}>
                      Assignment is disabled — {isLocked ? 'day is closed' : 'booking is immutable'}
                    </span>
                  </div>
                )}

                {/* Section 1: Therapist */}
                <div className="space-y-3">
                  <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">
                    Therapist
                  </h3>
                  {therapists.length === 0 ? (
                    <p className="font-body font-body-normal text-sm text-text-secondary">No therapists available.</p>
                  ) : (
                    <div>
                      <div className="relative mb-2">
                        <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                        <input
                          type="text"
                          value={therapistSearch}
                          onChange={(e) => setTherapistSearch(e.target.value)}
                          placeholder="Search therapists..."
                          className="w-full pl-8 pr-3 py-2 bg-background border border-border rounded-spa text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                        />
                      </div>
                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                      {therapists
                        .filter(t => !therapistSearch.trim() || t.name.toLowerCase().includes(therapistSearch.toLowerCase()))
                        .map((therapist) => {
                        const isSelected = selectedTherapists.includes(therapist.id);
                        const isCurrentlyAssigned = booking?.therapists?.some(t => t.id === therapist.id)
                          || booking?.therapist?.id === therapist.id;
                        return (
                          <label
                            key={therapist.id}
                            className={`flex items-center space-x-3 sm:space-x-4 p-3 rounded-spa border-2 cursor-pointer spa-transition-fast min-h-[52px] ${
                              isSelected
                                ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              value={therapist.id}
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedTherapists(prev => [...prev, therapist.id]);
                                } else {
                                  setSelectedTherapists(prev => prev.filter(id => id !== therapist.id));
                                }
                              }}
                              className="text-primary focus:ring-primary w-4 h-4 rounded"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-body font-body-medium text-sm text-text-primary truncate">
                                  {therapist.name}
                                  {isCurrentlyAssigned && (
                                    <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-success/10 text-success">Assigned</span>
                                  )}
                                </span>
                                <span className="text-xs font-caption font-caption-normal text-text-secondary capitalize flex-shrink-0">
                                  {therapist.gender}
                                </span>
                              </div>
                              {therapist.specialties && therapist.specialties.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {therapist.specialties.map((specialty) => (
                                    <span
                                      key={specialty}
                                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal bg-accent/10 text-accent"
                                    >
                                      {specialty}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                    </div>
                  )}
                </div>

                {/* Section 2: Room */}
                {rooms.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">
                      Room
                    </h3>
                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                      {/* Unassign room option */}
                      <label
                        className={`flex items-center space-x-3 sm:space-x-4 p-3 rounded-spa border-2 cursor-pointer spa-transition-fast min-h-[44px] ${
                          selectedRoom === ''
                            ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="room"
                          value=""
                          checked={selectedRoom === ''}
                          onChange={() => setSelectedRoom('')}
                          className="text-primary focus:ring-primary w-4 h-4"
                        />
                        <span className="font-body font-body-normal text-sm text-text-secondary italic">No room assigned</span>
                      </label>
                      {rooms.map((room) => (
                        <label
                          key={room.id}
                          className={`flex items-center space-x-3 sm:space-x-4 p-3 rounded-spa border-2 cursor-pointer spa-transition-fast min-h-[44px] ${
                            selectedRoom === room.id
                              ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <input
                            type="radio"
                            name="room"
                            value={room.id}
                            checked={selectedRoom === room.id}
                            onChange={(e) => setSelectedRoom(e.target.value)}
                            className="text-primary focus:ring-primary w-4 h-4"
                          />
                          <div className="flex items-center gap-2">
                            <Icon name="DoorOpen" size={14} className="text-text-secondary" />
                            <span className="font-body font-body-medium text-sm text-text-primary">
                              {room.name}
                              {booking?.roomId === room.id && (
                                <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-primary/10 text-primary">Allocated</span>
                              )}
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5 sm:space-y-2">
                  <label className="font-body font-body-medium text-xs sm:text-sm text-text-primary">
                    Assignment Notes
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add any special instructions for the therapist..."
                    rows={3}
                    className="w-full px-3 py-2.5 border border-border rounded-spa bg-surface text-text-primary text-sm focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast resize-none"
                  />
                </div>

                {actionError && (
                  <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-error/10 border border-error/20">
                    <Icon name="AlertTriangle" size={14} className="text-error flex-shrink-0" />
                    <span className="font-body font-body-normal text-xs text-error">{actionError}</span>
                  </div>
                )}
              </div>
            )}

            {/* Discount Tab */}
            {activeTab === 'discount' && (
              <div className="space-y-4 sm:space-y-6">
                <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">
                  Apply Discount
                </h3>

                {!canDiscount ? (
                  <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-gray-50 border border-gray-200">
                    <Icon name="Lock" size={16} className="text-gray-500 flex-shrink-0" />
                    <span className="font-body font-body-medium text-xs text-gray-600">
                      {booking.paymentStatus === 'paid'
                        ? 'Cannot modify discount on a paid booking.'
                        : 'Discount changes are not allowed for this booking state.'}
                    </span>
                  </div>
                ) : (
                  <>
                    {/* All bookings pricing summary */}
                    <div className="bg-background rounded-spa p-3 sm:p-4 space-y-2">
                      {(() => {
                        const base = booking.baseAmount || 0;
                        let previewDiscountAmt = booking.discountAmount || 0;
                        let previewDiscountPct = base > 0 ? Math.round((previewDiscountAmt / base) * 100) : 0;
                        if (discountValue !== '' && discountValue !== null && discountValue !== undefined) {
                          if (discountType === 'percentage') {
                            previewDiscountPct = Number(discountValue) || 0;
                            previewDiscountAmt = Math.round(base * previewDiscountPct / 100 * 100) / 100;
                          } else {
                            previewDiscountAmt = Number(discountValue) || 0;
                            previewDiscountPct = base > 0 ? Math.round((previewDiscountAmt / base) * 100 * 10) / 10 : 0;
                          }
                        }
                        const previewFinal = Math.max(base - previewDiscountAmt, 0);
                        const hasLivePreview = discountValue !== '' && discountValue !== null && discountValue !== undefined;
                        const hasExistingDiscount = booking.discountAmount > 0;
                        const showDiscount = hasLivePreview || hasExistingDiscount;

                        // Related bookings totals
                        const relatedTotal = relatedBookings.reduce((s, rb) => s + Number(rb.final_amount || rb.base_amount || 0), 0);
                        const overallTotal = previewFinal + relatedTotal;

                        return (
                          <>
                            {/* Current booking — checkbox only when multiple services */}
                            {relatedBookings.length > 0 ? (
                              <label className="flex items-start gap-2 mb-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={selectedDiscountIds.has(booking.bookingId)}
                                  onChange={(e) => {
                                    setSelectedDiscountIds(prev => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.add(booking.bookingId);
                                      else next.delete(booking.bookingId);
                                      return next;
                                    });
                                  }}
                                  className="text-primary focus:ring-primary w-3.5 h-3.5 rounded mt-0.5"
                                />
                                <div className="flex-1 min-w-0">
                                  <span className="font-body font-body-medium text-xs text-text-primary">{booking.service}</span>
                                  <div className="font-caption text-[10px] text-text-secondary flex flex-wrap gap-x-2">
                                    {booking.time && <span>{to12h(booking.startTime || booking.time)}{booking.startTime && booking.startTime !== booking.time ? '' : ''}</span>}
                                    {booking.therapist?.name && <span>· {booking.therapist.name}</span>}
                                    {booking.roomName && <span>· {booking.roomName}</span>}
                                  </div>
                                </div>
                              </label>
                            ) : null}
                            <div className="flex items-center justify-between">
                              <span className="font-body font-body-normal text-xs text-text-secondary">Base Amount</span>
                              <span className="font-data text-sm text-text-primary">NPR {base.toLocaleString('en-IN')}</span>
                            </div>
                            {showDiscount && (
                              <div className="flex items-center justify-between">
                                <span className="font-body font-body-normal text-xs text-text-secondary">
                                  {hasLivePreview ? 'Discount Preview' : 'Discount Applied'}
                                </span>
                                <span className={`font-data text-sm ${hasLivePreview ? 'text-warning' : 'text-error'}`}>
                                  - NPR {previewDiscountAmt.toLocaleString('en-IN')} ({previewDiscountPct}%)
                                </span>
                              </div>
                            )}
                            <div className="flex items-center justify-between">
                              <span className="font-body font-body-normal text-xs text-text-secondary">Subtotal</span>
                              <span className={`font-data text-sm ${hasLivePreview ? 'text-warning' : 'text-text-primary'}`}>
                                NPR {previewFinal.toLocaleString('en-IN')}
                              </span>
                            </div>

                            {/* Related bookings */}
                            {relatedBookings.length > 0 && (
                              <>
                                <div className="border-t border-border my-2" />
                                {relatedBookings.map(rb => {
                                  const rbBase = Number(rb.base_amount || 0);
                                  const rbExistingDiscount = Number(rb.discount_amount || 0);
                                  const rbChecked = selectedDiscountIds.has(rb.id);
                                  // Live preview for checked related bookings
                                  let rbPreviewDiscount = rbExistingDiscount;
                                  if (rbChecked && hasLivePreview) {
                                    if (discountType === 'percentage') {
                                      rbPreviewDiscount = Math.round(rbBase * Number(discountValue) / 100 * 100) / 100;
                                    } else {
                                      // Fixed: proportional based on base amounts
                                      const pct = base > 0 ? Number(discountValue) / base : 0;
                                      rbPreviewDiscount = Math.round(rbBase * pct * 100) / 100;
                                    }
                                  }
                                  const rbPreviewFinal = Math.max(rbBase - rbPreviewDiscount, 0);
                                  const rbHasPreview = rbChecked && hasLivePreview;
                                  return (
                                    <div key={rb.id} className="space-y-1">
                                      <label className="flex items-start gap-2 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={rbChecked}
                                          onChange={(e) => {
                                            setSelectedDiscountIds(prev => {
                                              const next = new Set(prev);
                                              if (e.target.checked) next.add(rb.id);
                                              else next.delete(rb.id);
                                              return next;
                                            });
                                          }}
                                          className="text-primary focus:ring-primary w-3.5 h-3.5 rounded mt-0.5"
                                        />
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center justify-between">
                                            <span className="font-body text-xs text-text-primary font-medium">{rb.service?.name || 'Service'}</span>
                                            <span className="font-caption text-[10px] text-text-secondary">{rb.booking_number}</span>
                                          </div>
                                          <div className="font-caption text-[10px] text-text-secondary flex flex-wrap gap-x-2">
                                            {rb.start_time && <span>{to12h(rb.start_time)}{rb.end_time ? ` – ${to12h(rb.end_time)}` : ''}</span>}
                                            {rb.therapist?.name && <span>· {rb.therapist.name}</span>}
                                            {rb.room?.name && <span>· {rb.room.name}</span>}
                                          </div>
                                        </div>
                                      </label>
                                      <div className="flex items-center justify-between pl-5">
                                        <span className="font-body font-body-normal text-xs text-text-secondary">Base</span>
                                        <span className="font-data text-sm text-text-primary">NPR {rbBase.toLocaleString('en-IN')}</span>
                                      </div>
                                      {(rbHasPreview || rbExistingDiscount > 0) && (
                                        <div className="flex items-center justify-between pl-5">
                                          <span className="font-body font-body-normal text-xs text-text-secondary">
                                            {rbHasPreview ? 'Discount Preview' : 'Discount'}
                                          </span>
                                          <span className={`font-data text-sm ${rbHasPreview ? 'text-warning' : 'text-error'}`}>
                                            - NPR {rbPreviewDiscount.toLocaleString('en-IN')} ({rbBase > 0 ? Math.round(rbPreviewDiscount / rbBase * 100) : 0}%)
                                          </span>
                                        </div>
                                      )}
                                      <div className="flex items-center justify-between pl-5">
                                        <span className="font-body font-body-normal text-xs text-text-secondary">Subtotal</span>
                                        <span className={`font-data text-sm ${rbHasPreview ? 'text-warning' : 'text-text-primary'}`}>
                                          NPR {rbPreviewFinal.toLocaleString('en-IN')}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </>
                            )}

                            {/* Overall total */}
                            {(() => {
                              // Compute overall with live preview
                              let total = selectedDiscountIds.has(booking.bookingId) ? previewFinal : (booking.finalAmount || base);
                              relatedBookings.forEach(rb => {
                                const rbBase = Number(rb.base_amount || 0);
                                const rbChecked = selectedDiscountIds.has(rb.id);
                                if (rbChecked && hasLivePreview) {
                                  let rbDis;
                                  if (discountType === 'percentage') rbDis = Math.round(rbBase * Number(discountValue) / 100 * 100) / 100;
                                  else { const pct = base > 0 ? Number(discountValue) / base : 0; rbDis = Math.round(rbBase * pct * 100) / 100; }
                                  total += Math.max(rbBase - rbDis, 0);
                                } else {
                                  total += Number(rb.final_amount || rb.base_amount || 0);
                                }
                              });
                              return (
                                <div className="flex items-center justify-between border-t border-border pt-2 mt-1">
                                  <span className="font-body font-body-medium text-xs text-text-primary">
                                    {relatedBookings.length > 0 ? 'Overall Total' : 'Final Amount'}
                                  </span>
                                  <span className={`font-data font-data-medium text-sm ${hasLivePreview ? 'text-warning' : 'text-primary'}`}>
                                    NPR {total.toLocaleString('en-IN')}
                                  </span>
                                </div>
                              );
                            })()}
                          </>
                        );
                      })()}
                      {booking.discountAmount > 0 && (
                        <button
                          onClick={async () => {
                            if (!onApplyDiscount) return;
                            setIsLoading(true);
                            setDiscountError(null);
                            const result = await onApplyDiscount(booking.bookingId, {
                              discountType: 'fixed',
                              discountValue: 0,
                              discountReason: 'Discount cancelled',
                            });
                            if (result?.error) {
                              setDiscountError(result.error.message || 'Failed to cancel discount.');
                            } else {
                              setDiscountSuccess('removed');
                            }
                            setIsLoading(false);
                          }}
                          disabled={isLoading}
                          className="w-full text-center py-2 text-xs font-body font-body-medium text-error border border-error/30 rounded-spa hover:bg-error/5 spa-transition-fast"
                        >
                          Cancel Discount
                        </button>
                      )}
                    </div>

                    {/* Role limit info */}
                    <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-accent/5 border border-accent/20">
                      <Icon name="Info" size={14} className="text-accent flex-shrink-0" />
                      <span className="font-caption font-caption-normal text-xs text-accent">
                        Your role ({userRole}) allows up to {discountLimitLabel} discount.
                        {userRole !== 'admin' && userRole !== 'manager' && ' You can request up to 50% from a manager or admin.'}
                      </span>
                    </div>

                    {/* Discount type */}
                    <div className="grid grid-cols-2 gap-2 sm:gap-3">
                      {['percentage', 'fixed'].map(type => (
                        <label
                          key={type}
                          className={`flex items-center space-x-2 p-2.5 sm:p-3 rounded-spa border-2 cursor-pointer spa-transition-fast min-h-[48px] ${
                            discountType === type ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <input
                            type="radio"
                            name="discountType"
                            value={type}
                            checked={discountType === type}
                            onChange={() => setDiscountType(type)}
                            className="text-primary focus:ring-primary w-4 h-4"
                          />
                          <span className="font-body font-body-medium text-xs sm:text-sm text-text-primary">
                            {type === 'percentage' ? '% Percent' : 'NPR Fixed'}
                          </span>
                        </label>
                      ))}
                    </div>

                    {/* Discount value */}
                    <div className="space-y-1.5 sm:space-y-2">
                      <label className="font-body font-body-medium text-xs sm:text-sm text-text-primary">
                        {discountType === 'percentage' ? 'Discount Percentage' : 'Discount Amount (NPR)'}
                      </label>
                      <input
                        type="number"
                        min="0"
                        max={discountType === 'percentage' ? 100 : Math.floor(booking.baseAmount || 0)}
                        step={discountType === 'percentage' ? 1 : 10}
                        value={discountValue}
                        onChange={(e) => { setDiscountValue(e.target.value); setDiscountError(null); }}
                        placeholder={discountType === 'percentage' ? `Max ${discountLimitLabel}` : `Max NPR ${Math.floor((booking.baseAmount || 0) * (userRole === 'admin' ? 0.50 : userRole === 'manager' ? 0.50 : 0.15))}`}
                        className={`w-full px-3 py-2.5 border rounded-spa bg-surface text-text-primary text-sm focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast ${
                          discountValue && (() => {
                            const maxP = userRole === 'admin' ? 50 : userRole === 'manager' ? 50 : 15;
                            const eff = discountType === 'percentage' ? Number(discountValue) : (booking.baseAmount > 0 ? (Number(discountValue) / booking.baseAmount) * 100 : 0);
                            return eff > maxP;
                          })() ? 'border-error' : 'border-border'
                        }`}
                      />
                      {discountExceedsCap && (
                        <p className="text-xs text-error mt-1 flex items-center gap-1">
                          <Icon name="AlertTriangle" size={12} />
                          Discount cannot exceed {DISCOUNT_HARD_CAP}%.
                        </p>
                      )}
                      {discountExceedsLimit && (
                        <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                          <Icon name="AlertTriangle" size={12} />
                          Exceeds your {discountMaxPercent}% limit — send a request to an approver below.
                        </p>
                      )}
                    </div>

                    {/* Reason / Remarks */}
                    <div className="space-y-1.5 sm:space-y-2">
                      <label className="font-body font-body-medium text-xs sm:text-sm text-text-primary">
                        {discountExceedsLimit ? 'Remarks' : 'Reason'} <span className="text-error">*</span>
                      </label>
                      <textarea
                        value={discountReason}
                        onChange={(e) => setDiscountReason(e.target.value)}
                        placeholder={discountExceedsLimit ? 'Add remarks for the approver…' : 'Why is this discount being applied?'}
                        rows={2}
                        className="w-full px-3 py-2.5 border border-border rounded-spa bg-surface text-text-primary text-sm focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast resize-none"
                      />
                    </div>

                    {/* Request routing — only when discount exceeds the user's limit */}
                    {discountExceedsLimit && (
                      <div className="space-y-3 p-3 rounded-spa bg-amber-50 border border-amber-200">
                        <div className="flex items-center gap-2">
                          <Icon name="Send" size={14} className="text-amber-600" />
                          <span className="font-body font-body-medium text-xs sm:text-sm text-amber-800">
                            Send discount request for approval
                          </span>
                        </div>

                        {/* Request summary */}
                        <div className="space-y-1 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-text-secondary">Client</span>
                            <span className="font-body-medium text-text-primary">{booking.customerName || '—'}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-text-secondary">Package</span>
                            <span className="font-body-medium text-text-primary text-right">{booking.service || '—'}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-text-secondary">Discount</span>
                            <span className="font-data text-error">
                              {Math.round(discountEffPercent)}% · NPR {previewDiscountAmount.toLocaleString('en-IN')}
                            </span>
                          </div>
                        </div>

                        {/* Approver picker */}
                        <div className="space-y-1.5">
                          <label className="font-body font-body-medium text-xs text-text-primary">
                            Send request to <span className="text-error">*</span>
                          </label>
                          {approvers.length === 0 ? (
                            <p className="text-xs text-text-tertiary">No managers or admins available to approve.</p>
                          ) : (
                            <CustomSelect
                              value={selectedApprover}
                              onChange={(val) => { setSelectedApprover(val); setDiscountError(null); }}
                              options={approvers.map(a => ({
                                value: a.id,
                                label: `${a.fullName} (${a.role === 'admin' ? 'Admin' : 'Branch Manager'})`,
                              }))}
                              placeholder="Select an approver…"
                              size="md"
                            />
                          )}
                        </div>
                      </div>
                    )}

                    {/* Error / Success */}
                    {discountError && (
                      <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-error/10 border border-error/20">
                        <Icon name="AlertTriangle" size={14} className="text-error flex-shrink-0" />
                        <span className="font-body font-body-normal text-xs text-error">{discountError}</span>
                      </div>
                    )}
                    {discountSuccess === 'approved' && (
                      <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-success/10 border border-success/20">
                        <Icon name="CheckCircle" size={14} className="text-success flex-shrink-0" />
                        <span className="font-body font-body-normal text-xs text-success">Discount applied successfully.</span>
                      </div>
                    )}
                    {discountSuccess === 'removed' && (
                      <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-success/10 border border-success/20">
                        <Icon name="CheckCircle" size={14} className="text-success flex-shrink-0" />
                        <span className="font-body font-body-normal text-xs text-success">Discount removed successfully.</span>
                      </div>
                    )}
                    {discountSuccess === 'pending' && (
                      <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-amber-50 border border-amber-200">
                        <Icon name="Clock" size={14} className="text-amber-600 flex-shrink-0" />
                        <span className="font-body font-body-normal text-xs text-amber-700">Discount request sent for approval.</span>
                      </div>
                    )}

                    <Button
                      variant="primary"
                      onClick={handleApplyDiscount}
                      loading={isLoading}
                      disabled={!discountValue || !discountReason.trim() || selectedDiscountIds.size === 0 || discountExceedsCap || (discountExceedsLimit && !selectedApprover)}
                      iconName={discountExceedsLimit ? 'Send' : 'Percent'}
                      iconPosition="left"
                      className="w-full sm:w-auto min-h-[44px]"
                    >
                      {discountExceedsLimit
                        ? 'Send Discount Request'
                        : (selectedDiscountIds.size > 1 ? `Apply Discount to ${selectedDiscountIds.size} Services` : 'Apply Discount')}
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* Payment Tab */}
            {activeTab === 'payment' && (() => {
              const combinedTotal = (booking.finalAmount || 0) +
                relatedBookings
                  .filter(rb => selectedPaymentIds.has(rb.id))
                  .reduce((sum, rb) => sum + Number(rb.final_amount || rb.base_amount || 0), 0);

              return (
              <div className="space-y-4 sm:space-y-6">
                <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">
                  Payment Status
                </h3>

                {/* Current booking */}
                <div className="bg-background rounded-spa p-3 sm:p-4 space-y-2">
                  {relatedBookings.length > 0 && (
                    <div className="flex items-center gap-2 mb-1">
                      <Icon name="CheckSquare" size={14} className="text-primary" />
                      <span className="font-body font-body-medium text-xs text-text-primary">{booking.service}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="font-body font-body-normal text-xs text-text-secondary">Base Amount</span>
                    <span className="font-data text-sm text-text-primary">NPR {booking.baseAmount?.toLocaleString('en-IN') || '—'}</span>
                  </div>
                  {booking.discountAmount > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="font-body font-body-normal text-xs text-text-secondary">Discount</span>
                      <span className="font-data text-sm text-error">- NPR {booking.discountAmount?.toLocaleString('en-IN')} ({booking.baseAmount > 0 ? Math.round((booking.discountAmount / booking.baseAmount) * 100) : 0}%)</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between border-t border-border pt-2">
                    <span className="font-body font-body-medium text-xs text-text-primary">{relatedBookings.length > 0 ? 'Subtotal' : 'Final Amount'}</span>
                    <span className="font-data font-data-medium text-sm text-text-primary">NPR {booking.finalAmount?.toLocaleString('en-IN') || '—'}</span>
                  </div>
                </div>

                {/* Pending bookings aren't payable yet — guide staff to confirm/complete first */}
                {!canPay && booking.status === 'pending' && booking.paymentStatus !== 'paid' && !isLocked && (
                  <div className="flex items-start space-x-2 px-3 py-2.5 rounded-spa bg-warning/5 border border-warning/20">
                    <Icon name="Info" size={14} className="text-warning flex-shrink-0 mt-0.5" />
                    <span className="font-body font-body-normal text-xs sm:text-sm text-warning">
                      {relatedBookings.length > 0
                        ? `Confirm or complete the bookings before recording payment. Once they're confirmed, this and ${relatedBookings.length} related service${relatedBookings.length > 1 ? 's' : ''} for ${booking.customerName} can be selected and paid together here.`
                        : 'Confirm or complete this booking before recording payment.'}
                    </span>
                  </div>
                )}

                {/* Related unpaid bookings */}
                {relatedBookings.length > 0 && canPay && (
                  <div className="space-y-2">
                    <label className="font-body font-body-medium text-xs text-text-secondary uppercase">
                      Other unpaid services for {booking.customerName}
                    </label>
                    <div className="border border-border rounded-spa divide-y divide-border overflow-hidden">
                      {relatedBookings.map(rb => {
                        const isChecked = selectedPaymentIds.has(rb.id);
                        const rbFinal = Number(rb.final_amount || rb.base_amount || 0);
                        const rbDiscount = Number(rb.discount_amount || 0);
                        return (
                          <label key={rb.id} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-background/50 ${isChecked ? 'bg-primary/5' : ''}`}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                setSelectedPaymentIds(prev => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(rb.id);
                                  else next.delete(rb.id);
                                  return next;
                                });
                              }}
                              className="text-primary focus:ring-primary w-4 h-4 rounded"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-body text-sm text-text-primary">{rb.service?.name || 'Service'}</div>
                              <div className="font-caption text-xs text-text-secondary flex flex-wrap gap-x-1">
                                <span>{to12h(rb.start_time)}{rb.end_time ? ` – ${to12h(rb.end_time)}` : ''}</span>
                                {rb.therapist?.name && <span>· {rb.therapist.name}</span>}
                                {rb.room?.name && <span>· {rb.room.name}</span>}
                                <span>· {rb.booking_number}</span>
                                {rbDiscount > 0 && <span className="text-error">(-NPR {rbDiscount.toLocaleString('en-IN')})</span>}
                              </div>
                            </div>
                            <span className="font-data text-sm text-text-primary flex-shrink-0">NPR {rbFinal.toLocaleString('en-IN')}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Combined total */}
                {selectedPaymentIds.size > 0 && (
                  <div className="bg-primary/5 border border-primary/20 rounded-spa p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-body font-body-medium text-sm text-text-primary">
                        Combined Total ({1 + selectedPaymentIds.size} services)
                      </span>
                      <span className="font-data font-data-medium text-base text-primary">
                        NPR {combinedTotal.toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>
                )}

                {/* Payment status */}
                <div className="flex items-center justify-between px-1">
                  <span className="font-body font-body-normal text-xs text-text-secondary">Status</span>
                  <span className={`font-body font-body-medium text-sm ${booking.paymentStatus === 'paid' ? 'text-success' : 'text-warning'}`}>
                    {booking.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}
                  </span>
                </div>

                {canPay && (
                  <Button
                    variant="success"
                    onClick={() => setShowPaymentModal(true)}
                    iconName="CreditCard"
                    iconPosition="left"
                    className="w-full sm:w-auto min-h-[44px]"
                  >
                    {selectedPaymentIds.size > 0 ? `Pay ${1 + selectedPaymentIds.size} Services` : 'Record Payment'}
                  </Button>
                )}
                {booking.paymentStatus === 'paid' && (
                  <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-success/10 border border-success/20">
                    <Icon name="CheckCircle" size={14} className="text-success flex-shrink-0" />
                    <span className="font-body font-body-normal text-xs sm:text-sm text-success">Payment has been recorded.</span>
                  </div>
                )}
              </div>
              );
            })()}

            {/* Add Another Service / Rebook Form */}
            {newBookingMode && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon name={newBookingMode === 'rebook' ? 'CalendarClock' : 'PlusCircle'} size={18} className="text-primary" />
                    <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">
                      {newBookingMode === 'rebook' ? `${rebookLabel} Service` : 'Add Another Service'}
                    </h3>
                  </div>
                  <button
                    onClick={() => setNewBookingMode(null)}
                    className="p-1.5 rounded-spa hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
                  >
                    <Icon name="X" size={16} />
                  </button>
                </div>

                <div className="bg-background/50 rounded-spa p-3 border border-border/50">
                  <p className="font-body text-xs text-text-secondary">
                    Customer: <span className="font-semibold text-text-primary">{booking.customerName}</span>
                    {booking.customerPhone && <span className="ml-2">({booking.customerPhone})</span>}
                  </p>
                  {newBookingMode === 'rebook' && (
                    <p className="font-body text-xs text-text-secondary mt-1">
                      Same service: <span className="font-semibold text-text-primary">{booking.service}</span>
                    </p>
                  )}
                </div>

                {newBookingError && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-spa bg-error/10 border border-error/20">
                    <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0" />
                    <span className="font-body text-xs text-error">{newBookingError}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Service — editable only for "add another service" */}
                  {newBookingMode === 'add-service' && (
                    <div className="sm:col-span-2">
                      <label className="block font-body font-body-medium text-xs text-text-secondary mb-1">Service *</label>
                      <CustomSelect
                        value={newBookingForm.serviceId}
                        onChange={(val) => setNewBookingForm(f => ({ ...f, serviceId: val }))}
                        options={services.map(s => ({ value: s.id, label: `${s.name} — ${s.duration_minutes}min — NPR ${s.price_npr}` }))}
                        placeholder="Select service..."
                        searchable
                        size="sm"
                      />
                    </div>
                  )}

                  {/* Date */}
                  <div>
                    <label className="block font-body font-body-medium text-xs text-text-secondary mb-1">Date *</label>
                    <input
                      type="date"
                      value={newBookingForm.date}
                      min={new Date().toISOString().slice(0, 10)}
                      onChange={e => setNewBookingForm(f => ({ ...f, date: e.target.value }))}
                      className={inputClasses}
                    />
                  </div>

                  {/* Time */}
                  <div>
                    <label className="block font-body font-body-medium text-xs text-text-secondary mb-1">Time *</label>
                    <CustomSelect
                      value={newBookingForm.startTime}
                      onChange={(val) => setNewBookingForm(f => ({ ...f, startTime: val }))}
                      options={timeOptions.map(t => ({ value: t, label: format12h(t) }))}
                      placeholder="Select time..."
                      searchable
                      size="sm"
                    />
                  </div>

                  {/* Therapist */}
                  <div>
                    <label className="block font-body font-body-medium text-xs text-text-secondary mb-1">Therapist</label>
                    <CustomSelect
                      value={newBookingForm.therapistId}
                      onChange={(val) => setNewBookingForm(f => ({ ...f, therapistId: val }))}
                      options={[{ value: '', label: 'Any available' }, ...therapists.map(t => ({ value: t.id, label: t.name }))]}
                      placeholder="Any available"
                      size="sm"
                    />
                  </div>

                  {/* Room */}
                  <div>
                    <label className="block font-body font-body-medium text-xs text-text-secondary mb-1">Room</label>
                    <CustomSelect
                      value={newBookingForm.roomId}
                      onChange={(val) => setNewBookingForm(f => ({ ...f, roomId: val }))}
                      options={[{ value: '', label: 'Any available' }, ...rooms.map(r => ({ value: r.id, label: r.name }))]}
                      placeholder="Any available"
                      size="sm"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setNewBookingMode(null)} className="min-h-[44px] sm:min-h-0">
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleNewBookingSubmit}
                    loading={newBookingSubmitting}
                    className="min-h-[44px] sm:min-h-0"
                  >
                    {newBookingMode === 'rebook' ? rebookLabel : 'Create Booking'}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Footer - Responsive with safe area padding for iOS */}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 p-4 pb-6 sm:p-6 border-t border-border flex-shrink-0">
            {/* Left side — Add another service / Rebook */}
            {!isEditing && !newBookingMode && onCreateBooking ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openNewBookingForm('add-service')}
                  className="px-3 py-1.5 text-xs font-body font-body-medium text-primary border border-primary/30 rounded-spa hover:bg-primary/5 spa-transition-fast min-h-[36px]"
                >
                  Add another service
                </button>
                <button
                  onClick={() => onRebookStart?.(booking)}
                  className="px-3 py-1.5 text-xs font-body font-body-medium text-text-secondary border border-border rounded-spa hover:bg-background spa-transition-fast min-h-[36px]"
                >
                  {rebookLabel}
                </button>
              </div>
            ) : (
              <div />
            )}

            {/* Right side — action buttons */}
            <div className="flex items-center gap-2">
              {isEditing && activeTab === 'details' ? (
                <>
                  <Button variant="outline" onClick={cancelEditing} className="min-h-[44px] sm:min-h-0">
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleSaveEdit}
                    loading={isLoading}
                    className="min-h-[44px] sm:min-h-0"
                  >
                    Save Changes
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={onClose} className="min-h-[44px] sm:min-h-0">
                    Close
                  </Button>
                  {activeTab === 'assign' && !isMutationBlocked && (
                    <Button
                      variant="primary"
                      onClick={handleAssignTherapist}
                      loading={isLoading}
                      disabled={selectedTherapists.length === 0}
                      className="min-h-[44px] sm:min-h-0"
                    >
                      Save Assignment
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      {showPaymentModal && (
        <PaymentModal
          booking={{
            id: booking.id,
            bookingId: booking.bookingId,
            booking_number: booking.id,
            service: booking.service,
            base_amount: booking.baseAmount,
            discount_amount: booking.discountAmount,
            final_amount: booking.finalAmount,
          }}
          additionalBookings={relatedBookings.filter(rb => selectedPaymentIds.has(rb.id))}
          onConfirm={handlePaymentConfirm}
          onClose={() => setShowPaymentModal(false)}
          isSubmitting={paymentSubmitting}
        />
      )}
    </>,
    document.body
  );
};

export default BookingActionModal;
