import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import CustomerAutocomplete from '../../../../components/ui/CustomerAutocomplete';
import PaymentMethodSelector from '../../../../components/ui/PaymentMethodSelector';
import { PanelShell, FormBody, Field, TextInput, MoneyInput, Stepper, InfoRows, InlineError, CONTROL } from '../../../../components/ui/PanelFormKit';
import { useOrg } from '../../../../contexts/OrgContext';
import { useIndustry } from '../../../../hooks/useIndustry';
import { adjustProductStock, transferProductStock, sellProduct, fetchProductSellers, fetchGuestVisitsToday } from '../../../../services/api';
import { nepalNow } from '../../../../utils/customerDirectory';
import { newAvgCost, npr, REMOVE_REASONS, withArticle } from '../../../../services/productsView';
import { friendlyError } from '../../../../utils/friendlyError';
import { ProductThumb, Seg, BeforeAfter } from './productBits';
import { wordBranch, wordBranchCap, wordBranches } from '../../../../utils/industryTerms';

// Receive / Remove (take out or set the real count) / Move / Sell (V25). Each is a right-hand panel for one product at one branch.
// `branchId` null (the Overall view) adds a Branch field. The server re-checks everything (role, branch, never below 0).

const useCmdEnter = (run) => {
  const ref = useRef(run);
  ref.current = run;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ref.current(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
};

const activeSizes = (p) => { const a = p.variants.filter((v) => v.active); return a.length ? a : p.variants; };
const qtyAt = (v, branchId) => (v?.byBranch ? (v.byBranch.get(branchId) || 0) : 0);
const sizeLabel = (v) => v?.name || '';

const Head = ({ product, sub }) => (
  <div className="flex items-center gap-3">
    <ProductThumb product={product} size={40} />
    <div className="min-w-0">
      <p className="text-[14px] font-medium text-text-primary truncate">{product.name}</p>
      <p className="text-[12.5px] text-[#8A8A90] truncate">{sub}</p>
    </div>
  </div>
);

/** Size picker: segmented buttons "500 ml · 4 left" (only when there is more than one size). */
const SizePicker = ({ sizes, value, onChange, branchId, optionLabel, showQty = true }) => {
  if (sizes.length < 2) return null;
  return (
    <Field label={optionLabel || 'Size'}>
      <div className="grid gap-0.5 p-0.5 bg-background border border-border rounded-lg" style={{ gridTemplateColumns: `repeat(${Math.min(sizes.length, 3)}, minmax(0, 1fr))` }} role="group" aria-label={optionLabel || 'Size'}>
        {sizes.map((v) => (
          <button key={v.id} type="button" aria-pressed={value === v.id} onClick={() => onChange(v.id)} data-size={v.id}
            className={`h-9 px-2 rounded-md text-[13px] font-medium truncate ${value === v.id ? 'bg-white text-text-primary shadow-[0_1px_2px_rgba(14,13,12,.08)] border border-border' : 'text-[#515152] hover:text-text-primary'}`}>
            {v.name || 'Standard'}{showQty && branchId ? ` · ${qtyAt(v, branchId)} left` : ''}
          </button>
        ))}
      </div>
    </Field>
  );
};

const BranchField = ({ branches, value, onChange, id = 'pa-branch' }) => (
  <Field label={`${wordBranchCap()}`} required id={id}>
    <CustomSelect value={value} onChange={onChange} options={branches.map((b) => ({ value: b.id, label: b.name }))} placeholder={`Select ${wordBranch()}`} />
  </Field>
);

// ── Receive ─────────────────────────────────────────────────────────────────────────────────────
// Quantity, cost per unit (the last cost is prefilled), supplier (the product's by default), bill / note. Shows "4 → 28", the total
// and what the average cost becomes. With no product given it starts with a product picker.
export const ReceivePanel = ({ product: given = null, variantId: givenVariant = null, products, branches, branchId, branchName, suppliers, canCost, onClose, onDone, width }) => {
  const [productId, setProductId] = useState(given?.id || '');
  const product = given || products.find((p) => p.id === productId) || null;
  const sizes = product ? activeSizes(product) : [];
  const [variantId, setVariantId] = useState(givenVariant || '');
  const [branch, setBranch] = useState(branchId || '');
  const variant = sizes.find((v) => v.id === variantId) || sizes[0] || null;
  const [qty, setQty] = useState('1');
  const [cost, setCost] = useState('');
  const [costTouched, setCostTouched] = useState(false);
  const [supplierId, setSupplierId] = useState(given?.supplierId || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const busyRef = useRef(false);

  useEffect(() => { if (product) { setVariantId((id) => (sizes.some((v) => v.id === id) ? id : (sizes[0]?.id || ''))); setSupplierId((s) => s || product.supplierId || ''); } }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (variant && !costTouched) setCost(variant.lastCost != null ? String(variant.lastCost) : (variant.avgCost > 0 ? String(variant.avgCost) : '')); }, [variant?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => document.getElementById('rc-qty')?.focus({ preventScroll: true }), 260);
    return () => clearTimeout(t);
  }, []);

  const n = Number(qty) || 0;
  const here = variant && branch ? qtyAt(variant, branch) : 0;
  const total = variant ? variant.total : 0;
  const unit = cost === '' ? null : Number(cost);
  const bName = branchId ? branchName : (branches.find((b) => b.id === branch)?.name || '');
  const why = !product ? 'Choose a product' : !product.trackStock ? 'This product does not count stock' : !branch ? `Select the ${wordBranch()}` : !(n > 0) ? 'Enter the quantity' : '';
  const dirty = !!(note || cost || n !== 1);

  const submit = async () => {
    if (why || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    const { error: err } = await adjustProductStock({ variantId: variant.id, branchId: branch, mode: 'receive', qty: n, unitCost: unit, supplierId: supplierId || null, note: note.trim() || null });
    busyRef.current = false; setBusy(false);
    if (err) { setError(friendlyError(err, 'Could not receive the stock.')); return; }
    onDone(`Received ${n} · ${product.name}${sizeLabel(variant) ? ` ${sizeLabel(variant)}` : ''}`);
  };
  useCmdEnter(submit);

  const avgAfter = canCost && variant && unit != null ? newAvgCost(variant.total, variant.unitCost, n, unit) : null;
  return (
    <PanelShell width={width} variant="panel" title="Receive stock" onClose={onClose} dirty={dirty} busy={busy} reason={why}
      primary={{ label: busy ? 'Receiving…' : `Receive ${n || ''}`.trim(), onClick: submit, disabled: !!why, loading: busy }}>
      <FormBody>
        <InlineError message={error} />
        {!given ? (
          <Field label="Product" required id="rc-product">
            <CustomSelect value={productId} onChange={(v) => { setProductId(v); setCostTouched(false); }} searchable placeholder="Search a product"
              options={products.filter((p) => p.trackStock && p.isActive).map((p) => ({ value: p.id, label: p.name, searchLabel: `${p.name} ${p.brand} ${p.variants.map((v) => v.sku).join(' ')}` }))} />
          </Field>
        ) : <Head product={product} sub={[product.brand, sizes.length > 1 ? `${sizes.length} sizes` : sizeLabel(sizes[0])].filter(Boolean).join(' · ') || product.category} />}
        {!branchId && <BranchField branches={branches} value={branch} onChange={setBranch} />}
        {product && <SizePicker sizes={sizes} value={variant?.id} onChange={(id) => { setVariantId(id); setCostTouched(false); }} branchId={branch} optionLabel={product.optionLabel} />}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Quantity" required id="rc-qty"><Stepper id="rc-qty" value={qty} onChange={setQty} min={1} /></Field>
          {canCost && (
            <Field label="Cost per unit" id="rc-cost" labelExtra={variant?.lastCost != null ? <span className="text-xs text-[#8A8A90]">last {npr(variant.lastCost)}</span> : null}>
              <MoneyInput id="rc-cost" value={cost} onChange={(v) => { setCost(v); setCostTouched(true); }} />
            </Field>
          )}
        </div>
        {suppliers.length > 0 && (
          <Field label="From supplier" id="rc-supplier">
            <CustomSelect value={supplierId} onChange={setSupplierId} placeholder="No supplier"
              options={[{ value: '', label: 'No supplier' }, ...suppliers.filter((s) => s.isActive !== false).map((s) => ({ value: s.id, label: s.name }))]} />
          </Field>
        )}
        <Field label="Bill number or note" id="rc-note" labelExtra={<span className="text-xs text-[#8A8A90]">optional</span>}>
          <TextInput id="rc-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. HH-2231" />
        </Field>
        {variant && branch && product?.trackStock && (
          <>
            <BeforeAfter label={bName} before={here} after={here + n} right={canCost && unit != null && n > 0 ? npr(unit * n) : null} />
            {canCost && avgAfter != null && n > 0 && (
              <p className="text-[12.5px] text-[#8A8A90]" data-avg-note>
                Average cost{sizeLabel(variant) ? ` of the ${sizeLabel(variant)}` : ''} {variant.unitCost > 0 ? 'becomes' : 'starts at'} <b className="text-text-primary font-semibold">{npr(avgAfter)}</b>
                {variant.unitCost > 0 ? ` (was ${npr(variant.unitCost)})` : ' (it had no cost yet)'}, so margins stay true. Saved in the stock history with your name.
              </p>
            )}
          </>
        )}
      </FormBody>
    </PanelShell>
  );
};

// ── Remove: take some out (with a reason) or set the real count ─────────────────────────────────
export const RemovePanel = ({ product, variantId: givenVariant = null, initialMode = 'take', branches, branchId, branchName, canCost, onClose, onDone, width }) => {
  const { sessionLabel } = useIndustry();
  const sizes = activeSizes(product);
  const [mode, setMode] = useState(initialMode);
  const [variantId, setVariantId] = useState(givenVariant || sizes[0]?.id || '');
  const [branch, setBranch] = useState(branchId || '');
  const [reasonId, setReasonId] = useState('damaged');
  const [qty, setQty] = useState('1');
  const [count, setCount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const busyRef = useRef(false);
  const variant = sizes.find((v) => v.id === variantId) || sizes[0];
  const here = variant && branch ? qtyAt(variant, branch) : 0;
  useEffect(() => { setCount(String(here)); }, [variant?.id, branch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setQty((q) => String(Math.min(Number(q) || 1, Math.max(1, here)))); }, [variant?.id, branch]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = Number(qty) || 0;
  const counted = count === '' ? null : Number(count);
  const bName = branchId ? branchName : (branches.find((b) => b.id === branch)?.name || '');
  const avg = variant?.unitCost || 0; // 0 = cost unknown: no write-off value is shown
  const why = !branch ? `Select the ${wordBranch()}`
    : mode === 'take'
      ? (!(n > 0) ? 'Enter the quantity' : n > here ? `Only ${here} here` : reasonId === 'other' && !note.trim() ? 'Explain in the note' : '')
      : (counted == null ? 'Enter the count' : counted === here ? 'The count already matches' : '');
  const dirty = !!(note || (mode === 'take' ? n !== 1 : counted !== here));

  const submit = async () => {
    if (why || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    const { data, error: err } = await adjustProductStock(mode === 'take'
      ? { variantId: variant.id, branchId: branch, mode: 'remove', qty: n, reason: reasonId, note: note.trim() || null }
      : { variantId: variant.id, branchId: branch, mode: 'set_count', qty: counted, note: note.trim() || null });
    busyRef.current = false; setBusy(false);
    if (err) { setError(friendlyError(err, 'Could not update the stock.')); return; }
    onDone(mode === 'take' ? `Removed ${n} · ${product.name}${sizeLabel(variant) ? ` ${sizeLabel(variant)}` : ''}` : (data ? `Count saved · ${counted} ${product.name}` : 'The count already matched'));
  };
  useCmdEnter(submit);

  const delta = mode === 'take' ? -n : (counted ?? here) - here;
  return (
    <PanelShell width={width} variant="panel" title="Remove stock" onClose={onClose} dirty={dirty} busy={busy} reason={why}
      primary={{ label: busy ? 'Saving…' : mode === 'take' ? `Remove ${n || ''}`.trim() : 'Save count', onClick: submit, disabled: !!why, loading: busy }}>
      <FormBody>
        <InlineError message={error} />
        <Head product={product} sub={[sizeLabel(variant), variant?.sku].filter(Boolean).join(' · ') || product.brand || product.category} />
        <Seg value={mode} onChange={setMode} label="What to do" options={[['take', 'Take some out'], ['count', 'Set the real count']]} />
        {!branchId && <BranchField branches={branches} value={branch} onChange={setBranch} />}
        <SizePicker sizes={sizes} value={variant?.id} onChange={setVariantId} branchId={branch} optionLabel={product.optionLabel} />
        {mode === 'take' ? (
          <>
            <div>
              <p className="font-body font-body-medium text-[13px] text-text-primary mb-1.5">Why</p>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Why">
                {REMOVE_REASONS.map((r) => {
                  const on = reasonId === r.id;
                  const label = r.id === 'used_in_session' ? `Used in ${withArticle(sessionLabel)}` : r.label;
                  return (
                    <button key={r.id} type="button" role="radio" aria-checked={on} onClick={() => setReasonId(r.id)} data-reason={r.id}
                      className={`text-left px-3 py-2 rounded-lg border ${on ? 'border-primary bg-[#F2F6F0] shadow-[0_0_0_2px_rgba(45,90,39,.10)]' : 'border-border bg-white hover:bg-[#FAFAF9]'}`}>
                      <span className="block text-[13px] font-medium text-text-primary">{label}</span>
                      <span className="block text-[12px] text-[#8A8A90]">{r.sub}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Quantity" required id="rm-qty"><Stepper id="rm-qty" value={qty} onChange={setQty} min={1} max={Math.max(1, here)} /></Field>
              <Field label="Note" id="rm-note" labelExtra={<span className="text-xs text-[#8A8A90]">{reasonId === 'other' ? 'required' : 'optional'}</span>}>
                <TextInput id="rm-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Bottle cracked" />
              </Field>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Field label="What is really on the shelf" required id="rm-count">
              <input id="rm-count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 6))} className={`${CONTROL} tabular-nums`} />
            </Field>
            <Field label="Note" id="rm-note2" labelExtra={<span className="text-xs text-[#8A8A90]">optional</span>}>
              <TextInput id="rm-note2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Stocktake" />
            </Field>
          </div>
        )}
        {variant && branch && (
          <BeforeAfter label={bName} before={here} after={here + delta} tone={delta < 0 ? 'bad' : 'ok'}
            right={canCost && delta < 0 && avg > 0 ? <>Writes off <b className="text-text-primary">{npr(-delta * avg)}</b></> : (mode === 'count' && delta > 0 ? `+${delta}` : null)} />
        )}
        <p className="text-[12.5px] text-[#8A8A90]">
          Selling and refunds update stock by themselves. Use this for everything else. {mode === 'take' ? 'If the shelf count is simply wrong, use “Set the real count”.' : 'The old and new counts are both kept in the stock history.'}
        </p>
      </FormBody>
    </PanelShell>
  );
};

// ── Move between branches ───────────────────────────────────────────────────────────────────────
export const MovePanel = ({ product, variantId: givenVariant = null, from: givenFrom = null, branches, sendFromIds = null, branchId, onClose, onDone, width }) => {
  const sizes = activeSizes(product);
  const [variantId, setVariantId] = useState(givenVariant || sizes[0]?.id || '');
  const variant = sizes.find((v) => v.id === variantId) || sizes[0];
  const [from, setFrom] = useState(() => givenFrom || (sendFromIds && branchId && sendFromIds.has(branchId) ? branchId : ''));
  const [to, setTo] = useState(() => (givenFrom || !(sendFromIds && branchId && sendFromIds.has(branchId)) ? (branchId || '') : ''));
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const busyRef = useRef(false);
  const have = variant && from ? qtyAt(variant, from) : 0;
  const there = variant && to ? qtyAt(variant, to) : 0;
  const n = Number(qty) || 0;
  // Managers can only send stock out of the branches they manage (sendFromIds); admins (null) can send from any. Anyone can send to any.
  const fromList = sendFromIds ? branches.filter((b) => sendFromIds.has(b.id)) : branches;
  const opts = (exclude, list = branches) => list.filter((b) => b.id !== exclude).map((b) => ({ value: b.id, label: variant ? `${b.name} · ${qtyAt(variant, b.id)} left` : b.name }));
  const why = !from ? 'Choose where it comes from' : !to ? 'Choose where it goes' : from === to ? `Pick two different ${wordBranches()}` : !(n > 0) ? 'Enter the quantity' : n > have ? `Only ${have} at the source` : '';
  const dirty = !!(note || n !== 1 || (from && !givenFrom));

  const submit = async () => {
    if (why || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    const { error: err } = await transferProductStock({ variantId: variant.id, fromBranchId: from, toBranchId: to, quantity: n, note: note.trim() || null });
    busyRef.current = false; setBusy(false);
    if (err) { setError(friendlyError(err, 'Could not move the stock.')); return; }
    onDone(`Moved ${n} · ${product.name}${sizeLabel(variant) ? ` ${sizeLabel(variant)}` : ''} to ${branches.find((b) => b.id === to)?.name || ''}`);
  };
  useCmdEnter(submit);
  const name = (id) => branches.find((b) => b.id === id)?.name || '';
  return (
    <PanelShell width={width} variant="panel" title="Move stock" onClose={onClose} dirty={dirty} busy={busy} reason={why}
      primary={{ label: busy ? 'Moving…' : `Move ${n || ''}`.trim(), onClick: submit, disabled: !!why, loading: busy }}>
      <FormBody>
        <InlineError message={error} />
        <Head product={product} sub={[product.brand, sizeLabel(variant)].filter(Boolean).join(' · ') || product.category} />
        <SizePicker sizes={sizes} value={variant?.id} onChange={setVariantId} branchId={null} optionLabel={product.optionLabel} showQty={false} />
        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
          <Field label="From" required id="mv-from"><CustomSelect value={from} onChange={setFrom} options={opts(to, fromList)} placeholder={`${wordBranchCap()}`} /></Field>
          <Icon name="ArrowRight" size={16} className="text-[#8A8A90] mb-3" />
          <Field label="To" required id="mv-to"><CustomSelect value={to} onChange={setTo} options={opts(from)} placeholder={`${wordBranchCap()}`} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Quantity" required id="mv-qty"><Stepper id="mv-qty" value={qty} onChange={setQty} min={1} max={Math.max(1, have)} /></Field>
          <Field label="Note" id="mv-note" labelExtra={<span className="text-xs text-[#8A8A90]">optional</span>}>
            <TextInput id="mv-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. They ran out" />
          </Field>
        </div>
        {from && to && from !== to && (
          <InfoRows rows={[[name(from), `${have} → ${have - n}`], [name(to), `${there} → ${there + n}`]]} />
        )}
        <p className="text-[12.5px] text-[#8A8A90]">The move is immediate and recorded on both {wordBranches()} in the stock history.</p>
      </FormBody>
    </PanelShell>
  );
};

// ── Sell (standalone sale; selling inside booking checkout is V26) ──────────────────────────────
export const SellPanel = ({ product, variantId: givenVariant = null, branchId, branchName, onClose, onDone, width }) => {
  const { paymentMethods } = useOrg();
  const sizes = activeSizes(product);
  const [variantId, setVariantId] = useState(givenVariant || sizes[0]?.id || '');
  const variant = sizes.find((v) => v.id === variantId) || sizes[0];
  const [quantity, setQuantity] = useState('1');
  const [paymentMode, setPaymentMode] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerId, setCustomerId] = useState(null);
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [sold, setSold] = useState(null);
  const [sellers, setSellers] = useState([]);
  const [soldBy, setSoldBy] = useState(undefined); // undefined = not chosen yet (required); '__none' = no one (no commission); else a therapist id
  const [visits, setVisits] = useState([]); // this guest's visits today at this branch
  const [attach, setAttach] = useState(null); // the visit id the sale is added to
  const [soldQty, setSoldQty] = useState({}); // variantId -> units sold in this panel, so "Sell another" respects the stock left
  const customerRef = useRef(null);
  useEffect(() => {
    if (!branchId) return undefined;
    let live = true;
    fetchProductSellers({ branchId }).then(({ data }) => { if (live && data) setSellers(data); });
    return () => { live = false; };
  }, [branchId]);
  // A guest who had a visit today can have this sale added to it (this is also how products reach an already-paid booking).
  useEffect(() => {
    setAttach(null);
    if (!customerId || !branchId) { setVisits([]); return undefined; }
    let live = true;
    fetchGuestVisitsToday({ customerId, branchId, date: nepalNow().today }).then(({ data }) => { if (live) setVisits(data || []); });
    return () => { live = false; };
  }, [customerId, branchId]);

  const tracked = product.trackStock;
  const left = tracked && variant ? qtyAt(variant, branchId) - (soldQty[variant.id] || 0) : null;
  const qty = Number(quantity) || 0;
  const unit = variant?.price || 0;
  const total = Math.round(qty * unit * 100) / 100;
  useEffect(() => {
    if (sold) return undefined;
    const t = setTimeout(() => customerRef.current?.focus({ preventScroll: true }), 260);
    return () => clearTimeout(t);
  }, [sold]);

  const why = !branchId ? `Pick a ${wordBranch()} first`
    : tracked && left <= 0 ? 'Out of stock'
      : !(qty > 0) ? 'Enter the quantity'
        : tracked && qty > left ? `Only ${left} in stock`
          : soldBy === undefined ? 'Choose who sold it'
            : !paymentMode ? 'Pick a payment method' : '';

  const submit = async () => {
    if (savingRef.current || why) return;
    savingRef.current = true; setSaving(true); setError(null);
    const res = await sellProduct({
      variantId: variant.id, quantity: qty, paymentMode, branchId, customerId, notes: notes.trim() || null,
      soldByTherapistId: soldBy && soldBy !== '__none' ? soldBy : null, bookingId: attach,
    });
    savingRef.current = false; setSaving(false);
    if (res.error) { setError(friendlyError(res.error, 'The sale could not be recorded.')); return; }
    setSold({ qty, total, customer: customerName.trim(), mode: paymentMode, variant, seller: soldBy && soldBy !== '__none' ? (sellers.find((x) => x.id === soldBy)?.name || '') : '', visit: attach ? visits.find((v) => v.id === attach) : null });
    setSoldQty((m) => ({ ...m, [variant.id]: (m[variant.id] || 0) + qty }));
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !sold) { e.preventDefault(); submitRef.current(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sold]);
  const sellAnother = () => { setSold(null); setQuantity('1'); setCustomerName(''); setCustomerId(null); setNotes(''); setShowNotes(false); setError(null); setAttach(null); setSoldBy(undefined); };
  const dirty = !!(customerName || notes || quantity !== '1' || paymentMode || soldBy !== undefined);

  if (sold) {
    return (
      <PanelShell width={width} variant="panel" title="Sell product" onClose={() => onDone(null)}
        footerOverride={(
          <div className="flex items-center justify-end gap-2">
            {(!tracked || left > 0) && <button type="button" onClick={sellAnother} className="h-9 px-2.5 text-[13px] font-body font-body-medium text-text-secondary hover:text-text-primary hover:bg-black/[0.04] rounded-spa whitespace-nowrap">Sell another</button>}
            <button type="button" onClick={() => onDone(`Sold ${sold.qty} · ${product.name}`)} className="h-9 px-4 text-[13px] font-body font-body-medium bg-primary text-white rounded-spa hover:bg-primary/90 whitespace-nowrap">Done</button>
          </div>
        )}>
        <div className="px-5 py-10 text-center" role="status" aria-live="polite">
          <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-3"><Icon name="Check" size={24} className="text-success" /></div>
          <h4 className="font-heading font-heading-semibold text-[15px] text-text-primary">Sale recorded</h4>
          <p className="mt-3 font-data font-data-medium text-2xl text-primary tabular-nums">{npr(sold.total)}</p>
          <p className="mt-3 text-[13px] text-text-secondary tabular-nums">{product.name}{sizeLabel(sold.variant) ? ` ${sizeLabel(sold.variant)}` : ''} × {sold.qty} · {sold.mode}{sold.customer ? ` · ${sold.customer}` : ' · walk-in'}</p>
          {tracked && <p className="mt-1 text-xs text-text-tertiary tabular-nums">{left} left at {branchName}</p>}
          <p className="mt-1 text-xs text-text-tertiary">{sold.seller ? `Credited to ${sold.seller}` : 'No commission on this sale'}{sold.visit ? ` · added to ${sold.visit.serviceName}` : ''}</p>
        </div>
      </PanelShell>
    );
  }

  return (
    <PanelShell width={width} variant="panel" title="Sell product" onClose={onClose} dirty={dirty} busy={saving} reason={why}
      primary={{ label: saving ? 'Selling…' : (total > 0 ? `Sell · ${npr(total)}` : 'Sell'), onClick: submit, disabled: !!why, loading: saving }}>
      <FormBody>
        <Head product={product} sub={`${npr(unit)} each${tracked ? ` · ${left} in stock at ${branchName}` : ' · stock is not counted'}`} />
        <InlineError message={error} />
        <SizePicker sizes={sizes} value={variant?.id} onChange={setVariantId} branchId={branchId} optionLabel={product.optionLabel} />
        <Field label="Customer" id="sell-customer" hint="Optional. Leave blank for a walk-in sale.">
          <CustomerAutocomplete id="sell-customer" value={customerName} onChange={(v) => { setCustomerName(v); setCustomerId(null); }}
            onSelect={(c) => { setCustomerName(c.full_name); setCustomerId(c.id); }} branchId={branchId} inputRef={customerRef} searchBy="name" placeholder="Search by name" inputClassName={CONTROL} />
        </Field>
        {visits.length > 0 && (
          <div className="rounded-[10px] border border-border bg-background px-3 py-2.5 text-[13px] flex items-start gap-2" data-visit-banner>
            <Icon name="Link" size={14} className="text-text-secondary mt-0.5 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              {visits.map((v) => {
                const on = attach === v.id;
                return (
                  <p key={v.id} className="text-text-secondary">
                    {(customerName || 'The guest').split(' ')[0]} had <b className="font-medium text-text-primary">{v.serviceName}</b>{v.startTime ? ` at ${String(v.startTime).slice(0, 5)}` : ''} today{v.paid ? ' (paid)' : ''}.{' '}
                    <button type="button" aria-pressed={on} onClick={() => { setAttach(on ? null : v.id); if (!on && soldBy === undefined && v.therapistId) setSoldBy(v.therapistId); }} className="font-medium text-primary hover:underline" data-attach-visit>{on ? 'Added to that visit · Undo' : 'Add this sale to that visit'}</button>
                  </p>
                );
              })}
            </div>
          </div>
        )}
        <Field label="Quantity" required id="sell-qty"><Stepper id="sell-qty" value={quantity} onChange={setQuantity} min={1} max={tracked ? Math.max(1, left) : undefined} /></Field>
        <Field label="Sold by" required id="sell-soldby" labelExtra={<span className="text-xs text-text-secondary">earns the commission</span>}>
          <CustomSelect value={soldBy === undefined ? '' : soldBy} onChange={(v) => setSoldBy(v)} placeholder="Choose who sold it"
            options={[...sellers.map((x) => ({ value: x.id, label: x.name })), { value: '__none', label: 'No one (no commission)' }]} />
        </Field>
        <Field label="Payment method" required id="sell-method">
          <PaymentMethodSelector value={paymentMode} onChange={setPaymentMode} paymentMethods={paymentMethods} placeholder="Select a payment method" />
        </Field>
        {showNotes ? (
          <Field label="Notes" id="sell-notes"><TextInput id="sell-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>
        ) : (
          <button type="button" onClick={() => setShowNotes(true)} className="block text-[13px] font-body-medium text-primary hover:underline">+ Add note</button>
        )}
        <InfoRows rows={[[`${npr(unit)} × ${qty || 0}`, npr(total)], ['Total', npr(total), 'total']]} />
      </FormBody>
    </PanelShell>
  );
};

