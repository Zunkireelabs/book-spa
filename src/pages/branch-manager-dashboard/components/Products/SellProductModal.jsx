import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import CustomerAutocomplete from '../../../../components/ui/CustomerAutocomplete';
import PaymentMethodSelector from '../../../../components/ui/PaymentMethodSelector';
import { useBranch } from '../../../../contexts/BranchContext';
import { useOrg } from '../../../../contexts/OrgContext';
import { sellProduct } from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount).toLocaleString('en-IN')}`;
}

// Sells one product — its own standalone transaction record (see
// migration-189/190), not a line item on a booking. Mirrors
// NewVoucherModal.jsx's shape, trimmed to a single payment tender (no
// split-tender for v1, matching the "simple first" decision).
const SellProductModal = ({ product, onClose, onSold }) => {
  const { branchId } = useBranch();
  const { paymentMethods } = useOrg();

  const [quantity, setQuantity] = useState('1');
  const [paymentMode, setPaymentMode] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerId, setCustomerId] = useState(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const qty = Number(quantity) || 0;
  const total = qty * Number(product.price_npr);

  const handleSubmit = async () => {
    if (!qty || qty <= 0) {
      setError('Quantity must be a positive number.');
      return;
    }
    if (product.track_stock && qty > product.stock_quantity) {
      setError(`Only ${product.stock_quantity} in stock.`);
      return;
    }
    if (!paymentMode) {
      setError('Select a payment method.');
      return;
    }
    if (!branchId) {
      setError('No branch selected — switch out of the "Overall" view to sell a product.');
      return;
    }

    setSaving(true);
    setError(null);

    const result = await sellProduct({
      productId: product.id,
      quantity: qty,
      paymentMode,
      branchId,
      customerId,
      notes: notes.trim() || null,
    });

    if (result.error) {
      setError(result.error.message || 'Sale failed.');
      setSaving(false);
    } else {
      onSold();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-md max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Sell Product</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-background">
            <Icon name="X" size={20} className="text-text-secondary" />
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
            <Icon name="AlertCircle" size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-3">
          <div className="p-3 bg-background rounded-spa border border-border">
            <p className="font-body font-body-medium text-sm text-text-primary">{product.name}</p>
            <p className="font-data text-xs text-text-secondary mt-0.5">
              {formatNPR(product.price_npr)} each
              {product.track_stock && (
                <span className={`ml-2 ${product.stock_quantity === 0 ? 'text-error' : ''}`}>
                  · {product.stock_quantity} in stock
                </span>
              )}
            </p>
          </div>

          <div className="space-y-1">
            <label className="block font-body font-body-medium text-sm text-text-primary">Quantity</label>
            <Input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              min="1"
              max={product.track_stock ? product.stock_quantity : undefined}
            />
          </div>

          <div className="space-y-1">
            <label className="block font-body font-body-medium text-sm text-text-primary">Payment Method</label>
            <PaymentMethodSelector
              value={paymentMode}
              onChange={setPaymentMode}
              paymentMethods={paymentMethods}
              placeholder="Select payment method"
            />
          </div>

          <div className="space-y-1">
            <label className="block font-body font-body-medium text-sm text-text-primary">
              Customer <span className="text-text-tertiary font-normal">(optional — leave blank for a walk-in sale)</span>
            </label>
            <CustomerAutocomplete
              value={customerName}
              onChange={(val) => {
                setCustomerName(val);
                setCustomerId(null);
              }}
              onSelect={(customer) => {
                setCustomerName(customer.full_name);
                setCustomerId(customer.id);
              }}
              branchId={branchId}
              searchBy="name"
              placeholder="Search by name (optional)"
            />
          </div>

          <div className="space-y-1">
            <label className="block font-body font-body-medium text-sm text-text-primary">
              Notes <span className="text-text-tertiary font-normal">(optional)</span>
            </label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
            />
          </div>

          <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-spa">
            <span className="font-body font-body-medium text-sm text-text-primary">Total</span>
            <span className="font-data text-lg text-primary">{formatNPR(total)}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} loading={saving}>
            Confirm Sale
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SellProductModal;
