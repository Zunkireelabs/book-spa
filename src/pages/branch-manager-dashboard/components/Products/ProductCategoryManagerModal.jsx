import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import {
  fetchProductCategoriesForManagement,
  createProductCategory,
  updateProductCategory,
  toggleProductCategoryActive,
  deleteProductCategory,
} from '../../../../services/api';

const EMPTY_FORM = { name: '', description: '' };

// A real place to create/rename/deactivate/delete product categories —
// closes the gap left by the Products form's category dropdown (starter
// list + whatever's already in use, no way to add a genuinely new one).
// Condensed into one modal (list + inline create/edit form) rather than a
// separate full page, since Products has no dedicated Setup section the
// way Services does.
const ProductCategoryManagerModal = ({ onClose, onCategoriesChanged }) => {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchProductCategoriesForManagement();
    if (result.error) {
      setError(result.error.message || 'Failed to load categories.');
    } else {
      setCategories(result.data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  const handleOpenCreate = () => {
    setEditingCategory(null);
    setFormData(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const handleOpenEdit = (category) => {
    setEditingCategory(category);
    setFormData({ name: category.name, description: category.description || '' });
    setFormError(null);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      setFormError('Category name is required.');
      return;
    }

    setSaving(true);
    setFormError(null);

    const result = editingCategory
      ? await updateProductCategory({ categoryId: editingCategory.id, name: formData.name.trim(), description: formData.description.trim() || null })
      : await createProductCategory({ name: formData.name.trim(), description: formData.description.trim() || null });

    if (result.error) {
      setFormError(result.error.message || 'Save failed.');
    } else {
      setShowForm(false);
      await loadCategories();
      onCategoriesChanged?.();
    }
    setSaving(false);
  };

  const handleToggle = async (category) => {
    setError(null);
    const result = await toggleProductCategoryActive({ categoryId: category.id, isActive: !category.is_active });
    if (result.error) {
      setError(result.error.message || 'Toggle failed.');
    } else {
      await loadCategories();
      onCategoriesChanged?.();
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    setError(null);
    const result = await deleteProductCategory({ categoryId: confirmDelete.id });
    if (result.error) {
      setError(result.error.message);
    } else {
      await loadCategories();
      onCategoriesChanged?.();
    }
    setConfirmDelete(null);
    setDeleting(false);
  };

  return createPortal(
    <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Manage Categories</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-background">
            <Icon name="X" size={20} className="text-text-secondary" />
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
            <Icon name="AlertCircle" size={16} />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={14} /></button>
          </div>
        )}

        {showForm ? (
          <div className="space-y-3 p-3 bg-background rounded-spa border border-border">
            {formError && (
              <div className="flex items-center gap-2 p-2 bg-error/10 border border-error/20 rounded-spa text-error text-xs">
                <Icon name="AlertCircle" size={14} />
                <span>{formError}</span>
              </div>
            )}
            <div className="space-y-1">
              <label className="block font-body font-body-medium text-sm text-text-primary">Category Name</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Skincare"
              />
            </div>
            <div className="space-y-1">
              <label className="block font-body font-body-medium text-sm text-text-primary">
                Description <span className="text-text-tertiary font-normal">(optional)</span>
              </label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional description..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>
                {editingCategory ? 'Save Changes' : 'Create Category'}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" iconName="Plus" iconSize={14} onClick={handleOpenCreate}>
            Add Category
          </Button>
        )}

        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto" />
          </div>
        ) : (
          <div className="border border-border rounded-spa overflow-hidden">
            {categories.length === 0 ? (
              <div className="px-4 py-8 text-center text-text-secondary font-body text-sm">
                No categories yet. Click "Add Category" to create one.
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="bg-background border-b border-border">
                    <th className="text-left px-3 py-2 font-body font-body-medium text-xs text-text-secondary">Name</th>
                    <th className="text-left px-3 py-2 font-body font-body-medium text-xs text-text-secondary">Products</th>
                    <th className="text-left px-3 py-2 font-body font-body-medium text-xs text-text-secondary">Status</th>
                    <th className="text-right px-3 py-2 font-body font-body-medium text-xs text-text-secondary">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2 font-body text-sm text-text-primary">{c.name}</td>
                      <td className="px-3 py-2 font-data text-sm text-text-secondary">{c.product_count}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-caption ${
                          c.is_active ? 'bg-success/10 text-success' : 'bg-text-secondary/10 text-text-secondary'
                        }`}>
                          {c.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={() => handleOpenEdit(c)} className="p-1 rounded hover:bg-background text-text-secondary hover:text-text-primary" title="Edit">
                            <Icon name="Pencil" size={14} />
                          </button>
                          <button
                            onClick={() => setConfirmDelete(c)}
                            className="p-1 rounded hover:bg-error/10 text-text-secondary hover:text-error"
                            title="Delete"
                            disabled={c.product_count > 0}
                          >
                            <Icon name="Trash2" size={14} className={c.product_count > 0 ? 'opacity-30' : ''} />
                          </button>
                          <button
                            onClick={() => handleToggle(c)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full spa-transition-fast ${c.is_active ? 'bg-success' : 'bg-border'}`}
                            title={c.is_active ? 'Deactivate' : 'Activate'}
                          >
                            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white spa-transition-fast transform ${c.is_active ? 'translate-x-4' : 'translate-x-1'}`} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-notification bg-black/50 flex items-center justify-center p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                <Icon name="Trash2" size={20} className="text-error" />
              </div>
              <div>
                <h3 className="font-heading font-heading-semibold text-text-primary">Delete Category?</h3>
                <p className="font-body text-sm text-text-secondary">"{confirmDelete.name}" will be permanently deleted.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)} disabled={deleting}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={handleDelete} loading={deleting}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

export default ProductCategoryManagerModal;
