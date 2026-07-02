import React, { useState } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
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
};

const PaymentMethodsPanel = () => {
  const { paymentMethods, refreshOrg } = useOrg();
  const [showModal, setShowModal] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [name, setName] = useState('');
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  const handleOpenCreate = () => {
    setEditingIndex(null);
    setName('');
    setFormError(null);
    setShowModal(true);
  };

  const handleOpenEdit = (index) => {
    setEditingIndex(index);
    setName(paymentMethods[index]);
    setFormError(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError('Payment method name is required.');
      return;
    }
    if (trimmed.length > 40) {
      setFormError('Payment method name must be 40 characters or fewer.');
      return;
    }
    const duplicate = paymentMethods.some(
      (m, i) => m.toLowerCase() === trimmed.toLowerCase() && i !== editingIndex
    );
    if (duplicate) {
      setFormError('A payment method with this name already exists.');
      return;
    }

    const nextMethods = [...paymentMethods];
    if (editingIndex === null) {
      nextMethods.push(trimmed);
    } else {
      nextMethods[editingIndex] = trimmed;
    }

    setSaving(true);
    setFormError(null);
    const result = await updateOrgPaymentMethods(nextMethods);
    if (result.error) {
      setFormError(result.error.message || 'Save failed.');
    } else {
      setShowModal(false);
      await refreshOrg();
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (confirmDelete === null) return;
    setDeleting(true);
    setError(null);

    const nextMethods = paymentMethods.filter((_, i) => i !== confirmDelete);
    const result = await updateOrgPaymentMethods(nextMethods);
    if (result.error) {
      setError(result.error.message || 'Delete failed.');
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
        <Button variant="primary" size="sm" iconName="Plus" iconSize={16} onClick={handleOpenCreate}>
          Add Payment Method
        </Button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={14} /></button>
        </div>
      )}

      {/* List */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {paymentMethods.map((method, index) => (
          <div
            key={`${method}-${index}`}
            className="bg-surface border border-border rounded-spa p-4 flex items-center gap-3"
          >
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Icon name={METHOD_ICONS[method] || 'CreditCard'} size={20} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-body font-body-medium text-sm text-text-primary truncate">
                {humanizePaymentMethod(method)}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => handleOpenEdit(index)}
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
        ))}
      </div>

      {paymentMethods.length <= 1 && (
        <p className="font-caption text-xs text-text-secondary">
          At least one payment method must remain configured.
        </p>
      )}

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
                {editingIndex === null ? 'Add Payment Method' : 'Edit Payment Method'}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-background">
                <Icon name="X" size={20} className="text-text-secondary" />
              </button>
            </div>

            {formError && (
              <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
                <Icon name="AlertCircle" size={16} />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="block font-body font-body-medium text-sm text-text-primary">Method Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Bank Transfer"
                maxLength={40}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>
                {editingIndex === null ? 'Add Method' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {confirmDelete !== null && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                <Icon name="Trash2" size={20} className="text-error" />
              </div>
              <div>
                <h3 className="font-heading font-heading-semibold text-text-primary">Delete Payment Method?</h3>
                <p className="font-body text-sm text-text-secondary">
                  "{humanizePaymentMethod(paymentMethods[confirmDelete])}" will no longer be offered when recording payments.
                  Past payments already recorded with this method are unaffected.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)} disabled={deleting}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={handleDelete} loading={deleting}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentMethodsPanel;
