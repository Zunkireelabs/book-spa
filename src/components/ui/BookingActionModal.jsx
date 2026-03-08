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
  onRecordPayment
}) => {
  const [activeTab, setActiveTab] = useState('details');
  const [selectedTherapist, setSelectedTherapist] = useState('');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);

  const tabs = [
    { id: 'details', label: 'Booking Details', icon: 'FileText' },
    { id: 'assign', label: 'Assign Therapist', icon: 'UserCheck' },
    { id: 'payment', label: 'Payment', icon: 'CreditCard' }
  ];

  // Valid next-status transitions (lowercase UI values)
  const getNextStatuses = (currentStatus) => {
    const transitions = {
      'pending': ['confirmed'],
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
  const canPay = ['confirmed', 'completed'].includes(booking.status) && booking.paymentStatus !== 'paid' && !isMutationBlocked;

  return (
    <>
      <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal flex items-center justify-center p-4">
        <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-2xl max-h-[90vh] overflow-hidden animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <Icon name="Calendar" size={20} className="text-primary" />
              </div>
              <div>
                <h2 className="font-heading font-heading-semibold text-lg text-text-primary">
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
