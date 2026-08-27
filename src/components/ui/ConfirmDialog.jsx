import React, { useState } from 'react';
import Icon from '../AppIcon';
import Button from './Button';

const ConfirmDialog = ({
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onClose,
  isSubmitting = false,
}) => {
  const [reason, setReason] = useState('');
  const trimmedReason = reason.trim();

  return (
    <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal-overlay flex items-center justify-center p-4">
      <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-md animate-fade-in">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-error/10 rounded-lg flex items-center justify-center">
              <Icon name="AlertTriangle" size={20} className="text-error" />
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
        </div>

        <div className="flex items-center justify-end space-x-3 p-5 border-t border-border">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Back
          </Button>
          <Button
            variant="danger"
            onClick={() => onConfirm(trimmedReason)}
            disabled={isSubmitting || !trimmedReason}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
