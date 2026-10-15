import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PanelShell, FormBody, Field, SelectField, TextInput, Stepper, InfoRows, InlineError } from '../../../../components/ui/PanelFormKit';
import { fetchProductBranchStock, fetchProductStockTransfers, transferProductStock } from '../../../../services/api';
import { friendlyError } from '../../../../utils/friendlyError';

const RECEIVE_SOURCE = 'RECEIVE';
const formatDateTime = (d) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// "Receive / transfer stock": moves stock between branches, or receives new stock from outside (no source branch). Always
// immediate and recorded on both sides (transfer_product_stock, migration-214). Callbacks: onClose(), onTransferred().
const StockTransferPanel = ({ product, onClose, onTransferred }) => {
  const [branchStock, setBranchStock] = useState(null);
  const [history, setHistory] = useState([]);
  const [from, setFrom] = useState(RECEIVE_SOURCE);
  const [to, setTo] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    const [stockResult, historyResult] = await Promise.all([
      fetchProductBranchStock(product.id),
      fetchProductStockTransfers({ productId: product.id, limit: 10 }),
    ]);
    setBranchStock(stockResult.error ? [] : (stockResult.data || []));
    if (!historyResult.error) setHistory(historyResult.data || []);
  }, [product.id]);
  useEffect(() => { load(); }, [load]);

  const stock = branchStock || [];
  const byId = (id) => stock.find((b) => b.branchId === id);
  const receiving = from === RECEIVE_SOURCE;
  const sourceQty = receiving ? null : (byId(from)?.quantity ?? 0);
  const qty = Number(quantity) || 0;

  const fromOptions = [{ value: RECEIVE_SOURCE, label: 'New stock (e.g. supplier delivery)' }, ...stock.map((b) => ({ value: b.branchId, label: b.branchName }))];
  const toOptions = stock.map((b) => ({ value: b.branchId, label: b.branchName }));

  const reason = branchStock === null ? 'Loading branches…'
    : !to ? 'Pick a destination branch'
    : !receiving && from === to ? 'Pick two different branches'
    : !(qty > 0) ? 'Enter the quantity'
    : !receiving && qty > sourceQty ? `Only ${sourceQty} at ${byId(from)?.branchName}`
    : '';

  const submit = async () => {
    if (savingRef.current || reason) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const result = await transferProductStock({ productId: product.id, toBranchId: to, quantity: qty, fromBranchId: receiving ? null : from, note: note.trim() || null });
    savingRef.current = false;
    setSaving(false);
    if (result.error) { setError(friendlyError(result.error, 'The transfer could not be recorded.')); return; }
    onTransferred();
  };

  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitRef.current(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const toName = byId(to)?.branchName;
  const fromName = byId(from)?.branchName;
  const rows = [];
  if (qty > 0 && to) {
    if (!receiving && fromName) rows.push([`${fromName} stock`, `${sourceQty} → ${sourceQty - qty}`]);
    if (toName) rows.push([`${toName} stock`, `${byId(to).quantity} → ${byId(to).quantity + qty}`]);
  }
  const branchName = (id) => byId(id)?.branchName || '—';

  return (
    <PanelShell
      variant="panel"
      title="Receive / transfer stock"
      onClose={onClose}
      dirty={!!(to || note || quantity !== '1' || from !== RECEIVE_SOURCE)}
      busy={saving}
      reason={reason}
      primary={{ label: saving ? (receiving ? 'Receiving…' : 'Transferring…') : `${receiving ? 'Receive' : 'Transfer'}${qty > 0 ? ` ${qty}` : ''}`, onClick: submit, disabled: !!reason, loading: saving }}
    >
      <FormBody>
        <p className="font-body font-body-medium text-[14px] text-text-primary">{product.name}</p>
        <InlineError message={error} />

        <Field label="From" id="stk-from">
          <SelectField value={from} onChange={(v) => { setFrom(v); if (v === to) setTo(''); }} options={fromOptions} />
          {!receiving && <p className="mt-1.5 text-xs text-text-secondary tabular-nums">{fromName} has {sourceQty}</p>}
        </Field>

        <Field label="To" required id="stk-to">
          <SelectField value={to} onChange={setTo} options={toOptions.filter((o) => o.value !== from)} placeholder="Select destination branch" />
          {to && <p className="mt-1.5 text-xs text-text-secondary tabular-nums">{toName} has {byId(to)?.quantity ?? 0}</p>}
        </Field>

        <Field label="Quantity" required id="stk-qty">
          <Stepper id="stk-qty" value={quantity} onChange={setQuantity} min={1} max={!receiving ? Math.max(1, sourceQty) : undefined} />
        </Field>

        <Field label="Note" id="stk-note">
          <TextInput id="stk-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Supplier invoice #1234" />
        </Field>

        {rows.length > 0 && <InfoRows rows={rows} />}

        {history.length > 0 && (
          <div>
            <p className="mb-1.5 font-body font-body-medium text-[13px] text-text-primary">Recent activity</p>
            <ul className="border border-border rounded-spa divide-y divide-border">
              {history.map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-3 py-2 text-xs text-text-secondary">
                  <span className="flex-1 min-w-0 truncate">{t.from_branch_id ? branchName(t.from_branch_id) : 'New stock'} → {branchName(t.to_branch_id)}</span>
                  <span className="font-data tabular-nums text-text-primary">+{t.quantity}</span>
                  <span className="text-text-tertiary whitespace-nowrap">{formatDateTime(t.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </FormBody>
    </PanelShell>
  );
};

export default StockTransferPanel;
