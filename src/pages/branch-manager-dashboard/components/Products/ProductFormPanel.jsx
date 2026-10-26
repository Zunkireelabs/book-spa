import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import { PanelShell, FormBody, Field, TextInput, SwitchRow, InlineError, controlA11y } from '../../../../components/ui/PanelFormKit';
import { useIndustry } from '../../../../hooks/useIndustry';
import { saveProduct, uploadProductImage, fetchActiveProductCategories } from '../../../../services/api';
import { marginPct, marginRange, makeSku } from '../../../../services/productsView';
import { friendlyError } from '../../../../utils/friendlyError';
import ImageDropzone from './ImageDropzone';
import ProductCategories from './ProductCategories';
import { HereTag } from './productBits';

const OPTION_LABELS = ['Size', 'Shade', 'Colour', 'Scent', 'Flavour', 'Type'].map((v) => ({ value: v, label: v }));
let keySeq = 0;
const newKey = () => { keySeq += 1; return `k${keySeq}`; };
const blankSize = () => ({ key: newKey(), id: null, name: '', sku: '', barcode: '', cost: '', price: '', low: '', reorder: '' });
const numStr = (v) => (v == null ? '' : String(v));
const cell = 'w-full h-9 px-2 text-[13px] border border-border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary tabular-nums';

// New / edit product (V25): the right-hand form. Photo, name, brand, category, supplier; "Sizes differ by" + a sizes table (one row = a
// plain single product); margins live; Sell at checkout / Count stock / Tell me when it runs low; and, on create only, the opening
// stock per branch × size. After creating, stock changes only through Receive / Remove / Set count (never a direct edit).
// Category management is a stacked view (the draft stays mounted underneath).
const ProductFormPanel = ({ product = null, branches, suppliers, branchId, onClose, onBack, onSaved, width }) => {
  const { productsSoldByDefault, defaultProductCategories } = useIndustry();
  const editing = !!product;
  const original = useMemo(() => {
    if (!product) {
      return { name: '', brand: '', category: '', supplierId: '', optionLabel: 'Size', sell: productsSoldByDefault, track: true, notify: true, earns: true, sizes: [blankSize()] };
    }
    return {
      name: product.name, brand: product.brand, category: product.category, supplierId: product.supplierId || '', optionLabel: product.optionLabel || 'Size',
      sell: product.sellAtCheckout, track: product.trackStock, notify: product.notifyLow, earns: product.earnsCommission !== false,
      sizes: product.variants.map((v) => ({
        key: newKey(), id: v.id, name: v.name, sku: v.sku, barcode: v.barcode, cost: numStr(v.lastCost ?? (v.avgCost > 0 ? v.avgCost : null)), price: numStr(v.price),
        low: numStr(v.low), reorder: numStr(v.reorder), active: v.active,
      })),
    };
  }, [product, productsSoldByDefault]);

  const [form, setForm] = useState(original);
  const [opening, setOpening] = useState({}); // `${branchId}:${key}` -> qty string
  const [more, setMore] = useState({}); // key -> second line open
  const [imageFile, setImageFile] = useState(null);
  const [imageUrl, setImageUrl] = useState(product?.imageUrl || '');
  const [imagePreview, setImagePreview] = useState(product?.imageUrl || null);
  const [imageError, setImageError] = useState(null);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [view, setView] = useState('form');
  const nameRef = useRef(null);

  const loadCategories = async () => {
    const r = await fetchActiveProductCategories();
    if (!r.error) setCategoryOptions((r.data || []).map((c) => ({ value: c.name, label: c.name })));
  };
  useEffect(() => { loadCategories(); }, []);
  useEffect(() => { const t = setTimeout(() => nameRef.current?.focus({ preventScroll: true }), 260); return () => clearTimeout(t); }, []);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setServerError(null); };
  const setSize = (key, patch) => { setForm((f) => ({ ...f, sizes: f.sizes.map((s) => (s.key === key ? { ...s, ...patch } : s)) })); setServerError(null); };
  const multi = form.sizes.filter((s) => s.active !== false).length > 1;
  const takenSkus = () => new Set(form.sizes.map((s) => s.sku.toLowerCase()).filter(Boolean));
  const margins = form.sizes.map((s) => marginPct(s.price, s.cost));
  const dirty = JSON.stringify(form) !== JSON.stringify(original) || !!imageFile || imageUrl !== (product?.imageUrl || '') || Object.values(opening).some(Boolean);

  const problem = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Enter the product name.';
    form.sizes.forEach((s) => {
      if (s.price === '' || Number(s.price) < 0) e[`price:${s.key}`] = 'Enter the price';
      if (multi && !s.name.trim() && s.active !== false) e[`name:${s.key}`] = 'Name this size';
    });
    const names = form.sizes.filter((s) => s.active !== false).map((s) => s.name.trim().toLowerCase());
    if (multi && new Set(names).size !== names.length) e.sizes = 'Two sizes have the same name.';
    const skus = form.sizes.map((s) => s.sku.trim().toLowerCase()).filter(Boolean);
    if (new Set(skus).size !== skus.length) e.sizes = 'Two sizes have the same SKU.';
    return e;
  };
  const reason = !form.name.trim() ? 'Enter the product name' : form.sizes.some((s) => s.price === '') ? 'Enter the price of each size' : (multi && form.sizes.some((s) => s.active !== false && !s.name.trim())) ? 'Name every size' : (editing && !dirty ? 'No changes' : '');

  const submit = async () => {
    if (savingRef.current || reason || view !== 'form') return;
    const e = problem();
    setErrors(e);
    if (Object.keys(e).length) { const first = Object.keys(e)[0]; document.getElementById(first.startsWith('name') && !first.includes(':') ? 'prd-name' : undefined)?.focus({ preventScroll: true }); return; }
    savingRef.current = true; setSaving(true); setServerError(null);
    let finalImage = imageUrl.trim() || null;
    if (imageFile) {
      const up = await uploadProductImage(imageFile);
      if (up.error) { savingRef.current = false; setSaving(false); setImageError(friendlyError(up.error, 'Could not upload the image.')); return; }
      finalImage = up.url;
    }
    const sizes = form.sizes;
    const openingRows = [];
    if (!editing && form.track) {
      sizes.forEach((s, i) => branches.forEach((b) => { const q = Number(opening[`${b.id}:${s.key}`]) || 0; if (q > 0) openingRows.push({ idx: i + 1, branchId: b.id, qty: q }); }));
    }
    const res = await saveProduct({
      productId: product?.id || null,
      product: {
        name: form.name.trim(), brand: form.brand.trim() || null, category: form.category || null, supplierId: form.supplierId || null, imageUrl: finalImage,
        optionLabel: multi ? form.optionLabel : null, proUse: !form.sell, sellAtCheckout: form.sell, trackStock: form.track, notifyLow: form.notify, earnsCommission: form.earns,
      },
      variants: sizes.map((s) => ({ ...s, name: s.name.trim(), sku: s.sku.trim(), active: s.active !== false })),
      opening: openingRows,
    });
    savingRef.current = false; setSaving(false);
    if (res.error) { setServerError(friendlyError(res.error, 'Could not save the product.')); return; }
    onSaved(res.data, !editing, form.name.trim());
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitRef.current(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (view === 'categories') {
    return (
      <PanelShell width={width} variant="panel" title="Categories" onClose={onClose} onBack={() => setView('form')} hideFooter>
        <ProductCategories onCategoriesChanged={loadCategories} starters={defaultProductCategories} />
      </PanelShell>
    );
  }

  const catOptions = form.category && !categoryOptions.some((o) => o.value === form.category) ? [{ value: form.category, label: form.category }, ...categoryOptions] : categoryOptions;
  const visibleSizes = form.sizes.filter((s) => s.active !== false);

  return (
    <PanelShell width={width} variant="panel" title={editing ? 'Edit product' : 'New product'} onClose={onClose} onBack={onBack} dirty={dirty} busy={saving} reason={reason}
      primary={{ label: saving ? 'Saving…' : (editing ? 'Save changes' : 'Create product'), onClick: submit, disabled: !!reason, loading: saving }}>
      <FormBody>
        <InlineError message={serverError} />
        <Field label="Name" required id="prd-name" error={errors.name}>
          <TextInput {...controlA11y('prd-name', errors.name)} ref={nameRef} error={errors.name} value={form.name} onChange={(e) => { set({ name: e.target.value }); setErrors((x) => ({ ...x, name: undefined })); }} placeholder="e.g. Lavender massage oil" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Brand" id="prd-brand"><TextInput id="prd-brand" value={form.brand} onChange={(e) => set({ brand: e.target.value })} placeholder="Optional" /></Field>
          <Field label="Category" id="prd-category" labelExtra={<button type="button" onClick={() => setView('categories')} className="text-xs font-body-medium text-primary hover:underline whitespace-nowrap">Manage</button>}>
            <CustomSelect value={form.category} onChange={(v) => set({ category: v })} options={[{ value: '', label: 'No category' }, ...catOptions]} placeholder="No category" searchable />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Supplier" id="prd-supplier">
            <CustomSelect value={form.supplierId} onChange={(v) => set({ supplierId: v })} placeholder="No supplier" searchable
              options={[{ value: '', label: 'No supplier' }, ...suppliers.filter((s) => s.isActive !== false || s.id === form.supplierId).map((s) => ({ value: s.id, label: s.name }))]} />
          </Field>
          <Field label="Sizes differ by" id="prd-option">
            <CustomSelect value={form.optionLabel} onChange={(v) => set({ optionLabel: v })} options={OPTION_LABELS} disabled={!multi} />
          </Field>
        </div>
        <Field label="Photo" id="prd-image" error={imageError}>
          <ImageDropzone id="prd-image" previewUrl={imagePreview} error={imageError} onError={setImageError} disabled={saving}
            onPick={(file) => { setImageFile(file); setImagePreview(URL.createObjectURL(file)); }}
            onRemove={() => { setImageFile(null); setImagePreview(null); setImageUrl(''); setImageError(null); }} />
        </Field>

        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <p className="font-body font-body-medium text-[13px] text-text-primary">Sizes <span className="ml-1.5 text-xs font-normal text-[#8A8A90]"><Icon name="Lock" size={11} className="inline -mt-0.5 mr-0.5" />cost: managers</span></p>
          </div>
          <div className="border border-border rounded-spa overflow-hidden">
            <div className="grid grid-cols-[1.1fr_1.2fr_.8fr_.9fr_.6fr_28px] gap-1.5 px-2 py-1.5 bg-background text-[11.5px] font-medium text-[#8A8A90]">
              <span>{multi ? form.optionLabel : 'Size'}</span><span>SKU</span><span>Cost</span><span>Price</span><span>Low at</span><span />
            </div>
            {visibleSizes.map((s) => (
              <div key={s.key} className="px-2 py-1.5 border-t border-border" data-size-row>
                <div className="grid grid-cols-[1.1fr_1.2fr_.8fr_.9fr_.6fr_28px] gap-1.5 items-start">
                  <div>
                    <input aria-label="Size name" value={s.name} onChange={(e) => setSize(s.key, { name: e.target.value })} placeholder={multi ? '500 ml' : 'Optional'}
                      className={`${cell} ${errors[`name:${s.key}`] ? 'border-error' : ''}`} />
                  </div>
                  <div className="relative">
                    <input aria-label="SKU" value={s.sku} onChange={(e) => setSize(s.key, { sku: e.target.value })} className={`${cell} font-data text-[12px]`} />
                    {!s.sku && form.name.trim() && (
                      <button type="button" onClick={() => setSize(s.key, { sku: makeSku(form.name, s.name, takenSkus(), form.brand) })} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] font-medium text-primary hover:underline bg-white pl-1">Make one</button>
                    )}
                  </div>
                  <input aria-label="Cost" inputMode="decimal" value={s.cost} onChange={(e) => setSize(s.key, { cost: e.target.value.replace(/[^\d.]/g, '') })} className={cell} placeholder="0" />
                  <input aria-label="Price" inputMode="decimal" value={s.price} onChange={(e) => setSize(s.key, { price: e.target.value.replace(/[^\d.]/g, '') })} className={`${cell} ${errors[`price:${s.key}`] ? 'border-error' : ''}`} placeholder="0" />
                  <input aria-label="Low at" inputMode="numeric" value={s.low} onChange={(e) => setSize(s.key, { low: e.target.value.replace(/\D/g, '') })} className={cell} placeholder="—" />
                  <button type="button" aria-label="More for this size" aria-expanded={!!more[s.key]} onClick={() => setMore((m) => ({ ...m, [s.key]: !m[s.key] }))} className="h-9 w-7 grid place-items-center text-[#8A8A90] hover:text-text-primary"><Icon name="MoreHorizontal" size={15} /></button>
                </div>
                {(errors[`name:${s.key}`] || errors[`price:${s.key}`]) && <p role="alert" className="mt-1 text-xs text-error">{errors[`name:${s.key}`] || errors[`price:${s.key}`]}</p>}
                {more[s.key] && (
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-2 mt-2 items-end">
                    <label className="text-[11.5px] text-[#8A8A90]">Barcode<input value={s.barcode} onChange={(e) => setSize(s.key, { barcode: e.target.value })} className={`${cell} mt-0.5 font-data text-[12px]`} /></label>
                    <label className="text-[11.5px] text-[#8A8A90]">Reorder qty<input inputMode="numeric" value={s.reorder} onChange={(e) => setSize(s.key, { reorder: e.target.value.replace(/\D/g, '') })} className={`${cell} mt-0.5`} placeholder="—" /></label>
                    {visibleSizes.length > 1 && (
                      <button type="button" onClick={() => setForm((f) => ({ ...f, sizes: f.sizes.filter((x) => x.key !== s.key) }))} className="h-9 px-2 text-[12.5px] text-error hover:underline whitespace-nowrap">Remove size</button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          {errors.sizes && <p role="alert" className="mt-1.5 text-xs text-error">{errors.sizes}</p>}
          <div className="flex items-center justify-between gap-3 flex-wrap mt-2">
            <button type="button" onClick={() => set({ sizes: [...form.sizes, blankSize()] })} className="text-[13px] font-medium text-primary hover:underline inline-flex items-center gap-1"><Icon name="Plus" size={13} />Add another size</button>
            <span className="text-xs text-[#8A8A90] tabular-nums" data-margins>{margins.some((m) => m != null) ? `Margin${margins.filter((m) => m != null).length > 1 ? 's' : ''}: ${marginRange(margins)}` : 'Add cost and price to see the margin'}</span>
          </div>
        </div>

        <SwitchRow id="prd-sell" label="Sell at checkout" description="Turn off for pro-use items you only use in the work." checked={form.sell} onChange={(v) => set({ sell: v })} />
        {form.sell && <SwitchRow id="prd-earns" label="Earns commission" description="Whoever sold it earns their product commission on this item. Turn off for items that should not count." checked={form.earns} onChange={(v) => set({ earns: v })} />}
        <SwitchRow id="prd-track" label="Count stock" description="Off for things you don't count, like candles you restock by eye." checked={form.track} onChange={(v) => set({ track: v })} />
        {form.track && <SwitchRow id="prd-notify" label="Tell me when it runs low" description="Managers of that branch get a notification, and it shows in Needs you now." checked={form.notify} onChange={(v) => set({ notify: v })} />}

        {!editing && form.track && (
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <p className="font-body font-body-medium text-[13px] text-text-primary">Opening stock</p>
              <span className="text-xs text-[#8A8A90]">what&apos;s on the shelf now</span>
            </div>
            <div className="border border-border rounded-spa overflow-hidden" data-opening>
              <div className="grid items-center gap-2 px-3 py-1.5 bg-background text-[11.5px] font-medium text-[#8A8A90]" style={{ gridTemplateColumns: `minmax(0,1fr) repeat(${visibleSizes.length}, 76px)` }}>
                <span>Branch</span>
                {visibleSizes.map((s) => <span key={s.key} className="text-right truncate" title={s.name}>{multi ? (s.name || 'Size') : 'Qty'}</span>)}
              </div>
              {branches.map((b) => (
                <div key={b.id} className="grid items-center gap-2 px-3 py-2 border-t border-border" style={{ gridTemplateColumns: `minmax(0,1fr) repeat(${visibleSizes.length}, 76px)` }}>
                  <span className="text-[13px] text-text-primary truncate">{b.name}{b.id === branchId && <HereTag />}</span>
                  {visibleSizes.map((s) => (
                    <input key={s.key} aria-label={`${b.name} ${s.name || 'opening stock'}`} inputMode="numeric" value={opening[`${b.id}:${s.key}`] || ''} placeholder="0"
                      onChange={(e) => setOpening((o) => ({ ...o, [`${b.id}:${s.key}`]: e.target.value.replace(/\D/g, '').slice(0, 6) }))} className={`${cell} text-right`} />
                  ))}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[12.5px] text-[#8A8A90]">One size? Just fill the first row; the product looks like any single item. “Sizes differ by” can be Size, Shade, Colour or anything you name. After this, stock changes go through Receive, Remove and Set the real count.</p>
          </div>
        )}
        {editing && form.track && <p className="text-[12.5px] text-[#8A8A90]">To change how many are on the shelf, use Receive, Remove or Set the real count from the product.</p>}
      </FormBody>
    </PanelShell>
  );
};

export default ProductFormPanel;
