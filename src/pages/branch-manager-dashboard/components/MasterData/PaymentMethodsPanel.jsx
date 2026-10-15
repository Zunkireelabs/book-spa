import React, { useState } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import ConfirmDialog from '../../../../components/ui/ConfirmDialog';
import { useFlashRow } from '../../../../components/ui/PanelFormKit';
import PaymentMethodFormPanel from './PaymentMethodFormPanel';
import { friendlyError } from '../../../../utils/friendlyError';
import { useOrg } from '../../../../contexts/OrgContext';
import { updateOrgPaymentMethods } from '../../../../services/api';
import { humanizePaymentMethod } from '../../../../services/paymentMethods';

const METHOD_ICONS = {
  Cash: 'Banknote',
  Card: 'CreditCard',
  MobileBanking: 'Smartphone',
  Cheque: 'FileText',
  Esewa: 'Wallet',
  Khalti: 'Wallet',
  'Digital Wallet': 'Wallet',
};

// A method entry is either a plain string (leaf) or { name, subMethods } (a group).
const entryName = (m) => (typeof m === 'string' ? m : m.name);
const entrySubMethods = (m) => (typeof m === 'string' ? [] : m.subMethods || []);

const PaymentMethodsPanel = () => {
  const { paymentMethods, refreshOrg } = useOrg();
  const [panel, setPanel] = useState(null); // { index? } while the New / Edit panel is open
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [flashName, flash] = useFlashRow();

  const toggleExpanded = (index) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleDelete = async () => {
    if (confirmDelete === null) return;
    setDeleting(true);
    setError(null);

    const nextMethods = paymentMethods.filter((_, i) => i !== confirmDelete);
    const result = await updateOrgPaymentMethods(nextMethods);
    if (result.error) {
      setError(friendlyError(result.error, 'Delete failed.'));
    } else {
      await refreshOrg();
    }

    setConfirmDelete(null);
    setDeleting(false);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Payment Methods</h3>
          <p className="font-body text-sm text-text-secondary">
            {paymentMethods.length} method{paymentMethods.length !== 1 ? 's' : ''} configured — offered when recording booking payments
          </p>
        </div>
        <Button variant="primary" size="sm" iconName="Plus" iconSize={16} onClick={() => setPanel({})}>
          Add Payment Method
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={14} /></button>
        </div>
      )}

      {paymentMethods.length === 0 && (
        <div className="bg-surface border border-border rounded-spa py-10 text-center text-sm text-text-secondary">
          No payment methods yet. <button type="button" onClick={() => setPanel({})} className="text-primary font-body-medium hover:underline">Add the first payment method</button>
        </div>
      )}

      {/* List */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
        {paymentMethods.map((method, index) => {
          const label = entryName(method);
          const subs = entrySubMethods(method);
          const isExpanded = expanded.has(index);
          const selected = panel?.index === index;
          const flashing = flashName === label;
          return (
            <div
              key={`${label}-${index}`}
              aria-selected={selected || undefined}
              className={`border rounded-spa overflow-hidden transition-colors duration-700 ${flashing ? 'bg-primary/[0.12] border-primary/40' : selected ? 'bg-primary/[0.04] border-primary/40' : 'bg-surface border-border'}`}
            >
              <div className="flex items-center gap-3 p-4">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon name={METHOD_ICONS[label] || 'CreditCard'} size={20} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-body font-body-medium text-sm text-text-primary truncate">
                    {humanizePaymentMethod(label)}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {subs.length > 0 && (
                    <button
                      onClick={() => toggleExpanded(index)}
                      className="p-1.5 rounded hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
                      title={isExpanded ? 'Collapse sub-options' : 'Show sub-options'}
                    >
                      <Icon name={isExpanded ? 'ChevronUp' : 'ChevronDown'} size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => setPanel({ index })}
                    className="p-1.5 rounded hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
                    title="Edit"
                  >
                    <Icon name="Pencil" size={16} />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(index)}
                    className="p-1.5 rounded hover:bg-error/10 spa-transition-fast text-text-secondary hover:text-error"
                    title="Delete"
                    disabled={paymentMethods.length <= 1}
                  >
                    <Icon name="Trash2" size={16} className={paymentMethods.length <= 1 ? 'opacity-30' : ''} />
                  </button>
                </div>
              </div>
              {subs.length > 0 && isExpanded && (
                <div className="px-4 pb-4 border-t border-border pt-3 flex flex-wrap gap-1.5">
                  {subs.map((sub) => (
                    <span key={sub} className="inline-flex items-center px-2 py-1 rounded text-xs bg-background border border-border text-text-primary">{sub}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {paymentMethods.length === 1 && (
        <p className="font-caption text-xs text-text-secondary">
          At least one payment method must remain configured.
        </p>
      )}

      {confirmDelete !== null && paymentMethods[confirmDelete] !== undefined && (
        <ConfirmDialog
          title="Delete payment method?"
          message={`"${humanizePaymentMethod(entryName(paymentMethods[confirmDelete]))}"${entrySubMethods(paymentMethods[confirmDelete]).length > 0 ? ' and its sub-options' : ''} will no longer be offered when recording payments. Past payments already recorded with this method are unaffected.`}
          confirmLabel="Delete"
          requireReason={false}
          isSubmitting={deleting}
          onConfirm={handleDelete}
          onClose={() => !deleting && setConfirmDelete(null)}
        />
      )}

      {panel && (
        <PaymentMethodFormPanel
          methods={paymentMethods}
          index={panel.index ?? null}
          onClose={() => setPanel(null)}
          onSaved={async (name, isNew) => { setPanel(null); await refreshOrg(); if (isNew) flash(name); }}
        />
      )}
    </div>
  );
};

export default PaymentMethodsPanel;
