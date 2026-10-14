import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import CustomerAutocomplete from '../../../components/ui/CustomerAutocomplete';
import { mergeCustomers } from '../../../services/api';

// This customer is always the canonical/surviving record — the picked
// duplicate's bookings/history get repointed onto this id and the
// duplicate row is removed. Mirrors the existing manual-merge flow
// (branch-manager-dashboard/components/CRM/ManualMergeCustomersPanel.jsx)
// but scoped to "merge someone else into the customer I'm already looking
// at" instead of picking both sides freeform.
const CustomerMergeModal = ({ customer, onClose, onSaved }) => {
  const [query, setQuery] = useState('');
  const [duplicate, setDuplicate] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleMerge = async () => {
    if (!duplicate) return;
    setSubmitting(true);
    setError(null);
    const result = await mergeCustomers(customer.id, duplicate.id);
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message || 'Failed to merge customers.');
      return;
    }
    onSaved?.();
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-modal" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-modal-overlay flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="merge-customer-title">
        <div className="bg-surface rounded-spa-lg border border-border shadow-spa-modal w-full max-w-lg">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 id="merge-customer-title" className="font-heading font-heading-semibold text-base text-text-primary">Merge Customer</h2>
            <button type="button" onClick={onClose} className="p-1.5 rounded-spa hover:bg-background spa-transition-fast">
              <Icon name="X" size={16} className="text-text-secondary" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
                <Icon name="AlertCircle" size={16} />
                <span>{error}</span>
              </div>
            )}

            <div className="rounded-spa border-2 border-primary bg-primary/5 p-3">
              <p className="font-caption text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Keeps this record</p>
              <p className="font-body font-body-medium text-sm text-text-primary">{customer.fullName}</p>
              <p className="font-caption text-xs text-text-secondary mt-0.5">{customer.phone || '—'}</p>
            </div>

            <div className="flex justify-center">
              <Icon name="ArrowDown" size={18} className="text-text-tertiary" />
            </div>

            {duplicate ? (
              <div className="rounded-spa border border-border p-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-caption text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Will be merged in and removed</p>
                  <p className="font-body font-body-medium text-sm text-text-primary truncate">{duplicate.full_name}</p>
                  <p className="font-caption text-xs text-text-secondary mt-0.5">{duplicate.phone || '—'}</p>
                </div>
                <button type="button" onClick={() => setDuplicate(null)} className="flex-shrink-0 text-text-tertiary hover:text-error spa-transition-fast">
                  <Icon name="X" size={16} />
                </button>
              </div>
            ) : (
              <CustomerAutocomplete
                value={query}
                onChange={setQuery}
                onSelect={(c) => { if (c.id !== customer.id) { setDuplicate(c); setQuery(''); } }}
                branchId={customer.branchId}
                searchBy="any"
                placeholder="Search for the duplicate customer…"
              />
            )}

            {duplicate && !confirming && (
              <p className="font-caption text-xs text-text-tertiary">
                This moves {duplicate.full_name}'s bookings, memberships, packages, and vouchers onto {customer.fullName}, then permanently removes the {duplicate.full_name} record. This can't be undone.
              </p>
            )}
          </div>

          <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
            {duplicate && !confirming ? (
              <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>Continue</Button>
            ) : (
              <Button variant="danger" size="sm" onClick={handleMerge} loading={submitting} disabled={!duplicate}>
                Merge Customers
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default CustomerMergeModal;
