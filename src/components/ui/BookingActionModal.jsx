import React, { useState } from 'react';
import Button from './Button';
import PaymentModal from './PaymentModal';
import Icon from '../AppIcon';

const BookingActionModal = ({
  isOpen = false,
  onClose,
  booking = null,
  therapists = [],
  onAssignTherapist,
  onUpdateStatus,
  onRecordPayment,
  onApplyDiscount,
  userRole = 'staff'
}) => {
  const [activeTab, setActiveTab] = useState('details');
  const [selectedTherapist, setSelectedTherapist] = useState('');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);

  // Discount state
  const [discountType, setDiscountType] = useState('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [discountError, setDiscountError] = useState(null);
  const [discountSuccess, setDiscountSuccess] = useState(false);

  const tabs = [
    { id: 'details', label: 'Booking Details', icon: 'FileText' },
    { id: 'assign', label: 'Assign Therapist', icon: 'UserCheck' },
    { id: 'discount', label: 'Discount', icon: 'Percent' },
    { id: 'payment', label: 'Payment', icon: 'CreditCard' }
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

  const handleAssignTherapist = async () => {
    if (!selectedTherapist || !booking) return;

    setIsLoading(true);
    try {
      if (onAssignTherapist) {
        await onAssignTherapist(booking.bookingId, selectedTherapist, notes);
      }
      setSelectedTherapist('');
      setNotes('');
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

  const getStatusColor = (status) => {
    const colors = {
      pending: 'warning',
      confirmed: 'success',
      'in-progress': 'primary',
      completed: 'text-secondary',
      cancelled: 'error',
      'no show': 'error'
    };
    return colors[status] || 'text-secondary';
  };

  const nextStatuses = getNextStatuses(booking.status);
  const canPay = ['confirmed', 'in-progress', 'completed'].includes(booking.status) && booking.paymentStatus !== 'paid' && !isMutationBlocked;
  const canDiscount = !isMutationBlocked && booking.paymentStatus !== 'paid' && !isTerminal;
  const discountLimitLabel = userRole === 'admin' ? 'Unlimited' : userRole === 'manager' ? '30%' : '5%';

  return (
    <>
      <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="booking-modal-title">
        <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-2xl max-h-[90vh] overflow-hidden animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <Icon name="Calendar" size={20} className="text-primary" />
              </div>
              <div>
                <h2 id="booking-modal-title" className="font-heading font-heading-semibold text-lg text-text-primary">
                  Booking Management
                </h2>
                <p className="font-caption font-caption-normal text-sm text-text-secondary">
                  {booking.id} — {booking.customerName}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-spa hover:bg-background spa-transition-fast"
            >
              <Icon name="X" size={20} className="text-text-secondary" />
            </button>
          </div>

          {/* Tabs */}
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

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-96">
            {/* Details Tab */}
            {activeTab === 'details' && (
              <div className="space-y-6">
                {/* Lock / Immutability Banner */}
                {isMutationBlocked && (
                  <div className={`flex items-center space-x-2 px-3 py-2 rounded-spa ${
                    isLocked
                      ? 'bg-amber-50 border border-amber-200'
                      : 'bg-gray-50 border border-gray-200'
                  }`}>
                    <Icon name="Lock" size={16} className={isLocked ? 'text-amber-600' : 'text-gray-500'} />
                    <span className={`font-body font-body-medium text-xs ${isLocked ? 'text-amber-700' : 'text-gray-600'}`}>
                      {isLocked
                        ? 'Day Closed — Locked'
                        : booking.status === 'completed'
                          ? 'Completed — Financially Locked'
                          : `${booking.status.replace('-', ' ')} — Immutable`}
                    </span>
                  </div>
                )}

                {/* Status and Actions */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center space-x-2">
                    <span className="font-body font-body-medium text-sm text-text-primary">Status:</span>
                    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-caption font-caption-normal bg-${getStatusColor(booking.status)}/10 text-${getStatusColor(booking.status)} capitalize`}>
                      {booking.status.replace('-', ' ')}
                    </span>
                  </div>
                  {!isMutationBlocked && nextStatuses.length > 0 && (
                    <div className="flex items-center space-x-2 flex-wrap gap-1">
                      {nextStatuses.map((status) => (
                        <Button
                          key={status}
                          variant={status === 'cancelled' || status === 'no show' ? 'outline' : 'primary'}
                          size="xs"
                          onClick={() => handleStatusUpdate(status)}
                          loading={isLoading}
                        >
                          {status === 'in-progress' ? 'Start' : status === 'no show' ? 'No Show' : status.charAt(0).toUpperCase() + status.slice(1)}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Customer Information */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h3 className="font-heading font-heading-medium text-base text-text-primary">
                      Customer Information
                    </h3>
                    <div className="space-y-3">
                      <div>
                        <label className="font-body font-body-medium text-sm text-text-secondary">Name</label>
                        <p className="font-body font-body-normal text-sm text-text-primary">{booking.customerName}</p>
                      </div>
                      {booking.customerEmail && (
                        <div>
                          <label className="font-body font-body-medium text-sm text-text-secondary">Email</label>
                          <p className="font-body font-body-normal text-sm text-text-primary">{booking.customerEmail}</p>
                        </div>
                      )}
                      {booking.customerPhone && (
                        <div>
                          <label className="font-body font-body-medium text-sm text-text-secondary">Phone</label>
                          <p className="font-body font-body-normal text-sm text-text-primary">{booking.customerPhone}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="font-heading font-heading-medium text-base text-text-primary">
                      Service Details
                    </h3>
                    <div className="space-y-3">
                      <div>
                        <label className="font-body font-body-medium text-sm text-text-secondary">Service</label>
                        <p className="font-body font-body-normal text-sm text-text-primary">{booking.service}</p>
                      </div>
                      <div>
                        <label className="font-body font-body-medium text-sm text-text-secondary">Duration</label>
                        <p className="font-body font-body-normal text-sm text-text-primary">{booking.duration}</p>
                      </div>
                      <div>
                        <label className="font-body font-body-medium text-sm text-text-secondary">Date & Time</label>
                        <p className="font-body font-body-normal text-sm text-text-primary">{booking.date} at {booking.time}</p>
                      </div>
                      <div>
                        <label className="font-body font-body-medium text-sm text-text-secondary">Price</label>
                        <p className="font-body font-body-normal text-sm text-text-primary">{booking.price}</p>
                      </div>
                      <div>
                        <label className="font-body font-body-medium text-sm text-text-secondary">Payment</label>
                        <p className={`font-body font-body-medium text-sm ${booking.paymentStatus === 'paid' ? 'text-success' : 'text-warning'}`}>
                          {booking.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Therapist */}
                {booking.therapist && (
                  <div className="space-y-2">
                    <label className="font-body font-body-medium text-sm text-text-secondary">Assigned Therapist</label>
                    <p className="font-body font-body-normal text-sm text-text-primary">
                      {booking.therapist.name} ({booking.therapist.gender})
                    </p>
                  </div>
                )}

                {/* Special Requests */}
                {booking.specialRequests && (
                  <div className="space-y-2">
                    <label className="font-body font-body-medium text-sm text-text-secondary">Special Requests</label>
                    <div className="p-3 bg-background rounded-spa">
                      <p className="font-body font-body-normal text-sm text-text-primary">{booking.specialRequests}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Assign Tab */}
            {activeTab === 'assign' && (
              <div className="space-y-6">
                {isMutationBlocked && (
                  <div className={`flex items-center space-x-2 px-3 py-2 rounded-spa ${isLocked ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50 border border-gray-200'}`}>
                    <Icon name="Lock" size={16} className={isLocked ? 'text-amber-600' : 'text-gray-500'} />
                    <span className={`font-body font-body-medium text-xs ${isLocked ? 'text-amber-700' : 'text-gray-600'}`}>
                      Therapist assignment is disabled — {isLocked ? 'day is closed' : 'booking is immutable'}
                    </span>
                  </div>
                )}
                <h3 className="font-heading font-heading-medium text-base text-text-primary">
                  Available Therapists
                </h3>

                {therapists.length === 0 ? (
                  <p className="font-body font-body-normal text-sm text-text-secondary">No therapists available.</p>
                ) : (
                  <div className="space-y-3">
                    {therapists.map((therapist) => (
                      <label
                        key={therapist.id}
                        className={`flex items-center space-x-4 p-4 rounded-spa border-2 cursor-pointer spa-transition-fast ${
                          selectedTherapist === therapist.id
                            ? 'border-primary bg-primary/5' :'border-border hover:border-primary/50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="therapist"
                          value={therapist.id}
                          checked={selectedTherapist === therapist.id}
                          onChange={(e) => setSelectedTherapist(e.target.value)}
                          className="text-primary focus:ring-primary"
                        />
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="font-body font-body-medium text-sm text-text-primary">
                              {therapist.name}
                            </span>
                            <span className="text-xs font-caption font-caption-normal text-text-secondary capitalize">
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

                <div className="space-y-2">
                  <label className="font-body font-body-medium text-sm text-text-primary">
                    Assignment Notes
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add any special instructions for the therapist..."
                    rows={3}
                    className="w-full px-3 py-2 border border-border rounded-spa bg-surface text-text-primary focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast resize-none"
                  />
                </div>
              </div>
            )}

            {/* Discount Tab */}
            {activeTab === 'discount' && (
              <div className="space-y-6">
                <h3 className="font-heading font-heading-medium text-base text-text-primary">
                  Apply Discount
                </h3>

                {!canDiscount ? (
                  <div className="flex items-center space-x-2 px-3 py-2 rounded-spa bg-gray-50 border border-gray-200">
                    <Icon name="Lock" size={16} className="text-gray-500" />
                    <span className="font-body font-body-medium text-xs text-gray-600">
                      {booking.paymentStatus === 'paid'
                        ? 'Cannot modify discount on a paid booking.'
                        : 'Discount changes are not allowed for this booking state.'}
                    </span>
                  </div>
                ) : (
                  <>
                    {/* Current pricing */}
                    <div className="bg-background rounded-spa p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-body font-body-normal text-sm text-text-secondary">Base Amount</span>
                        <span className="font-data font-data-medium text-sm text-text-primary">NPR {booking.baseAmount?.toLocaleString('en-IN') || '—'}</span>
                      </div>
                      {booking.discountAmount > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="font-body font-body-normal text-sm text-text-secondary">Current Discount</span>
                          <span className="font-data font-data-medium text-sm text-error">- NPR {booking.discountAmount?.toLocaleString('en-IN')}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between border-t border-border pt-2">
                        <span className="font-body font-body-medium text-sm text-text-primary">Final Amount</span>
                        <span className="font-data font-data-medium text-sm text-text-primary">NPR {booking.finalAmount?.toLocaleString('en-IN') || '—'}</span>
                      </div>
                    </div>

                    {/* Role limit info */}
                    <div className="flex items-center space-x-2 px-3 py-2 rounded-spa bg-accent/5 border border-accent/20">
                      <Icon name="Info" size={14} className="text-accent" />
                      <span className="font-caption font-caption-normal text-xs text-accent">
                        Your role ({userRole}) allows up to {discountLimitLabel} discount.
                      </span>
                    </div>

                    {/* Discount type */}
                    <div className="grid grid-cols-2 gap-3">
                      {['percentage', 'fixed'].map(type => (
                        <label
                          key={type}
                          className={`flex items-center space-x-2 p-3 rounded-spa border-2 cursor-pointer spa-transition-fast ${
                            discountType === type ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <input
                            type="radio"
                            name="discountType"
                            value={type}
                            checked={discountType === type}
                            onChange={() => setDiscountType(type)}
                            className="text-primary focus:ring-primary"
                          />
                          <span className="font-body font-body-medium text-sm text-text-primary capitalize">
                            {type === 'percentage' ? 'Percentage (%)' : 'Fixed (NPR)'}
                          </span>
                        </label>
                      ))}
                    </div>

                    {/* Discount value */}
                    <div className="space-y-2">
                      <label className="font-body font-body-medium text-sm text-text-primary">
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
                        className="w-full px-3 py-2 border border-border rounded-spa bg-surface text-text-primary focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast"
                      />
                    </div>

                    {/* Reason */}
                    <div className="space-y-2">
                      <label className="font-body font-body-medium text-sm text-text-primary">
                        Reason <span className="text-error">*</span>
                      </label>
                      <textarea
                        value={discountReason}
                        onChange={(e) => setDiscountReason(e.target.value)}
                        placeholder="Why is this discount being applied? (required)"
                        rows={2}
                        className="w-full px-3 py-2 border border-border rounded-spa bg-surface text-text-primary focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast resize-none"
                      />
                    </div>

                    {/* Error / Success */}
                    {discountError && (
                      <div className="flex items-center space-x-2 px-3 py-2 rounded-spa bg-error/10 border border-error/20">
                        <Icon name="AlertTriangle" size={14} className="text-error" />
                        <span className="font-body font-body-normal text-xs text-error">{discountError}</span>
                      </div>
                    )}
                    {discountSuccess === 'approved' && (
                      <div className="flex items-center space-x-2 px-3 py-2 rounded-spa bg-success/10 border border-success/20">
                        <Icon name="CheckCircle" size={14} className="text-success" />
                        <span className="font-body font-body-normal text-xs text-success">Discount applied successfully.</span>
                      </div>
                    )}
                    {discountSuccess === 'pending' && (
                      <div className="flex items-center space-x-2 px-3 py-2 rounded-spa bg-amber-50 border border-amber-200">
                        <Icon name="Clock" size={14} className="text-amber-600" />
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
                    >
                      Apply Discount
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* Payment Tab */}
            {activeTab === 'payment' && (
              <div className="space-y-6">
                <h3 className="font-heading font-heading-medium text-base text-text-primary">
                  Payment Status
                </h3>
                <div className="bg-background rounded-spa p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-body font-body-normal text-sm text-text-secondary">Amount</span>
                    <span className="font-body font-body-medium text-sm text-text-primary">{booking.price}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-body font-body-normal text-sm text-text-secondary">Status</span>
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
                  >
                    Record Payment
                  </Button>
                )}
                {booking.paymentStatus === 'paid' && (
                  <p className="font-body font-body-normal text-sm text-success">Payment has been recorded.</p>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end space-x-3 p-6 border-t border-border">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            {activeTab === 'assign' && !isMutationBlocked && (
              <Button
                variant="primary"
                onClick={handleAssignTherapist}
                loading={isLoading}
                disabled={!selectedTherapist}
              >
                Assign Therapist
              </Button>
            )}
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
    </>
  );
};

export default BookingActionModal;
