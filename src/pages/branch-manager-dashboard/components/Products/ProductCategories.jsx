import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import ConfirmDialog from '../../../../components/ui/ConfirmDialog';
import { InlineError, CONTROL, CONTROL_ERROR } from '../../../../components/ui/PanelFormKit';
import {
  fetchProductCategoriesForManagement, createProductCategory, updateProductCategory, toggleProductCategoryActive, deleteProductCategory,
} from '../../../../services/api';
import { friendlyError } from '../../../../utils/friendlyError';

// The body of the "Product categories" panel: an add row on top, then one row per category with inline rename (Enter saves,
// Esc cancels), an active switch and delete (through a ConfirmDialog; a category that still has products can't be deleted).
// Used standalone and stacked inside the product form (the form's draft stays mounted underneath).
const ProductCategories = ({ onCategoriesChanged, readOnly = false, starters = [] }) => {
  const [categories, setCategories] = useState(null);
  const [error, setError] = useState(null);
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const addRef = useRef(null);
  const editRef = useRef(null);

  const load = useCallback(async () => {
    const result = await fetchProductCategoriesForManagement();
    if (result.error) { setError(friendlyError(result.error, 'Failed to load categories.')); setCategories([]); return; }
    setCategories(result.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setTimeout(() => addRef.current?.focus({ preventScroll: true }), 260); return () => clearTimeout(t); }, []);
  useEffect(() => { if (editingId) editRef.current?.focus(); }, [editingId]);

  const changed = async () => { await load(); onCategoriesChanged?.(); };

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) { setAddError('Enter a category name.'); return; }
    setAdding(true);
    const result = await createProductCategory({ name, description: null });
    setAdding(false);
    if (result.error) { setAddError(friendlyError(result.error, 'Could not add the category.')); return; }
    setNewName(''); setAddError(null);
    await changed();
    addRef.current?.focus({ preventScroll: true });
  };

  const addStarters = async () => {
    setAdding(true);
    for (const name of starters) { // eslint-disable-line no-restricted-syntax
      // eslint-disable-next-line no-await-in-loop
      await createProductCategory({ name, description: null });
    }
    setAdding(false);
    await changed();
  };

  const startEdit = (c) => { setEditingId(c.id); setEditName(c.name); setEditError(null); };
  const cancelEdit = () => { setEditingId(null); setEditError(null); };
  const saveEdit = async (c) => {
    const name = editName.trim();
    if (!name) { setEditError('Enter a category name.'); return; }
    if (name === c.name) { cancelEdit(); return; }
    setSavingId(c.id);
    const result = await updateProductCategory({ categoryId: c.id, name, description: c.description || null });
    setSavingId(null);
    if (result.error) { setEditError(friendlyError(result.error, 'Could not rename the category.')); return; }
    cancelEdit();
    await changed();
  };

  const handleToggle = async (c) => {
    setError(null);
    const result = await toggleProductCategoryActive({ categoryId: c.id, isActive: !c.is_active });
    if (result.error) { setError(friendlyError(result.error, 'Could not update the category.')); return; }
    await changed();
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    const result = await deleteProductCategory({ categoryId: confirmDelete.id });
    setDeleting(false);
    setConfirmDelete(null);
    if (result.error) { setError(friendlyError(result.error, 'Could not delete the category.')); return; }
    await changed();
  };

  return (
    <div className="px-5 py-5 space-y-4">
      <InlineError message={error} />

      {!readOnly && <div>
        <div className="flex gap-2">
          <input
            ref={addRef}
            type="text"
            aria-label="New category name"
            aria-invalid={addError ? true : undefined}
            value={newName}
            onChange={(e) => { setNewName(e.target.value); setAddError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
            placeholder="New category name"
            className={`${CONTROL} ${addError ? CONTROL_ERROR : ''}`}
          />
          <button type="button" onClick={handleAdd} disabled={adding || !newName.trim()} className="h-10 px-3 text-[13px] font-body font-body-medium bg-text-primary text-white rounded-spa hover:opacity-90 disabled:opacity-50 whitespace-nowrap inline-flex items-center gap-2">
            {adding && <div className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />}
            Add
          </button>
        </div>
        {addError && <p role="alert" className="mt-1.5 text-xs text-error">{addError}</p>}
      </div>}

      {categories === null ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading categories">
          {[0, 1, 2].map((i) => <div key={i} className="h-11 rounded-spa border border-border bg-background animate-pulse" />)}
        </div>
      ) : categories.length === 0 ? (
        <div className="py-10 text-center">
          <Icon name="Tags" size={26} className="text-text-tertiary mx-auto mb-2" />
          <p className="text-[13px] text-text-secondary">{readOnly ? 'No categories yet.' : 'No categories yet. Add the first one above.'}</p>
          {!readOnly && starters.length > 0 && (
            <button type="button" onClick={addStarters} disabled={adding} className="mt-3 text-[13px] font-medium text-primary hover:underline disabled:opacity-50" data-add-starters>Add the usual ones: {starters.slice(0, 3).join(', ')}{starters.length > 3 ? '…' : ''}</button>
          )}
        </div>
      ) : (
        <ul className="border border-border rounded-spa divide-y divide-border">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2 min-h-[44px]">
              <div className="flex-1 min-w-0">
                {editingId === c.id ? (
                  <>
                    <input
                      ref={editRef}
                      type="text"
                      aria-label={`Rename ${c.name}`}
                      value={editName}
                      onChange={(e) => { setEditName(e.target.value); setEditError(null); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); saveEdit(c); }
                        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
                      }}
                      onBlur={() => { if (!savingId) cancelEdit(); }}
                      disabled={savingId === c.id}
                      className={`${CONTROL} h-9 ${editError ? CONTROL_ERROR : ''}`}
                    />
                    {editError && <p role="alert" className="mt-1 text-xs text-error">{editError}</p>}
                  </>
                ) : (
                  <button type="button" onClick={() => !readOnly && startEdit(c)} title={readOnly ? undefined : 'Click to rename'} disabled={readOnly} className={`block max-w-full truncate text-left text-[13px] hover:underline ${c.is_active ? 'text-text-primary' : 'text-text-tertiary'}`}>{c.name}</button>
                )}
              </div>
              <span className="text-xs text-text-tertiary tabular-nums whitespace-nowrap">{c.product_count} product{c.product_count === 1 ? '' : 's'}</span>
              <button
                type="button"
                role="switch"
                aria-checked={c.is_active}
                disabled={readOnly}
                aria-label={`${c.is_active ? 'Deactivate' : 'Activate'} ${c.name}`}
                onClick={() => handleToggle(c)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${c.is_active ? 'bg-primary' : 'bg-border'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${c.is_active ? 'translate-x-4' : 'translate-x-1'}`} />
              </button>
              <button
                type="button"
                aria-label={`Delete ${c.name}`}
                title={c.product_count > 0 ? 'Move its products to another category first' : 'Delete'}
                disabled={c.product_count > 0}
                hidden={readOnly}
                onClick={() => setConfirmDelete(c)}
                className="w-7 h-7 flex items-center justify-center rounded-spa text-text-secondary hover:bg-error/10 hover:text-error disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
              >
                <Icon name="Trash2" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete category?"
          message={`"${confirmDelete.name}" will be permanently deleted.`}
          confirmLabel="Delete"
          requireReason={false}
          isSubmitting={deleting}
          onConfirm={handleDelete}
          onClose={() => !deleting && setConfirmDelete(null)}
        />
      )}
    </div>
  );
};

export default ProductCategories;
