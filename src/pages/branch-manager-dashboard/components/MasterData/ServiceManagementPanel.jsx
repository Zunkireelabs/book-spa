import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import {
  fetchServicesForManagement,
  createService,
  updateServicePricing,
  toggleServiceActive,
  deleteService,
} from '../../../../services/api';

const ServiceManagementPanel = () => {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [formData, setFormData] = useState({ name: '', priceNpr: '', durationMinutes: '', description: '' });
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

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

  useEffect(() => { loadServices(); }, [loadServices]);

  const handleOpenCreate = () => {
    setEditingService(null);
    setFormData({ name: '', priceNpr: '', durationMinutes: '', description: '' });
    setFormError(null);
    setShowModal(true);
  };

  const handleOpenEdit = (service) => {
    setEditingService(service);
    setFormData({
      name: service.name,
      priceNpr: String(service.price_npr),
      durationMinutes: String(service.duration_minutes),
      description: service.description || '',
    });
    setFormError(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    const price = Number(formData.priceNpr);
    const duration = Number(formData.durationMinutes);

    if (!editingService && !formData.name.trim()) {
      setFormError('Service name is required.');
      return;
    }
    if (!price || price <= 0) {
      setFormError('Price must be a positive number.');
      return;
    }
    if (!duration || duration <= 0 || !Number.isInteger(duration)) {
      setFormError('Duration must be a positive whole number.');
      return;
    }

    setSaving(true);
    setFormError(null);

    let result;
    if (editingService) {
      result = await updateServicePricing({
        serviceId: editingService.id,
        priceNpr: price,
        durationMinutes: duration,
        description: formData.description.trim() || null,
      });
    } else {
      result = await createService({
        name: formData.name.trim(),
        priceNpr: price,
        durationMinutes: duration,
        description: formData.description.trim() || null,
      });
    }

    if (result.error) {
      setFormError(result.error.message || 'Save failed.');
    } else {
      setShowModal(false);
      await loadServices();
    }
    setSaving(false);
  };

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

      {/* Table */}
      <div className="bg-surface border border-border rounded-spa overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-background border-b border-border">
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Service Name</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Duration</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Price</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary hidden md:table-cell">Description</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Status</th>
              <th className="text-right px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {services.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-secondary font-body text-sm">
                  No services found. Click "Add Service" to create one.
                </td>
              </tr>
            ) : (
              services.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-b-0 hover:bg-background/50 spa-transition-fast">
                  <td className="px-4 py-3 font-body font-body-medium text-sm text-text-primary">{s.name}</td>
                  <td className="px-4 py-3 font-body text-sm text-text-secondary">{s.duration_minutes} min</td>
                  <td className="px-4 py-3 font-data text-sm text-text-primary">{formatNPR(s.price_npr)}</td>
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

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
                {editingService ? 'Edit Service' : 'Add Service'}
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
              {/* Service name — editable for create, read-only for edit */}
              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">Service Name</label>
                {editingService ? (
                  <div className="px-3 py-2 bg-background rounded-spa border border-border font-body text-sm text-text-secondary">
                    {editingService.name}
                  </div>
                ) : (
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Deep Tissue Massage"
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block font-body font-body-medium text-sm text-text-primary">Price (NPR)</label>
                  <Input
                    type="number"
                    value={formData.priceNpr}
                    onChange={(e) => setFormData({ ...formData, priceNpr: e.target.value })}
                    placeholder="2000"
                    min="1"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block font-body font-body-medium text-sm text-text-primary">Duration (min)</label>
                  <Input
                    type="number"
                    value={formData.durationMinutes}
                    onChange={(e) => setFormData({ ...formData, durationMinutes: e.target.value })}
                    placeholder="60"
                    min="1"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Service description..."
                  rows={3}
                  className="w-full rounded-spa border border-border bg-background px-3 py-2 font-body text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary spa-transition-fast resize-none"
                />
              </div>

              <div className="p-3 bg-accent/5 border border-accent/20 rounded-spa">
                <p className="font-caption text-xs text-accent flex items-center gap-1.5">
                  <Icon name="Info" size={14} />
                  {editingService
                    ? 'Price and duration changes only affect future bookings. Historical bookings are protected by snapshot fields.'
                    : 'New services will be immediately available for booking across all branches.'}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>
                {editingService ? 'Save Changes' : 'Create Service'}
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
        </div>
      )}
    </div>
  );
};

export default ServiceManagementPanel;
