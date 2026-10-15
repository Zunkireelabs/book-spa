import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import CustomerAutocomplete from '../../../../components/ui/CustomerAutocomplete';
import PaymentMethodSelector from '../../../../components/ui/PaymentMethodSelector';
import { PanelShell, FormBody, Field, TextInput, Stepper, InfoRows, InlineError, CONTROL } from '../../../../components/ui/PanelFormKit';
import { useBranch } from '../../../../contexts/BranchContext';
import { useOrg } from '../../../../contexts/OrgContext';
import { sellProduct } from '../../../../services/api';
import { friendlyError } from '../../../../utils/friendlyError';

const formatNPR = (amount) => `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;

// "Sell product": its own standalone transaction (migration-189/190), not a line item on a booking. The sale RPC takes one payment
// method (no split tender, no wallet), so the panel has one method row. Callbacks: onClose(), onSold().
const SellProductPanel = ({ product, onClose, onSold }) => {
  const { branchId, branchName, isOverall } = useBranch();
  const { paymentMethods } = useOrg();

  const [quantity, setQuantity] = useState('1');
  const [paymentMode, setPaymentMode] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerId, setCustomerId] = useState(null);
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [sold, setSold] = useState(null); // { qty, total, customer, mode } once recorded
  const [soldQty, setSoldQty] = useState(0); // units sold in this panel, so "Sell another" respects the remaining stock
  const quantityRef = useRef(null);
  const customerRef = useRef(null);

  const tracked = !!product.track_stock;
  const stockLeft = tracked ? product.stock_quantity - soldQty : null;
  const qty = Number(quantity) || 0;
  const unit = Number(product.price_npr);
  const total = Math.round(qty * unit * 100) / 100;

  useEffect(() => {
    if (sold) return undefined;
    const t = setTimeout(() => customerRef.current?.focus({ preventScroll: true }), 260);
    return () => clearTimeout(t);
  }, [sold, isOverall]);

  const reason = tracked && stockLeft <= 0 ? 'Out of stock'
    : !(qty > 0) ? 'Enter the quantity'
    : tracked && qty > stockLeft ? `Only ${stockLeft} in stock`
    : !paymentMode ? 'Pick a payment method'
    : '';

  const submit = async () => {
    if (savingRef.current || reason || isOverall) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const result = await sellProduct({ productId: product.id, quantity: qty, paymentMode, branchId, customerId, notes: notes.trim() || null });
    savingRef.current = false;
    setSaving(false);
    if (result.error) { setError(friendlyError(result.error, 'The sale could not be recorded.')); return; }
    setSold({ qty, total, customer: customerName.trim(), mode: paymentMode });
    setSoldQty((n) => n + qty);
  };

  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !sold) { e.preventDefault(); submitRef.current(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sold]);

  const sellAnother = () => {
    setSold(null); setQuantity('1'); setCustomerName(''); setCustomerId(null); setNotes(''); setShowNotes(false); setError(null);
  };

  const dirty = !!(customerName || notes || quantity !== '1' || paymentMode);

  if (sold) {
    return (
      <PanelShell
        variant="panel"
        title="Sell product"
        onClose={onSold}
        footerOverride={(
          <div className="flex items-center justify-end gap-2">
            {(!tracked || stockLeft > 0) && <button type="button" onClick={sellAnother} className="h-9 px-2.5 text-[13px] font-body font-body-medium text-text-secondary hover:text-text-primary hover:bg-black/[0.04] rounded-spa whitespace-nowrap">Sell another</button>}
            <button type="button" onClick={onSold} className="h-9 px-4 text-[13px] font-body font-body-medium bg-primary text-white rounded-spa hover:bg-primary/90 transition-colors whitespace-nowrap">Done</button>
          </div>
        )}
      >
        <div className="px-5 py-10 text-center" role="status" aria-live="polite">
          <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-3"><Icon name="Check" size={24} className="text-success" /></div>
          <h4 className="font-heading font-heading-semibold text-[15px] text-text-primary">Sale recorded</h4>
          <p className="mt-3 font-data font-data-medium text-2xl text-primary tabular-nums">{formatNPR(sold.total)}</p>
          <p className="mt-3 text-[13px] text-text-secondary tabular-nums">{product.name} × {sold.qty} · {sold.mode}{sold.customer ? ` · ${sold.customer}` : ' · walk-in'}</p>
          {tracked && <p className="mt-1 text-xs text-text-tertiary tabular-nums">{stockLeft} left at {branchName}</p>}
        </div>
      </PanelShell>
    );
  }

  return (
    <PanelShell
      variant="panel"
      title="Sell product"
      onClose={onClose}
      dirty={dirty}
      busy={saving}
      reason={reason}
      primary={isOverall ? undefined : { label: saving ? 'Selling…' : (total > 0 ? `Sell · ${formatNPR(total)}` : 'Sell'), onClick: submit, disabled: !!reason, loading: saving }}
    >
      {isOverall ? (
        <FormBody>
          <div className="py-10 text-center">
            <Icon name="ShoppingBag" size={28} className="text-text-tertiary mx-auto mb-3" />
            <p className="text-[13px] text-text-secondary">Sales are recorded at one branch. Switch branch in the header to continue.</p>
          </div>
        </FormBody>
      ) : (
        <FormBody>
          <div>
            <p className="font-body font-body-medium text-[14px] text-text-primary">{product.name}</p>
            <p className="mt-0.5 text-xs text-text-secondary tabular-nums">
              {formatNPR(unit)} each{tracked ? ` · ${stockLeft} in stock at ${branchName}` : ' · unlimited stock'}
            </p>
          </div>
          <InlineError message={error} />

          <Field label="Customer" id="sell-customer" hint="Optional. Leave blank for a walk-in sale.">
            <CustomerAutocomplete
              id="sell-customer"
              value={customerName}
              onChange={(v) => { setCustomerName(v); setCustomerId(null); }}
              onSelect={(c) => { setCustomerName(c.full_name); setCustomerId(c.id); }}
              branchId={branchId}
              inputRef={customerRef}
              searchBy="name"
              placeholder="Search by name"
              inputClassName={CONTROL}
            />
          </Field>

          <Field label="Quantity" required id="sell-qty">
            <Stepper id="sell-qty" value={quantity} onChange={setQuantity} min={1} max={tracked ? Math.max(1, stockLeft) : undefined} />
          </Field>

          <Field label="Payment method" required id="sell-method">
            <PaymentMethodSelector value={paymentMode} onChange={setPaymentMode} paymentMethods={paymentMethods} placeholder="Select a payment method" />
          </Field>

          {showNotes ? (
            <Field label="Notes" id="sell-notes">
              <TextInput id="sell-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </Field>
          ) : (
            <button type="button" onClick={() => setShowNotes(true)} className="block text-[13px] font-body-medium text-primary hover:underline">+ Add note</button>
          )}

          <InfoRows rows={[
            [`${formatNPR(unit)} × ${qty || 0}`, formatNPR(total)],
            ['Total', formatNPR(total), 'total'],
          ]} />
        </FormBody>
      )}
    </PanelShell>
  );
};

export default SellProductPanel;
