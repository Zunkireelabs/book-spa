import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import {
  fetchRewardCatalogForManagement,
  createRewardCatalogItem,
  updateRewardCatalogItem,
  toggleRewardCatalogActive,
  deleteRewardCatalogItem,
} from '../../../../services/api';

const RewardCatalogPanel = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formName, setFormName] = useState('');
  const [formValue, setFormValue] = useState('');
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchRewardCatalogForManagement();
    if (result.error) {
      setError(result.error.message || 'Failed to load reward catalog.');
    } else {
      setItems(result.data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadItems(); }, [loadItems]);

  const handleOpenCreate = () => {
    setEditingItem(null);
    setFormName('');
    setFormValue('');
    setFormError(null);
    setShowModal(true);
  };

  const handleOpenEdit = (item) => {
    setEditingItem(item);
    setFormName(item.name);
    setFormValue(item.value != null ? String(item.value) : '');
    setFormError(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      setFormError('Name is required.');
      return;
    }
    setSaving(true);
    setFormError(null);
    const result = editingItem
      ? await updateRewardCatalogItem({ id: editingItem.id, name: formName.trim(), value: formValue })
      : await createRewardCatalogItem({ rewardType: 'voucher', name: formName.trim(), value: formValue });
    if (result.error) {
      setFormError(result.error.message || 'Operation failed.');
    } else {
      setShowModal(false);
      await loadItems();
    }
    setSaving(false);
  };

  const handleToggleActive = async (item) => {
    const result = await toggleRewardCatalogActive({ id: item.id, isActive: !item.is_active });
    if (result.error) {
      setError(result.error.message || 'Failed to update.');
    } else {
      await loadItems();
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    setError(null);
    const result = await deleteRewardCatalogItem({ id: confirmDelete.id });
    if (result.error) {
      setError(result.error.message || 'Failed to delete.');
    } else {
      await loadItems();
    }
    setConfirmDelete(null);
    setDeleting(false);
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        <p className="text-sm text-text-secondary">Loading reward catalog...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Gift Voucher Catalog</h3>
          <p className="font-body text-sm text-text-secondary">
            Options staff can pick from when logging a customer referral as a Gift Voucher. Wallet rewards
            don't need a catalog entry — staff enter that amount directly.
          </p>
        </div>
        <Button variant="primary" size="sm" iconName="Plus" onClick={handleOpenCreate}>
          Add Gift Voucher
        </Button>
      </div>

      {error && (
        <div className="p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm flex items-center gap-2">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={14} /></button>
        </div>
      )}

      <div className="bg-surface border border-border rounded-spa overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-background border-b border-border">
              <th className="text-left px-4 py-3 text-sm text-text-secondary">Name</th>
              <th className="text-left px-4 py-3 text-sm text-text-secondary">Value</th>
              <th className="text-left px-4 py-3 text-sm text-text-secondary">Status</th>
              <th className="text-right px-4 py-3 text-sm text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-text-secondary text-sm">
                  No gift vouchers added yet.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-b-0 hover:bg-background/50">
                  <td className="px-4 py-3 text-sm font-medium">{item.name}</td>
                  <td className="px-4 py-3 text-sm text-text-secondary">
                    {item.value != null ? `NPR ${Number(item.value).toLocaleString('en-IN')}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleActive(item)}
                      className={`px-2 py-0.5 rounded text-xs ${item.is_active ? 'bg-success/10 text-success' : 'bg-gray-100 text-gray-500'}`}
                    >
                      {item.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => handleOpenEdit(item)} className="p-1 hover:text-primary"><Icon name="Pencil" size={16} /></button>
                      <button onClick={() => setConfirmDelete(item)} className="p-1 hover:text-error"><Icon name="Trash2" size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-surface rounded-spa-lg w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">{editingItem ? 'Edit' : 'Add'} Gift Voucher</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Free Facial Voucher" autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Value (NPR, optional)</label>
                <Input type="number" min="0" value={formValue} onChange={(e) => setFormValue(e.target.value)} placeholder="e.g. 500" />
              </div>
              {formError && <p className="text-sm text-error">{formError}</p>}
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="ghost" onClick={() => setShowModal(false)}>Cancel</Button>
                <Button variant="primary" onClick={handleSave} loading={saving}>Save</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => setConfirmDelete(null)}>
          <div className="bg-surface rounded-spa-lg w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2">Delete "{confirmDelete.name}"?</h3>
            <p className="text-sm text-text-secondary mb-4">This can't be undone. Referrals that already used this reward keep their record.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="danger" onClick={handleDelete} loading={deleting}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RewardCatalogPanel;
