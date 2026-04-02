import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import { updateBookingStatus } from '../../../services/api';

const CancellationModal = ({ isOpen, onClose, booking, onConfirm }) => {
  const [reason, setReason] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState(1); // 1: reason, 2: confirmation

  const cancellationReasons = [
    'Schedule conflict',
    'Personal emergency',
    'Health reasons',
    'Travel plans changed',
    'Service no longer needed',
    'Other'
  ];

  const calculateRefund = () => {
    const bookingDate = new Date(booking?.date);
    const currentDate = new Date();
    const hoursUntilBooking = (bookingDate - currentDate) / (1000 * 60 * 60);
    
    if (hoursUntilBooking >= 24) {
      return { amount: booking?.price, percentage: 100 };
    } else if (hoursUntilBooking >= 12) {
      return { amount: Math.round(booking?.price * 0.5), percentage: 50 };
    } else {
      return { amount: 0, percentage: 0 };
    }
  };

  const refundInfo = calculateRefund();

  const handleNext = () => {
    if (reason) {
      setStep(2);
    }
  };

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      // Call actual API to cancel booking
      const { data, error } = await updateBookingStatus({
        bookingId: booking.bookingId,
        newStatus: 'Cancelled',
      });

      if (error) {
        console.error('Cancellation failed:', error.message);
        return;
      }

      onConfirm({
        ...booking,
        status: 'cancelled',
        cancellationReason: reason,
        refundAmount: refundInfo.amount
      });
      onClose();
    } catch (error) {
      console.error('Cancellation failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal flex items-center justify-center p-4">
      <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-lg max-h-[90vh] overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-error/10 rounded-lg flex items-center justify-center">
              <Icon name="XCircle" size={20} className="text-error" />
            </div>
            <div>
              <h2 className="font-heading font-heading-semibold text-lg text-text-primary">
                Cancel Booking
              </h2>
              <p className="font-caption font-caption-normal text-sm text-text-secondary">
                {booking?.service} • {booking?.id}
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

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-96">
          {step === 1 && (
            <div className="space-y-6">
              {/* Booking Details */}
              <div className="p-4 bg-background rounded-spa">
                <h3 className="font-heading font-heading-medium text-base text-text-primary mb-2">
                  Booking to Cancel
                </h3>
                <div className="space-y-1 text-sm">
                  <p className="font-body font-body-normal text-text-secondary">
                    {booking?.date} at {booking?.time}
                  </p>
                  <p className="font-body font-body-normal text-text-secondary">
                    {booking?.branch}
                  </p>
                  <p className="font-body font-body-medium text-text-primary">
                    Total: NPR {booking?.price}
                  </p>
                </div>
              </div>

              {/* Cancellation Reason */}
              <div className="space-y-3">
                <label className="font-body font-body-medium text-sm text-text-primary">
                  Reason for Cancellation
                </label>
                <div className="space-y-2">
                  {cancellationReasons.map((reasonOption) => (
                    <label
                      key={reasonOption}
                      className={`flex items-center space-x-3 p-3 rounded-spa border cursor-pointer spa-transition-fast ${
                        reason === reasonOption
                          ? 'border-primary bg-primary/5' :'border-border hover:border-primary/50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="reason"
                        value={reasonOption}
                        checked={reason === reasonOption}
                        onChange={(e) => setReason(e.target.value)}
                        className="text-primary focus:ring-primary"
                      />
                      <span className="font-body font-body-normal text-sm text-text-primary">
                        {reasonOption}
                      </span>
                    </label>
                  ))}
                </div>
                
                {reason === 'Other' && (
                  <Input
                    type="text"
                    placeholder="Please specify your reason..."
                    className="mt-2"
                  />
                )}
              </div>

              {/* Refund Information */}
              <div className={`p-4 rounded-spa border ${
                refundInfo.percentage > 0 
                  ? 'bg-success/10 border-success/20' :'bg-warning/10 border-warning/20'
              }`}>
                <div className="flex items-center space-x-2 mb-2">
                  <Icon 
                    name={refundInfo.percentage > 0 ? "CheckCircle" : "AlertTriangle"} 
                    size={16} 
                    className={refundInfo.percentage > 0 ? "text-success" : "text-warning"} 
                  />
                  <span className="font-body font-body-medium text-sm text-text-primary">
                    Refund Information
                  </span>
                </div>
                <p className="font-body font-body-normal text-sm text-text-secondary">
                  You will receive {refundInfo.percentage}% refund (NPR {refundInfo.amount})
                </p>
                <p className="font-caption font-caption-normal text-xs text-text-secondary mt-1">
                  Refund will be processed within 3-5 business days
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              {/* Confirmation Warning */}
              <div className="p-4 bg-error/10 border border-error/20 rounded-spa">
                <div className="flex items-start space-x-3">
                  <Icon name="AlertTriangle" size={20} className="text-error mt-0.5" />
                  <div>
                    <h3 className="font-heading font-heading-medium text-base text-error mb-1">
                      Confirm Cancellation
                    </h3>
                    <p className="font-body font-body-normal text-sm text-text-primary">
                      This action cannot be undone. Your booking will be permanently cancelled.
                    </p>
                  </div>
                </div>
              </div>

              {/* Summary */}
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-border">
                  <span className="font-body font-body-normal text-sm text-text-secondary">
                    Booking ID:
                  </span>
                  <span className="font-body font-body-medium text-sm text-text-primary">
                    {booking?.id}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border">
                  <span className="font-body font-body-normal text-sm text-text-secondary">
                    Reason:
                  </span>
                  <span className="font-body font-body-medium text-sm text-text-primary">
                    {reason}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border">
                  <span className="font-body font-body-normal text-sm text-text-secondary">
                    Refund Amount:
                  </span>
                  <span className="font-body font-body-medium text-sm text-success">
                    NPR {refundInfo.amount}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 p-6 border-t border-border">
          {step === 1 && (
            <>
              <Button variant="outline" onClick={onClose}>
                Keep Booking
              </Button>
              <Button 
                variant="primary" 
                onClick={handleNext}
                disabled={!reason}
              >
                Continue
              </Button>
            </>
          )}
          
          {step === 2 && (
            <>
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button 
                variant="danger" 
                onClick={handleConfirm}
                loading={isLoading}
              >
                Confirm Cancellation
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CancellationModal;