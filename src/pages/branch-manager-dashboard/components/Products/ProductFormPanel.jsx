import React, { useEffect, useMemo, useRef, useState } from 'react';
import CustomSelect from '../../../../components/ui/CustomSelect';
import {
  PanelShell, FormBody, Field, TextInput, MoneyInput, SwitchRow, InfoRows, InlineError, CONTROL, CONTROL_ERROR, controlA11y,
} from '../../../../components/ui/PanelFormKit';
import { createProduct, updateProduct, uploadProductImage, fetchActiveProductCategories } from '../../../../services/api';
import { friendlyError } from '../../../../utils/friendlyError';
import ImageDropzone from './ImageDropzone';
import ProductCategories from './ProductCategories';

const EMPTY = { name: '', description: '', category: '', priceNpr: '', trackStock: false };

// "New product" / "Edit product": the right-hand panel. Category management is a stacked view inside this same panel
// (back arrow), so the draft below stays mounted and intact. Callbacks: onClose(), onSaved(), onBack() (edit opened from the
// detail panel returns to it).
const ProductFormPanel = ({ product, canManageCategories, onClose, onSaved, onBack }) => {
  const editing = !!product;
  const original = useMemo(() => (editing ? {
    name: product.name,
    description: product.description || '',
    category: product.category || '',
    priceNpr: String(product.price_npr),
    trackStock: !!product.track_stock,
  } : EMPTY), [editing, product]);

  const [form, setForm] = useState(original);
  const [imageFile, setImageFile] = useState(null);
  const [imageUrl, setImageUrl] = useState(product?.image_url || '');
  const [imagePreview, setImagePreview] = useState(product?.image_url || null);
  const [imageError, setImageError] = useState(null);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [view, setView] = useState('form'); // 'form' | 'categories'
  const nameRef = useRef(null);
  const priceRef = useRef(null);

  const loadCategoryOptions = async () => {
    const result = await fetchActiveProductCategories();
    if (!result.error) setCategoryOptions((result.data || []).map((c) => ({ value: c.name, label: c.name })));
  };
  useEffect(() => { loadCategoryOptions(); }, []);

  // Focus the first editable field once the panel has slid in.
  useEffect(() => {
    const t = setTimeout(() => (editing ? priceRef.current : nameRef.current)?.focus({ preventScroll: true }), 260);
    return () => clearTimeout(t);
  }, [editing]);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setServerError(null); };
  const clearError = (k) => setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));

  const price = Number(form.priceNpr) || 0;
  const imageChanged = !!imageFile || (editing && (product.image_url || '') !== imageUrl);
  const changed = editing
    ? (form.description !== original.description || form.category !== original.category || form.priceNpr !== original.priceNpr
      || form.trackStock !== original.trackStock || imageChanged)
    : !!(form.name || form.description || form.category || form.priceNpr || form.trackStock || imageFile);

  const reason = editing
    ? (!changed ? 'No changes' : !(price > 0) ? 'Enter the price' : '')
    : (!form.name.trim() ? 'Enter the product name' : !(price > 0) ? 'Enter the price' : '');

  const submit = async () => {
    if (savingRef.current || reason || view !== 'form') return;
    if (!(price > 0)) {
      setErrors({ price: 'Price must be a positive number.' });
      priceRef.current?.focus({ preventScroll: true });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setServerError(null);

    let finalImageUrl = imageUrl.trim() || null;
    if (imageFile) {
      const uploadResult = await uploadProductImage(imageFile);
      if (uploadResult.error) {
        savingRef.current = false;
        setSaving(false);
        setImageError(friendlyError(uploadResult.error, 'Could not upload the image.'));
        document.getElementById('prd-image')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      finalImageUrl = uploadResult.url;
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      category: form.category.trim() || null,
      priceNpr: price,
      imageUrl: finalImageUrl,
      trackStock: form.trackStock,
    };
    const result = editing ? await updateProduct({ productId: product.id, ...payload }) : await createProduct(payload);
    savingRef.current = false;
    setSaving(false);
    if (result.error) { setServerError(friendlyError(result.error, 'Could not save the product.')); return; }
    onSaved();
  };

  // ⌘/Ctrl+Enter saves when the primary is enabled; Enter in a single-line field never does (this is not a <form>).
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitRef.current(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (view === 'categories') {
    return (
      <PanelShell variant="panel" title="Product categories" onClose={onClose} onBack={() => setView('form')} hideFooter>
        <ProductCategories onCategoriesChanged={loadCategoryOptions} />
      </PanelShell>
    );
  }

  const options = form.category && !categoryOptions.some((o) => o.value === form.category)
    ? [{ value: form.category, label: form.category }, ...categoryOptions]
    : categoryOptions;

  return (
    <PanelShell
      variant="panel"
      title={editing ? 'Edit product' : 'New product'}
      onClose={onClose}
      onBack={onBack}
      dirty={changed}
      busy={saving}
      reason={reason}
      primary={{ label: saving ? 'Saving…' : (editing ? 'Save changes' : 'Create product'), onClick: submit, disabled: !!reason, loading: saving }}
    >
      <FormBody>
        <InlineError message={serverError} />

        {editing ? (
          <InfoRows rows={[['Name', product.name]]} />
        ) : (
          <Field label="Name" required id="prd-name" error={errors.name}>
            <TextInput {...controlA11y('prd-name', errors.name)} ref={nameRef} error={errors.name} value={form.name} onChange={(e) => { set({ name: e.target.value }); clearError('name'); }} placeholder="e.g. Lavender massage oil" />
          </Field>
        )}

        <Field
          label="Category"
          id="prd-category"
          labelExtra={canManageCategories ? (
            <button type="button" onClick={() => setView('categories')} className="text-xs font-body-medium text-primary hover:underline whitespace-nowrap">Manage categories</button>
          ) : null}
        >
          <CustomSelect value={form.category} onChange={(v) => set({ category: v })} options={options} placeholder="No category" searchable size="md" />
        </Field>

        <Field label="Price" required id="prd-price" error={errors.price}>
          <MoneyInput {...controlA11y('prd-price', errors.price)} ref={priceRef} error={errors.price} value={form.priceNpr} onChange={(v) => { set({ priceNpr: v }); clearError('price'); }} />
        </Field>

        <SwitchRow
          id="prd-track"
          label="Track stock"
          description={form.trackStock ? 'Stock is tracked per branch. After saving, use Receive stock on this product to add the starting quantity at each branch.' : 'Off: the product can always be sold (unlimited).'}
          checked={form.trackStock}
          onChange={(v) => set({ trackStock: v })}
        />

        <Field label="Description" id="prd-description">
          <textarea
            id="prd-description"
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
            rows={3}
            placeholder="Optional"
            className="w-full px-3 py-2 text-[13px] border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
          />
        </Field>

        <Field label="Image" id="prd-image" error={imageError}>
          <ImageDropzone
            id="prd-image"
            previewUrl={imagePreview}
            error={imageError}
            onError={setImageError}
            disabled={saving}
            onPick={(file) => { setImageFile(file); setImagePreview(URL.createObjectURL(file)); }}
            onRemove={() => { setImageFile(null); setImagePreview(null); setImageUrl(''); setImageError(null); }}
          />
        </Field>
      </FormBody>
    </PanelShell>
  );
};

export default ProductFormPanel;
