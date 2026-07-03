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
  'Digital Wallet': 'Wallet',
};

// A method entry is either a plain string (leaf) or { name, subMethods } (a group).
const entryName = (m) => (typeof m === 'string' ? m : m.name);
const entrySubMethods = (m) => (typeof m === 'string' ? [] : m.subMethods || []);

const PaymentMethodsPanel = () => {
  const { paymentMethods, refreshOrg } = useOrg();
  const [showModal, setShowModal] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [name, setName] = useState('');
  const [subMethods, setSubMethods] = useState([]);
  const [subInput, setSubInput] = useState('');
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [editingSub, setEditingSub] = useState(null); // { parentIndex, subIndex }
  const [subEditName, setSubEditName] = useState('');
  const [subEditError, setSubEditError] = useState(null);
  const [subSaving, setSubSaving] = useState(false);
  const [confirmDeleteSub, setConfirmDeleteSub] = useState(null); // { parentIndex, subIndex }
  const [deletingSub, setDeletingSub] = useState(false);

  const toggleExpanded = (index) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleOpenCreate = () => {
    setEditingIndex(null);
    setName('');
    setSubMethods([]);
    setSubInput('');
    setFormError(null);
    setShowModal(true);
  };

  const handleOpenEdit = (index) => {
    setEditingIndex(index);
    setName(entryName(paymentMethods[index]));
    setSubMethods(entrySubMethods(paymentMethods[index]));
    setSubInput('');
    setFormError(null);
    setShowModal(true);
  };

  const handleAddSub = () => {
    const trimmed = subInput.trim();
    if (!trimmed) return;
    if (trimmed.length > 40) {
      setFormError('Sub-option name must be 40 characters or fewer.');
      return;
    }
    if (subMethods.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      setFormError('That sub-option is already added.');
      return;
    }
    setSubMethods((prev) => [...prev, trimmed]);
    setSubInput('');
    setFormError(null);
  };

  const handleRemoveSub = (index) => {
    setSubMethods((prev) => prev.filter((_, i) => i !== index));
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
      (m, i) => entryName(m).toLowerCase() === trimmed.toLowerCase() && i !== editingIndex
    );
    if (duplicate) {
      setFormError('A payment method with this name already exists.');
      return;
    }

    const nextEntry = subMethods.length > 0 ? { name: trimmed, subMethods } : trimmed;
    const nextMethods = [...paymentMethods];
    if (editingIndex === null) {
      nextMethods.push(nextEntry);
    } else {
      nextMethods[editingIndex] = nextEntry;
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

  const handleOpenEditSub = (parentIndex, subIndex) => {
    const subs = entrySubMethods(paymentMethods[parentIndex]);
    setEditingSub({ parentIndex, subIndex });
    setSubEditName(subs[subIndex]);
    setSubEditError(null);
  };

  const handleSaveSub = async () => {
    if (!editingSub) return;
    const { parentIndex, subIndex } = editingSub;
    const trimmed = subEditName.trim();
    if (!trimmed) {
      setSubEditError('Sub-option name is required.');
      return;
    }
    if (trimmed.length > 40) {
      setSubEditError('Sub-option name must be 40 characters or fewer.');
      return;
    }
    const subs = entrySubMethods(paymentMethods[parentIndex]);
    const duplicate = subs.some((s, i) => i !== subIndex && s.toLowerCase() === trimmed.toLowerCase());
    if (duplicate) {
      setSubEditError('That sub-option already exists.');
      return;
    }

    const nextSubs = [...subs];
    nextSubs[subIndex] = trimmed;
    const nextMethods = [...paymentMethods];
    nextMethods[parentIndex] = { name: entryName(paymentMethods[parentIndex]), subMethods: nextSubs };

    setSubSaving(true);
    setSubEditError(null);
    const result = await updateOrgPaymentMethods(nextMethods);
    if (result.error) {
      setSubEditError(result.error.message || 'Save failed.');
    } else {
      setEditingSub(null);
      await refreshOrg();
    }
    setSubSaving(false);
  };

  const handleDeleteSub = async () => {
    if (!confirmDeleteSub) return;
    const { parentIndex, subIndex } = confirmDeleteSub;
    setDeletingSub(true);
    setError(null);

    const subs = entrySubMethods(paymentMethods[parentIndex]);
    const nextSubs = subs.filter((_, i) => i !== subIndex);
    const parentName = entryName(paymentMethods[parentIndex]);
    const nextMethods = [...paymentMethods];
    nextMethods[parentIndex] = nextSubs.length > 0 ? { name: parentName, subMethods: nextSubs } : parentName;

    const result = await updateOrgPaymentMethods(nextMethods);
    if (result.error) {
      setError(result.error.message || 'Delete failed.');
    } else {
      await refreshOrg();
    }

    setConfirmDeleteSub(null);
    setDeletingSub(false);
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
        {paymentMethods.map((method, index) => {
          const label = entryName(method);
          const subs = entrySubMethods(method);
          const isExpanded = expanded.has(index);
          return (
            <div
              key={`${label}-${index}`}
              className="bg-surface border border-border rounded-spa overflow-hidden"
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
              {subs.length > 0 && isExpanded && (
                <div className="px-4 pb-4 border-t border-border pt-3 space-y-2">
                  {subs.map((sub, subIndex) => (
                    <div
                      key={sub}
                      className="flex items-center justify-between gap-2 pl-3 pr-1.5 py-2 rounded-spa border border-border bg-background"
                    >
                      <span className="font-body text-sm text-text-primary truncate">{sub}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleOpenEditSub(index, subIndex)}
                          className="p-1.5 rounded hover:bg-surface spa-transition-fast text-text-secondary hover:text-text-primary"
                          title="Edit"
                        >
                          <Icon name="Pencil" size={14} />
                        </button>
                        <button
                          onClick={() => setConfirmDeleteSub({ parentIndex: index, subIndex })}
                          className="p-1.5 rounded hover:bg-error/10 spa-transition-fast text-text-secondary hover:text-error"
                          title="Delete"
                        >
                          <Icon name="Trash2" size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
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

            <div className="space-y-1.5">
              <label className="block font-body font-body-medium text-sm text-text-primary">
                Sub-options <span className="text-text-secondary font-body-normal">(optional)</span>
              </label>
              <p className="font-caption text-xs text-text-secondary">
                e.g. Mastercard under Card. Once you add sub-options, only they (not the generic
                "{name.trim() || 'method'}") are offered when recording a payment.
              </p>
              {subMethods.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {subMethods.map((sub, i) => (
                    <span
                      key={sub}
                      className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded text-xs font-caption bg-primary/5 text-text-primary border border-border"
                    >
                      {sub}
                      <button
                        type="button"
                        onClick={() => handleRemoveSub(i)}
                        className="p-0.5 rounded hover:bg-error/10 hover:text-error spa-transition-fast"
                      >
                        <Icon name="X" size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  value={subInput}
                  onChange={(e) => setSubInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); handleAddSub(); }
                  }}
                  placeholder="e.g. Mastercard"
                  maxLength={40}
                />
                <Button variant="outline" size="sm" onClick={handleAddSub}>Add</Button>
              </div>
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
                  "{humanizePaymentMethod(entryName(paymentMethods[confirmDelete]))}"
                  {entrySubMethods(paymentMethods[confirmDelete]).length > 0 && ' and its sub-options'} will no longer be offered when recording payments.
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

      {/* Edit Sub-option Modal */}
      {editingSub && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => !subSaving && setEditingSub(null)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Edit Sub-option</h3>
              <button onClick={() => setEditingSub(null)} className="p-1 rounded hover:bg-background">
                <Icon name="X" size={20} className="text-text-secondary" />
              </button>
            </div>

            {subEditError && (
              <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
                <Icon name="AlertCircle" size={16} />
                <span>{subEditError}</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="block font-body font-body-medium text-sm text-text-primary">Sub-option Name</label>
              <Input
                value={subEditName}
                onChange={(e) => setSubEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleSaveSub(); }
                }}
                placeholder="e.g. Mastercard"
                maxLength={40}
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setEditingSub(null)} disabled={subSaving}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleSaveSub} loading={subSaving}>Save Changes</Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Sub-option Confirmation Dialog */}
      {confirmDeleteSub && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => !deletingSub && setConfirmDeleteSub(null)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                <Icon name="Trash2" size={20} className="text-error" />
              </div>
              <div>
                <h3 className="font-heading font-heading-semibold text-text-primary">Delete Sub-option?</h3>
                <p className="font-body text-sm text-text-secondary">
                  "{entrySubMethods(paymentMethods[confirmDeleteSub.parentIndex])[confirmDeleteSub.subIndex]}" will
                  no longer be offered when recording payments. Past payments already recorded with it are unaffected.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteSub(null)} disabled={deletingSub}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={handleDeleteSub} loading={deletingSub}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentMethodsPanel;
