import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import FilterBar from '../../../../components/ui/FilterBar';
import {
  fetchServicesForManagement,
  fetchActiveCategories,
  toggleServiceActive,
  deleteService,
} from '../../../../services/api';

const ServiceManagementPanel = () => {
  const navigate = useNavigate();
  const { orgSlug } = useParams();
  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Filtered services
  const filteredServices = services.filter((service) => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!service.name.toLowerCase().includes(query)) {
        return false;
      }
    }
    // Category filter
    if (categoryFilter !== 'all' && service.category !== categoryFilter) {
      return false;
    }
    // Status filter
    if (statusFilter === 'active' && !service.is_active) {
      return false;
    }
    if (statusFilter === 'inactive' && service.is_active) {
      return false;
    }
    return true;
  });

  const loadCategories = useCallback(async () => {
    const result = await fetchActiveCategories();
    if (!result.error) {
      setCategories(result.data || []);
    }
  }, []);

  const loadServices = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchServicesForManagement();
    if (result.error) {
      setError(result.error.message || 'Failed to load services.');
    } else {
      setServices(result.data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCategories();
    loadServices();
  }, [loadCategories, loadServices]);

  const handleOpenCreate = () => navigate(`/${orgSlug}/services/new`);
  const handleOpenEdit = (service) => navigate(`/${orgSlug}/services/${service.id}`);

  const handleToggle = async (service) => {
    if (service.is_active) {
      setConfirmToggle(service);
      return;
    }
    await executeToggle(service, true);
  };

  const executeToggle = async (service, newState) => {
    setError(null);
    const result = await toggleServiceActive({ serviceId: service.id, isActive: newState });
    if (result.error) {
      setError(result.error.message || 'Toggle failed.');
    } else {
      await loadServices();
    }
    setConfirmToggle(null);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    setError(null);

    const result = await deleteService({ serviceId: confirmDelete.id });

    if (result.error) {
      if (result.error.code === 'HAS_BOOKINGS') {
        setError(`"${confirmDelete.name}" has booking history and cannot be deleted. Use the toggle to deactivate instead.`);
      } else {
        setError(result.error.message || 'Delete failed.');
      }
    } else {
      await loadServices();
    }

    setConfirmDelete(null);
    setDeleting(false);
  };

  const formatNPR = (amount) => `NPR ${Number(amount).toLocaleString('en-IN')}`;

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        <p className="font-body text-sm text-text-secondary">Loading services...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Service Management</h3>
          <p className="font-body text-sm text-text-secondary">
            {services.length} service{services.length !== 1 ? 's' : ''} configured — price changes affect future bookings only
          </p>
        </div>
        <Button variant="primary" size="sm" iconName="Plus" iconSize={16} onClick={handleOpenCreate}>
          Add Service
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
          placeholder: 'Search by service name...',
        }}
        filters={[
          {
            value: categoryFilter,
            onChange: setCategoryFilter,
            options: [
              { value: 'all', label: 'All Categories' },
              ...categories.map((cat) => ({ value: cat.name, label: cat.name })),
            ],
          },
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
        resultCount={{ filtered: filteredServices.length, total: services.length }}
        hasActiveFilters={searchQuery || categoryFilter !== 'all' || statusFilter !== 'all'}
        onClear={() => {
          setSearchQuery('');
          setCategoryFilter('all');
          setStatusFilter('all');
        }}
      />

      {/* Table */}
      <div className="bg-surface border border-border rounded-spa overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-background border-b border-border">
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Service Name</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary hidden lg:table-cell">Category</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Duration</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Price</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary hidden md:table-cell">Description</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Status</th>
              <th className="text-right px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredServices.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-text-secondary font-body text-sm">
                  {services.length === 0
                    ? 'No services found. Click "Add Service" to create one.'
                    : 'No services match your filters.'}
                </td>
              </tr>
            ) : (
              filteredServices.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-b-0 hover:bg-background/50 spa-transition-fast">
                  <td className="px-4 py-3 font-body font-body-medium text-sm text-text-primary">{s.name}</td>
                  <td className="px-4 py-3 font-body text-sm text-text-secondary hidden lg:table-cell">{s.category || 'Spa'}</td>
                  <td className="px-4 py-3 font-body text-sm text-text-secondary">{s.duration_minutes} min</td>
                  <td className="px-4 py-3 font-data text-sm text-text-primary">
                    {s.is_on_offer ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs text-text-tertiary line-through">{formatNPR(s.original_price_npr ?? s.price_npr)}</span>
                        <span className="flex items-center gap-1.5">
                          {formatNPR(s.effective_price_npr)}
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-caption bg-warning/10 text-warning">
                            {s.active_campaign_name
                              ? s.active_campaign_name
                              : s.offer_enabled
                              ? (s.offer_type === 'percent' ? `-${s.offer_value}%` : 'Offer')
                              : `-${s.category_offer_percent}%`}
                          </span>
                        </span>
                      </div>
                    ) : (
                      formatNPR(s.price_npr)
                    )}
                  </td>
                  <td className="px-4 py-3 font-body text-sm text-text-secondary hidden md:table-cell max-w-[200px] truncate">
                    {s.description || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-caption ${
                      s.is_active
                        ? 'bg-success/10 text-success'
                        : 'bg-text-secondary/10 text-text-secondary'
                    }`}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleOpenEdit(s)}
                        className="p-1.5 rounded hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
                        title="Edit"
                      >
                        <Icon name="Pencil" size={16} />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(s)}
                        className="p-1.5 rounded hover:bg-error/10 spa-transition-fast text-text-secondary hover:text-error"
                        title="Delete"
                      >
                        <Icon name="Trash2" size={16} />
                      </button>
                      <button
                        onClick={() => handleToggle(s)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full spa-transition-fast ${
                          s.is_active ? 'bg-success' : 'bg-border'
                        }`}
                        title={s.is_active ? 'Deactivate' : 'Activate'}
                      >
                        <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
                          s.is_active ? 'translate-x-6' : 'translate-x-1'
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

      {/* Deactivation Confirmation Dialog */}
      {confirmToggle && createPortal(
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => setConfirmToggle(null)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
                <Icon name="AlertTriangle" size={20} className="text-warning" />
              </div>
              <div>
                <h3 className="font-heading font-heading-semibold text-text-primary">Deactivate Service?</h3>
                <p className="font-body text-sm text-text-secondary">
                  "{confirmToggle.name}" will be hidden from new bookings but remain in historical records.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmToggle(null)}>Cancel</Button>
              <Button variant="warning" size="sm" onClick={() => executeToggle(confirmToggle, false)}>Deactivate</Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Delete Confirmation Dialog */}
      {confirmDelete && createPortal(
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                <Icon name="Trash2" size={20} className="text-error" />
              </div>
              <div>
                <h3 className="font-heading font-heading-semibold text-text-primary">Delete Service?</h3>
                <p className="font-body text-sm text-text-secondary">
                  "{confirmDelete.name}" will be permanently deleted. This action cannot be undone.
                </p>
              </div>
            </div>
            <p className="font-body text-xs text-text-tertiary bg-background rounded-spa p-2">
              Note: Services with booking history cannot be deleted. Use deactivation instead to hide them from new bookings.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)} disabled={deleting}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={handleDelete} loading={deleting}>Delete</Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default ServiceManagementPanel;
