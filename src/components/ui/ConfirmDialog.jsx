import React, { useState } from 'react';
import Icon from '../AppIcon';
import Button from './Button';
import CustomSelect from './CustomSelect';
import ModalShell from './ModalShell';

export const CANCEL_REASON_OPTIONS = [
  { value: 'not-specified', label: "Didn't specify" },
  { value: 'busy-schedule', label: 'Busy schedule' },
  { value: 'no-show', label: 'No Show' },
  { value: 'booking-error', label: 'Bookings made in error' },
  { value: 'others', label: 'Others' },
];

const ConfirmDialog = ({
  title,
  message,
  confirmLabel = 'Confirm',
  reasonOptions,
  onConfirm,
  onClose,
  isSubmitting = false,
  requireReason = true, // false: a plain confirm (no reason field), e.g. deleting a product
  reasonOptional = false, // true: shows a "Reason (optional)" field that never blocks confirm (wins over requireReason)
  error = null, // message shown inside the dialog, above the buttons (the dialog stays open on error)
  reasonLabel = 'Reason', // label of the optional field (reasonOptional only), e.g. 'Note'
  reasonPlaceholder = 'e.g. Customer changed their mind',
  cancelLabel = 'Back',
  confirmVariant = 'danger', // 'danger' | 'primary' (a save prompt is not destructive)
  tone = 'danger', // 'danger' | 'warning': header icon colour (warning = a permitted override, not a destructive action)
  secondaryLabel = null, // optional middle button, e.g. 'Discard'
  onSecondary = null,
}) => {
  const [reason, setReason] = useState('');
  const trimmedReason = reason.trim();

  const [selectedReason, setSelectedReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const trimmedCustomReason = customReason.trim();
  const isOthers = selectedReason === 'others';

  const canConfirm = reasonOptional || !requireReason ? true : reasonOptions
    ? Boolean(selectedReason) && (!isOthers || trimmedCustomReason.length > 0)
    : Boolean(trimmedReason);

  const handleConfirm = () => {
    if (reasonOptional) { onConfirm(trimmedReason); return; }
    if (!requireReason) { onConfirm(''); return; }
    if (!reasonOptions) {
      onConfirm(trimmedReason);
      return;
    }
    const selectedOption = reasonOptions.find((opt) => opt.value === selectedReason);
    onConfirm(isOthers ? trimmedCustomReason : selectedOption?.label || '');
  };

  return (
    <ModalShell onClose={isSubmitting ? undefined : onClose}>
      <div>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center space-x-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${tone === 'warning' ? 'bg-warning/10' : 'bg-error/10'}`}>
              <Icon name="AlertTriangle" size={20} className={tone === 'warning' ? 'text-warning' : 'text-error'} />
            </div>
            <h2 className="font-heading font-heading-semibold text-lg text-text-primary">
              {title}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-2 rounded-spa hover:bg-background spa-transition-fast spa-touch-target"
          >
            <Icon name="X" size={20} className="text-text-secondary" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="font-body font-body-normal text-sm text-text-secondary">
            {message}
          </p>
          {reasonOptional ? (
            <div>
              <label htmlFor="confirm-reason-optional" className="block font-body font-body-medium text-sm text-text-primary mb-1.5">
                {reasonLabel} <span className="text-text-tertiary font-normal">(optional)</span>
              </label>
              <input
                id="confirm-reason-optional"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={reasonPlaceholder}
                className="w-full h-10 px-3 border border-border rounded-spa font-body font-body-normal text-sm text-text-primary bg-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
                disabled={isSubmitting}
                autoFocus
              />
            </div>
          ) : !requireReason ? null : reasonOptions ? (
            <div className="space-y-4">
              <div>
                <label className="block font-body font-body-medium text-sm text-text-primary mb-1.5">
                  Reason <span className="text-error">*</span>
                </label>
                <CustomSelect
                  value={selectedReason}
                  onChange={setSelectedReason}
                  options={reasonOptions}
                  placeholder="Select a reason..."
                  disabled={isSubmitting}
                />
              </div>
              {isOthers && (
                <div>
                  <label className="block font-body font-body-medium text-sm text-text-primary mb-1.5">
                    Custom reason <span className="text-error">*</span>
                  </label>
                  <textarea
                    value={customReason}
                    onChange={(e) => setCustomReason(e.target.value)}
                    rows={3}
                    placeholder="Explain why..."
                    className="w-full px-3 py-2 border border-border rounded-spa font-body font-body-normal text-sm text-text-primary bg-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
                    disabled={isSubmitting}
                    autoFocus
                  />
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="block font-body font-body-medium text-sm text-text-primary mb-1.5">
                Reason <span className="text-error">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Explain why..."
                className="w-full px-3 py-2 border border-border rounded-spa font-body font-body-normal text-sm text-text-primary bg-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
                disabled={isSubmitting}
                autoFocus
              />
            </div>
          )}
          {error && (
            <div role="alert" className="flex items-start gap-2 bg-error/5 border border-error/20 rounded-spa p-3">
              <Icon name="AlertCircle" size={16} className="text-error flex-shrink-0 mt-0.5" />
              <p className="font-body text-sm text-error">{error}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end space-x-3 p-5 border-t border-border">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            {cancelLabel}
          </Button>
          {secondaryLabel && onSecondary && (
            <Button variant="outline" onClick={onSecondary} disabled={isSubmitting}>
              {secondaryLabel}
            </Button>
          )}
          <Button
            variant={confirmVariant}
            onClick={handleConfirm}
            disabled={isSubmitting || !canConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
};

export default ConfirmDialog;
