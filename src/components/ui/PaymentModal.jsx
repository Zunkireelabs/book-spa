import React, { useState } from 'react';
import Icon from '../AppIcon';
import Button from './Button';
import Select from './Select';

const PAYMENT_MODES = [
  { value: 'Cash', label: 'Cash' },
  { value: 'Card', label: 'Card' },
  { value: 'MobileBanking', label: 'Mobile Banking' },
  { value: 'Cheque', label: 'Cheque' },
  { value: 'Esewa', label: 'Esewa' },
  { value: 'Khalti', label: 'Khalti' },
];

function formatNPR(amount) {
  return `NPR ${Number(amount).toLocaleString('en-IN')}`;
}

const PaymentModal = ({ booking, onConfirm, onClose, isSubmitting }) => {
  const [paymentMode, setPaymentMode] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);

  const baseAmount = Number(booking.base_amount || 0);
  const discountAmount = Number(booking.discount_amount || 0);
  const finalAmount = Number(booking.final_amount || 0);

  const handleSubmit = async () => {
    if (!paymentMode) {
      setError('Please select a payment mode.');
      return;
    }
    setError(null);

    const result = await onConfirm({ paymentMode, notes });

    if (result?.error) {
      setError(result.error.message || 'Failed to record payment.');
    }
  };

  return (
    <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal-overlay flex items-center justify-center p-4">
      <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-md animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-success/10 rounded-lg flex items-center justify-center">
              <Icon name="CreditCard" size={20} className="text-success" />
            </div>
            <div>
              <h2 className="font-heading font-heading-semibold text-lg text-text-primary">
                Record Payment
              </h2>
              <p className="font-caption font-caption-normal text-sm text-text-secondary">
                {booking.booking_number || booking.id}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-2 rounded-spa hover:bg-background spa-transition-fast spa-touch-target"
          >
            <Icon name="X" size={20} className="text-text-secondary" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* Financial Summary (read-only) */}
          <div className="bg-background rounded-spa p-4 space-y-3">
            <h4 className="font-heading font-heading-medium text-sm text-text-secondary uppercase tracking-wider">
              Payment Summary
            </h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-body font-body-normal text-sm text-text-secondary">
                  Base Amount
                </span>
                <span className="font-body font-body-medium text-sm text-text-primary">
                  {formatNPR(baseAmount)}
                </span>
              </div>
              {discountAmount > 0 && (
                <div className="flex items-center justify-between">
                  <span className="font-body font-body-normal text-sm text-text-secondary">
                    Discount
                  </span>
                  <span className="font-body font-body-medium text-sm text-error">
                    - {formatNPR(discountAmount)}
                  </span>
                </div>
              )}
              <div className="border-t border-border pt-2 flex items-center justify-between">
                <span className="font-body font-body-semibold text-base text-text-primary">
                  Total Due
                </span>
                <span className="font-heading font-heading-semibold text-lg text-success">
                  {formatNPR(finalAmount)}
                </span>
              </div>
            </div>
          </div>

          {/* Payment Mode */}
          <Select
            label="Payment Mode"
            options={PAYMENT_MODES}
            value={paymentMode}
            onChange={setPaymentMode}
            placeholder="Select payment mode..."
          />

          {/* Notes */}
          <div className="space-y-1">
            <label className="block font-body font-body-medium text-sm text-text-primary">
              Notes <span className="text-text-secondary font-body-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes about this payment..."
              rows={3}
              className="w-full rounded-spa border border-border bg-surface px-3 py-2 font-body font-body-normal text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary spa-transition-fast resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start space-x-2 p-3 bg-error/5 border border-error/20 rounded-spa">
              <Icon name="AlertCircle" size={16} className="text-error mt-0.5 shrink-0" />
              <p className="font-body font-body-normal text-sm text-error">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 p-5 border-t border-border">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            variant="success"
            onClick={handleSubmit}
            loading={isSubmitting}
            disabled={!paymentMode}
            iconName="Check"
            iconPosition="left"
          >
            Confirm Payment
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PaymentModal;
