import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Button from './Button';
import CustomSelect from './CustomSelect';
import PaymentModal from './PaymentModal';
import Icon from '../AppIcon';

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
  const [selectedTherapist, setSelectedTherapist] = useState('');
  const [selectedRoom, setSelectedRoom] = useState('');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);

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

  // Add another service / Rebook state
  const [newBookingMode, setNewBookingMode] = useState(null); // 'add-service' | 'rebook' | null
  const [newBookingForm, setNewBookingForm] = useState({});
  const [newBookingError, setNewBookingError] = useState(null);
  const [newBookingSubmitting, setNewBookingSubmitting] = useState(false);

  // Pre-select current therapist/room when booking changes or assign tab opens
  useEffect(() => {
    if (booking) {
      setSelectedTherapist(booking.therapist?.id || '');
      setSelectedRoom(booking.roomId || '');
    }
  }, [booking?.bookingId]);

  // Reset edit state when booking changes
  useEffect(() => {
    setIsEditing(false);
    setEditError(null);
    setNewBookingMode(null);
    setNewBookingError(null);
    setNewBookingForm({});
    setNewBookingSubmitting(false);
  }, [booking?.bookingId]);

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
    try {
      if (onAssignTherapist) {
        await onAssignTherapist(booking.bookingId, selectedTherapist || null, notes, selectedRoom || null);
      }
      onClose();
    } catch (error) {
      console.error('Assignment failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStatusUpdate = async (newStatus) => {
    if (!booking) return;
    setIsLoading(true);
    try {
      if (onUpdateStatus) {
        await onUpdateStatus(booking.bookingId, newStatus);
      }
      onClose();
    } catch (error) {
      console.error('Status update failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePaymentConfirm = async ({ paymentMode, notes: paymentNotes }) => {
    if (!booking || !onRecordPayment) return { error: { message: 'No payment handler available.' } };
    setPaymentSubmitting(true);
    try {
      const result = await onRecordPayment(booking.bookingId, { paymentMode, notes: paymentNotes });
      if (!result?.error) {
        setShowPaymentModal(false);
        onClose();
      }
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
      setDiscountError('A reason is required for the discount.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await onApplyDiscount(booking.bookingId, {
        discountType,
        discountValue: Number(discountValue),
        discountReason: discountReason.trim()
      });
      if (result?.error) {
        setDiscountError(result.error.message || 'Failed to apply discount.');
      } else if (result?.data?.isPending) {
        setDiscountSuccess('pending');
        setDiscountValue('');
        setDiscountReason('');
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
  // "Rebook" reads as booking-again-after on terminal states; on active bookings "Book Another" is clearer
  const rebookLabel = isTerminal ? 'Rebook' : 'Book Another';

  const nextStatuses = getNextStatuses(booking.status);
  // Payment is allowed on Completed bookings (pay-after-service is standard cash-spa flow).
  // Only day-lock and already-paid block it — not terminal status.
  const canPay = ['confirmed', 'in-progress', 'completed'].includes(booking.status) && booking.paymentStatus !== 'paid' && !isLocked;
  const canDiscount = !isMutationBlocked && booking.paymentStatus !== 'paid' && !isTerminal;
  const discountLimitLabel = userRole === 'admin' ? 'Unlimited' : userRole === 'manager' ? '30%' : '5%';

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
                          <p className="font-body font-body-normal text-sm text-text-primary">{booking.date} at {booking.time}</p>
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

                {/* Therapist */}
                {booking.therapist && !isEditing && (
                  <div className="space-y-1.5 sm:space-y-2">
                    <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Assigned Therapist</label>
                    <p className="font-body font-body-normal text-sm text-text-primary">
                      {booking.therapist.name} ({booking.therapist.gender})
                    </p>
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
                    <div className="space-y-2 max-h-[240px] overflow-y-auto">
                      {therapists.map((therapist) => (
                        <label
                          key={therapist.id}
                          className={`flex items-center space-x-3 sm:space-x-4 p-3 rounded-spa border-2 cursor-pointer spa-transition-fast min-h-[52px] ${
                            selectedTherapist === therapist.id
                              ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <input
                            type="radio"
                            name="therapist"
                            value={therapist.id}
                            checked={selectedTherapist === therapist.id}
                            onChange={(e) => setSelectedTherapist(e.target.value)}
                            className="text-primary focus:ring-primary w-4 h-4"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-body font-body-medium text-sm text-text-primary truncate">
                                {therapist.name}
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
                      ))}
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
                    {/* Current pricing */}
                    <div className="bg-background rounded-spa p-3 sm:p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-body font-body-normal text-xs sm:text-sm text-text-secondary">Base Amount</span>
                        <span className="font-data font-data-medium text-sm text-text-primary">NPR {booking.baseAmount?.toLocaleString('en-IN') || '—'}</span>
                      </div>
                      {booking.discountAmount > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="font-body font-body-normal text-xs sm:text-sm text-text-secondary">Current Discount</span>
                          <span className="font-data font-data-medium text-sm text-error">- NPR {booking.discountAmount?.toLocaleString('en-IN')}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between border-t border-border pt-2">
                        <span className="font-body font-body-medium text-xs sm:text-sm text-text-primary">Final Amount</span>
                        <span className="font-data font-data-medium text-sm text-text-primary">NPR {booking.finalAmount?.toLocaleString('en-IN') || '—'}</span>
                      </div>
                    </div>

                    {/* Role limit info */}
                    <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-accent/5 border border-accent/20">
                      <Icon name="Info" size={14} className="text-accent flex-shrink-0" />
                      <span className="font-caption font-caption-normal text-xs text-accent">
                        Your role ({userRole}) allows up to {discountLimitLabel} discount.
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
                        max={discountType === 'percentage' ? 100 : booking.baseAmount}
                        step={discountType === 'percentage' ? 1 : 10}
                        value={discountValue}
                        onChange={(e) => setDiscountValue(e.target.value)}
                        placeholder={discountType === 'percentage' ? 'e.g. 5' : 'e.g. 200'}
                        className="w-full px-3 py-2.5 border border-border rounded-spa bg-surface text-text-primary text-sm focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast"
                      />
                    </div>

                    {/* Reason */}
                    <div className="space-y-1.5 sm:space-y-2">
                      <label className="font-body font-body-medium text-xs sm:text-sm text-text-primary">
                        Reason <span className="text-error">*</span>
                      </label>
                      <textarea
                        value={discountReason}
                        onChange={(e) => setDiscountReason(e.target.value)}
                        placeholder="Why is this discount being applied? (required)"
                        rows={2}
                        className="w-full px-3 py-2.5 border border-border rounded-spa bg-surface text-text-primary text-sm focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast resize-none"
                      />
                    </div>

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
                    {discountSuccess === 'pending' && (
                      <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-amber-50 border border-amber-200">
                        <Icon name="Clock" size={14} className="text-amber-600 flex-shrink-0" />
                        <span className="font-body font-body-normal text-xs text-amber-700">Discount exceeds your limit — sent for manager approval.</span>
                      </div>
                    )}

                    <Button
                      variant="primary"
                      onClick={handleApplyDiscount}
                      loading={isLoading}
                      disabled={!discountValue || !discountReason.trim()}
                      iconName="Percent"
                      iconPosition="left"
                      className="w-full sm:w-auto min-h-[44px]"
                    >
                      Apply Discount
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* Payment Tab */}
            {activeTab === 'payment' && (
              <div className="space-y-4 sm:space-y-6">
                <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">
                  Payment Status
                </h3>
                <div className="bg-background rounded-spa p-3 sm:p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-body font-body-normal text-xs sm:text-sm text-text-secondary">Amount</span>
                    <span className="font-body font-body-medium text-sm text-text-primary">{booking.price}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-body font-body-normal text-xs sm:text-sm text-text-secondary">Status</span>
                    <span className={`font-body font-body-medium text-sm ${booking.paymentStatus === 'paid' ? 'text-success' : 'text-warning'}`}>
                      {booking.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}
                    </span>
                  </div>
                </div>
                {canPay && (
                  <Button
                    variant="success"
                    onClick={() => setShowPaymentModal(true)}
                    iconName="CreditCard"
                    iconPosition="left"
                    className="w-full sm:w-auto min-h-[44px]"
                  >
                    Record Payment
                  </Button>
                )}
                {booking.paymentStatus === 'paid' && (
                  <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-success/10 border border-success/20">
                    <Icon name="CheckCircle" size={14} className="text-success flex-shrink-0" />
                    <span className="font-body font-body-normal text-xs sm:text-sm text-success">Payment has been recorded.</span>
                  </div>
                )}
              </div>
            )}

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
                      disabled={!selectedTherapist}
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
            booking_number: booking.id,
            base_amount: booking.baseAmount,
            discount_amount: booking.discountAmount,
            final_amount: booking.finalAmount,
          }}
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
