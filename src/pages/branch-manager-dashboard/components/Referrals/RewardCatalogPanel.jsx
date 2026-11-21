import React, { useState, useEffect, useCallback, useRef } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import ConfirmDialog from '../../../../components/ui/ConfirmDialog';
import { useFlashRow, rowTone, rowBar } from '../../../../components/ui/PanelFormKit';
import RewardFormPanel from './RewardFormPanel';
import { friendlyError } from '../../../../utils/friendlyError';
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
  const [panel, setPanel] = useState(null); // { item? } while the New / Edit panel is open
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [flashId, flash] = useFlashRow();

  const hasLoadedRef = useRef(false);
  const loadItems = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true);
    setError(null);
    const result = await fetchRewardCatalogForManagement();
    if (result.error) {
      setError(friendlyError(result.error, 'Failed to load reward catalog.'));
    } else {
      setItems(result.data || []);
    }
    hasLoadedRef.current = true;
    setLoading(false);
  }, []);

  useEffect(() => { loadItems(); }, [loadItems]);

  const handleToggleActive = async (item) => {
    const result = await toggleRewardCatalogActive({ id: item.id, isActive: !item.is_active });
    if (result.error) {
      setError(friendlyError(result.error, 'Failed to update.'));
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
      setError(friendlyError(result.error, 'Failed to delete.'));
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
        <Button variant="primary" size="sm" iconName="Plus" onClick={() => setPanel({})}>
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
                  No gift vouchers yet. <button type="button" onClick={() => setPanel({})} className="text-primary font-body-medium hover:underline">Add the first gift voucher</button>
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} aria-selected={panel?.item?.id === item.id || undefined} className={`border-b border-border last:border-b-0 ${rowTone(panel?.item?.id === item.id, flashId === item.id)}`}>
                  <td className={`px-4 py-3 text-sm font-medium ${rowBar(panel?.item?.id === item.id || flashId === item.id)}`}>{item.name}</td>
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
                      <button onClick={() => setPanel({ item })} aria-label="Edit" title="Edit" className="p-1 hover:text-primary"><Icon name="Pencil" size={16} /></button>
                      <button onClick={() => setConfirmDelete(item)} aria-label="Delete" title="Delete" className="p-1 hover:text-error"><Icon name="Trash2" size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${confirmDelete.name}"?`}
          message="This can't be undone. Referrals that already used this reward keep their record."
          confirmLabel="Delete"
          requireReason={false}
          isSubmitting={deleting}
          onConfirm={handleDelete}
          onClose={() => !deleting && setConfirmDelete(null)}
        />
      )}

      {panel && (
        <RewardFormPanel
          item={panel.item}
          onClose={() => setPanel(null)}
          onSaved={(id, isNew) => { setPanel(null); loadItems(); if (isNew && id) flash(id); }}
        />
      )}
    </div>
  );
};

export default RewardCatalogPanel;
