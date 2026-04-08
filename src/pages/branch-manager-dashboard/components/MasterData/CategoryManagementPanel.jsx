import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import FilterBar from '../../../../components/ui/FilterBar';
import {
  fetchCategoriesForManagement,
  createCategory,
  updateCategory,
  toggleCategoryActive,
  deleteCategory,
} from '../../../../services/api';

const CategoryManagementPanel = () => {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Filtered categories
  const filteredCategories = categories.filter((category) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!category.name.toLowerCase().includes(query) &&
          !(category.description || '').toLowerCase().includes(query)) {
        return false;
      }
    }
    if (statusFilter === 'active' && !category.is_active) return false;
    if (statusFilter === 'inactive' && category.is_active) return false;
    return true;
  });

  const loadCategories = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchCategoriesForManagement();
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
    setFormData({ name: '', description: '' });
    setFormError(null);
    setShowModal(true);
  };

  const handleOpenEdit = (category) => {
    setEditingCategory(category);
    setFormData({
      name: category.name,
      description: category.description || '',
    });
    setFormError(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      setFormError('Category name is required.');
      return;
    }

    setSaving(true);
    setFormError(null);

    let result;
    if (editingCategory) {
      result = await updateCategory({
        categoryId: editingCategory.id,
        name: formData.name.trim(),
        description: formData.description.trim() || null,
      });
    } else {
      result = await createCategory({
        name: formData.name.trim(),
        description: formData.description.trim() || null,
      });
    }

    if (result.error) {
      setFormError(result.error.message || 'Save failed.');
    } else {
      setShowModal(false);
      await loadCategories();
    }
    setSaving(false);
  };

  const handleToggle = async (category) => {
    if (category.is_active) {
      setConfirmToggle(category);
      return;
    }
    await executeToggle(category, true);
  };

  const executeToggle = async (category, newState) => {
    setError(null);
    const result = await toggleCategoryActive({ categoryId: category.id, isActive: newState });
    if (result.error) {
      setError(result.error.message || 'Toggle failed.');
    } else {
      await loadCategories();
    }
    setConfirmToggle(null);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    setError(null);

    const result = await deleteCategory({ categoryId: confirmDelete.id });

    if (result.error) {
      if (result.error.code === 'HAS_SERVICES') {
        setError(result.error.message);
      } else {
        setError(result.error.message || 'Delete failed.');
      }
    } else {
      await loadCategories();
    }

    setConfirmDelete(null);
    setDeleting(false);
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        <p className="font-body text-sm text-text-secondary">Loading categories...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Category Management</h3>
          <p className="font-body text-sm text-text-secondary">
            {categories.length} categor{categories.length !== 1 ? 'ies' : 'y'} configured — used to organize services
          </p>
        </div>
        <Button variant="primary" size="sm" iconName="Plus" iconSize={16} onClick={handleOpenCreate}>
          Add Category
        </Button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={14} /></button>
        </div>
      )}

      {/* Filter Bar */}
      <FilterBar
        search={{
          value: searchQuery,
          onChange: setSearchQuery,
          placeholder: 'Search by category name...',
        }}
        filters={[
          {
            value: statusFilter,
            onChange: setStatusFilter,
            options: [
              { value: 'all', label: 'All Status' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ],
          },
        ]}
        resultCount={{ filtered: filteredCategories.length, total: categories.length }}
        hasActiveFilters={searchQuery || statusFilter !== 'all'}
        onClear={() => {
          setSearchQuery('');
          setStatusFilter('all');
        }}
      />

      {/* Table */}
      <div className="bg-surface border border-border rounded-spa overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-background border-b border-border">
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Category Name</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary hidden md:table-cell">Description</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Services</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Status</th>
              <th className="text-right px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredCategories.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-secondary font-body text-sm">
                  {categories.length === 0
                    ? 'No categories found. Click "Add Category" to create one.'
                    : 'No categories match your filters.'}
                </td>
              </tr>
            ) : (
              filteredCategories.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-b-0 hover:bg-background/50 spa-transition-fast">
                  <td className="px-4 py-3 font-body font-body-medium text-sm text-text-primary">{c.name}</td>
                  <td className="px-4 py-3 font-body text-sm text-text-secondary hidden md:table-cell max-w-[250px] truncate">
                    {c.description || '—'}
                  </td>
                  <td className="px-4 py-3 font-data text-sm text-text-primary">{c.service_count}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-caption ${
                      c.is_active
                        ? 'bg-success/10 text-success'
                        : 'bg-text-secondary/10 text-text-secondary'
                    }`}>
                      {c.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleOpenEdit(c)}
                        className="p-1.5 rounded hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
                        title="Edit"
                      >
                        <Icon name="Pencil" size={16} />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(c)}
                        className="p-1.5 rounded hover:bg-error/10 spa-transition-fast text-text-secondary hover:text-error"
                        title="Delete"
                        disabled={c.service_count > 0}
                      >
                        <Icon name="Trash2" size={16} className={c.service_count > 0 ? 'opacity-30' : ''} />
                      </button>
                      <button
                        onClick={() => handleToggle(c)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full spa-transition-fast ${
                          c.is_active ? 'bg-success' : 'bg-border'
                        }`}
                        title={c.is_active ? 'Deactivate' : 'Activate'}
                      >
                        <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
                          c.is_active ? 'translate-x-6' : 'translate-x-1'
                        }`} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
                {editingCategory ? 'Edit Category' : 'Add Category'}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-background">
                <Icon name="X" size={20} className="text-text-secondary" />
              </button>
            </div>

            {formError && (
              <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
                <Icon name="AlertCircle" size={16} />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">Category Name</label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Spa, Salon, Wellness"
                />
              </div>

              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description..."
                  rows={3}
                  className="w-full rounded-spa border border-border bg-background px-3 py-2 font-body text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary spa-transition-fast resize-none"
                />
              </div>

              {editingCategory && (
                <div className="p-3 bg-accent/5 border border-accent/20 rounded-spa">
                  <p className="font-caption text-xs text-accent flex items-center gap-1.5">
                    <Icon name="Info" size={14} />
                    Renaming a category will update all services using it.
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>
                {editingCategory ? 'Save Changes' : 'Create Category'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivation Confirmation Dialog */}
      {confirmToggle && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => setConfirmToggle(null)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
                <Icon name="AlertTriangle" size={20} className="text-warning" />
              </div>
              <div>
                <h3 className="font-heading font-heading-semibold text-text-primary">Deactivate Category?</h3>
                <p className="font-body text-sm text-text-secondary">
                  "{confirmToggle.name}" will be hidden from service dropdowns.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmToggle(null)}>Cancel</Button>
              <Button variant="warning" size="sm" onClick={() => executeToggle(confirmToggle, false)}>Deactivate</Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                <Icon name="Trash2" size={20} className="text-error" />
              </div>
              <div>
                <h3 className="font-heading font-heading-semibold text-text-primary">Delete Category?</h3>
                <p className="font-body text-sm text-text-secondary">
                  "{confirmDelete.name}" will be permanently deleted.
                </p>
              </div>
            </div>
            {confirmDelete.service_count > 0 && (
              <p className="font-body text-xs text-error bg-error/10 rounded-spa p-2">
                This category has {confirmDelete.service_count} service(s) and cannot be deleted. Reassign services first or deactivate the category.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)} disabled={deleting}>Cancel</Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleDelete}
                loading={deleting}
                disabled={confirmDelete.service_count > 0}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CategoryManagementPanel;
