import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import CustomSelect from '../../../../components/ui/CustomSelect';
import { fetchProductBranchStock, fetchProductStockTransfers, transferProductStock } from '../../../../services/api';

function formatDateTime(d) {
  return new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const RECEIVE_SOURCE = 'RECEIVE';

// Moves stock between branches, or receives new stock from outside the
// business (e.g. a supplier delivery — no source branch). Always
// immediate, no approval step, but fully recorded on both sides via
// transfer_product_stock (migration-214) — see StockTransferModal's
// callers for why: confirmed product decision, same audit-trail shape as
// staff transfers elsewhere in this app.
const StockTransferModal = ({ product, onClose, onTransferred }) => {
  const [branchStock, setBranchStock] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const [fromBranchId, setFromBranchId] = useState(RECEIVE_SOURCE);
  const [toBranchId, setToBranchId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [stockResult, historyResult] = await Promise.all([
      fetchProductBranchStock(product.id),
      fetchProductStockTransfers({ productId: product.id, limit: 10 }),
    ]);
    if (!stockResult.error) setBranchStock(stockResult.data || []);
    if (!historyResult.error) setHistory(historyResult.data || []);
    setLoading(false);
  }, [product.id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const branchName = (id) => branchStock.find((b) => b.branchId === id)?.branchName || '—';
  const branchOptions = branchStock.map((b) => ({ value: b.branchId, label: `${b.branchName} (${b.quantity} in stock)` }));
  const fromOptions = [{ value: RECEIVE_SOURCE, label: 'New stock (e.g. supplier delivery)' }, ...branchOptions];
  const toOptions = branchOptions.filter((b) => b.value !== fromBranchId);
  const sourceQuantity = fromBranchId === RECEIVE_SOURCE ? null : branchStock.find((b) => b.branchId === fromBranchId)?.quantity ?? 0;

  const handleSubmit = async () => {
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      setError('Quantity must be a positive number.');
      return;
    }
    if (!toBranchId) {
      setError('Select a destination branch.');
      return;
    }
    if (fromBranchId !== RECEIVE_SOURCE && fromBranchId === toBranchId) {
      setError('Source and destination branch must be different.');
      return;
    }
    if (fromBranchId !== RECEIVE_SOURCE && qty > sourceQuantity) {
      setError(`Only ${sourceQuantity} available at ${branchName(fromBranchId)}.`);
      return;
    }

    setSaving(true);
    setError(null);

    const result = await transferProductStock({
      productId: product.id,
      toBranchId,
      quantity: qty,
      fromBranchId: fromBranchId === RECEIVE_SOURCE ? null : fromBranchId,
      note: note.trim() || null,
    });

    if (result.error) {
      setError(result.error.message || 'Transfer failed.');
      setSaving(false);
    } else {
      onTransferred();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-md max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Receive / Transfer Stock</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-background">
            <Icon name="X" size={20} className="text-text-secondary" />
          </button>
        </div>

        <div className="p-3 bg-background rounded-spa border border-border">
          <p className="font-body font-body-medium text-sm text-text-primary">{product.name}</p>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
            <Icon name="AlertCircle" size={16} />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <p className="font-caption text-xs font-medium uppercase tracking-wide text-text-secondary">Current stock by branch</p>
              <div className="space-y-1">
                {branchStock.map((b) => (
                  <div key={b.branchId} className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary">{b.branchName}</span>
                    <span className={`font-data ${b.quantity === 0 ? 'text-text-tertiary' : 'text-text-primary'}`}>{b.quantity}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">From</label>
                <CustomSelect
                  value={fromBranchId}
                  onChange={(val) => { setFromBranchId(val); if (val === toBranchId) setToBranchId(''); }}
                  options={fromOptions}
                />
              </div>

              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">To</label>
                <CustomSelect
                  value={toBranchId}
                  onChange={setToBranchId}
                  options={toOptions}
                  placeholder="Select destination branch"
                />
              </div>

              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">Quantity</label>
                <Input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  min="1"
                  max={fromBranchId !== RECEIVE_SOURCE ? sourceQuantity : undefined}
                />
              </div>

              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">
                  Note <span className="text-text-tertiary font-normal">(optional)</span>
                </label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Supplier invoice #1234" />
              </div>
            </div>

            {history.length > 0 && (
              <button
                type="button"
                onClick={() => setShowHistory(true)}
                className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary spa-transition-fast"
              >
                <Icon name="History" size={14} />
                View recent activity ({history.length})
              </button>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} loading={saving} disabled={loading}>
            Confirm
          </Button>
        </div>
      </div>

      {showHistory && createPortal(
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setShowHistory(false); }}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-sm max-h-[80vh] overflow-y-auto p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h4 className="font-heading font-heading-semibold text-base text-text-primary">Recent Activity</h4>
              <button onClick={() => setShowHistory(false)} className="p-1 rounded hover:bg-background">
                <Icon name="X" size={18} className="text-text-secondary" />
              </button>
            </div>
            <div className="space-y-2">
              {history.map((t) => (
                <div key={t.id} className="text-xs text-text-secondary flex items-center justify-between gap-2">
                  <span className="truncate">
                    {t.from_branch_id ? branchName(t.from_branch_id) : 'New stock'} → {branchName(t.to_branch_id)}
                  </span>
                  <span className="font-data text-text-primary shrink-0">+{t.quantity}</span>
                  <span className="shrink-0 text-text-tertiary">{formatDateTime(t.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>,
    document.body
  );
};

export default StockTransferModal;
