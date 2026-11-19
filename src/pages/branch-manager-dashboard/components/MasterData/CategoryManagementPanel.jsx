import React, { useState, useEffect, useCallback, useRef } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import ConfirmDialog from '../../../../components/ui/ConfirmDialog';
import { useFlashRow, rowTone, rowBar } from '../../../../components/ui/PanelFormKit';
import CategoryFormPanel from './CategoryFormPanel';
import { friendlyError } from '../../../../utils/friendlyError';
import FilterBar from '../../../../components/ui/FilterBar';
import {
  fetchCategoriesForManagement,
  toggleCategoryActive,
  deleteCategory,
} from '../../../../services/api';

const CategoryManagementPanel = () => {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [panel, setPanel] = useState(null); // { category? } while the New / Edit panel is open
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [flashId, flash] = useFlashRow();

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

  const hasLoadedRef = useRef(false);
  const loadCategories = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true);
    setError(null);
    const result = await fetchCategoriesForManagement();
    if (result.error) {
      setError(result.error.message || 'Failed to load categories.');
    } else {
      setCategories(result.data || []);
    }
    hasLoadedRef.current = true;
    setLoading(false);
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  const handleToggle = async (category) => {
    if (category.is_active) {
      setConfirmToggle(category);
      return;
    }
    await executeToggle(category, true);
  };

  const executeToggle = async (category, newState) => {
    setError(null);
    setToggling(true);
    const result = await toggleCategoryActive({ categoryId: category.id, isActive: newState });
    setToggling(false);
    if (result.error) {
      setError(friendlyError(result.error, 'Toggle failed.'));
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
        setError(friendlyError(result.error, 'Delete failed.'));
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
        <Button variant="primary" size="sm" iconName="Plus" iconSize={16} onClick={() => setPanel({})}>
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
                  {categories.length === 0 ? (
                    <>No categories yet. <button type="button" onClick={() => setPanel({})} className="text-primary font-body-medium hover:underline">Add the first category</button></>
                  ) : 'No categories match your filters.'}
                </td>
              </tr>
            ) : (
              filteredCategories.map((c) => (
                <tr key={c.id} aria-selected={panel?.category?.id === c.id || undefined} className={`border-b border-border last:border-b-0 ${rowTone(panel?.category?.id === c.id, flashId === c.id)}`}>
                  <td className={`px-4 py-3 font-body font-body-medium text-sm text-text-primary ${rowBar(panel?.category?.id === c.id || flashId === c.id)}`}>{c.name}</td>
                  <td className="px-4 py-3 font-body text-sm text-text-secondary hidden md:table-cell max-w-[250px] truncate">
                    {c.description || '—'}
                  </td>
                  <td className="px-4 py-3 font-data text-sm text-text-primary">{c.service_count}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1 items-start">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-caption ${
                        c.is_active
                          ? 'bg-success/10 text-success'
                          : 'bg-text-secondary/10 text-text-secondary'
                      }`}>
                        {c.is_active ? 'Active' : 'Inactive'}
                      </span>
                      {c.offer_enabled && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-caption bg-warning/10 text-warning">
                          −{c.offer_percent}% (category)
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setPanel({ category: c })}
                        className="p-1.5 rounded hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
                        title="Edit"
                      >
                        <Icon name="Pencil" size={16} />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(c)}
                        className="p-1.5 rounded hover:bg-error/10 spa-transition-fast text-text-secondary hover:text-error"
                        title={c.service_count > 0 ? `Used by ${c.service_count} service${c.service_count === 1 ? '' : 's'}. Reassign them or deactivate the category instead.` : 'Delete'}
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

      {confirmToggle && (
        <ConfirmDialog
          title="Deactivate category?"
          message={`"${confirmToggle.name}" will be hidden from service dropdowns.`}
          confirmLabel="Deactivate"
          requireReason={false}
          isSubmitting={toggling}
          onConfirm={() => executeToggle(confirmToggle, false)}
          onClose={() => !toggling && setConfirmToggle(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete category?"
          message={confirmDelete.service_count > 0
            ? `"${confirmDelete.name}" has ${confirmDelete.service_count} service${confirmDelete.service_count === 1 ? '' : 's'} and can't be deleted. Reassign the services first or deactivate the category.`
            : `"${confirmDelete.name}" will be permanently deleted.`}
          confirmLabel="Delete"
          requireReason={false}
          isSubmitting={deleting}
          onConfirm={handleDelete}
          onClose={() => !deleting && setConfirmDelete(null)}
        />
      )}

      {panel && (
        <CategoryFormPanel
          category={panel.category}
          onClose={() => setPanel(null)}
          onSaved={(id, isNew) => { setPanel(null); loadCategories(); if (isNew && id) flash(id); }}
        />
      )}
    </div>
  );
};

export default CategoryManagementPanel;
