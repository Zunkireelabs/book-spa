import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import Select from '../../../../components/ui/Select';
import {
  fetchTherapistsForManagement,
  createTherapist,
  updateTherapist,
  toggleTherapistActive,
} from '../../../../services/api';

const GENDER_OPTIONS = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
];

const TherapistManagementPanel = ({ branchId }) => {
  const [therapists, setTherapists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingTherapist, setEditingTherapist] = useState(null);
  const [formData, setFormData] = useState({ name: '', gender: 'Male', specialties: '' });
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(null);

  const loadTherapists = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchTherapistsForManagement(branchId);
    if (result.error) {
      setError(result.error.message || 'Failed to load therapists.');
    } else {
      setTherapists(result.data || []);
    }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { loadTherapists(); }, [loadTherapists]);

  const handleOpenCreate = () => {
    setEditingTherapist(null);
    setFormData({ name: '', gender: 'Male', specialties: '' });
    setFormError(null);
    setShowModal(true);
  };

  const handleOpenEdit = (t) => {
    setEditingTherapist(t);
    setFormData({
      name: t.name,
      gender: t.gender || 'Male',
      specialties: (t.specialties || []).join(', '),
    });
    setFormError(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      setFormError('Therapist name is required.');
      return;
    }

    setSaving(true);
    setFormError(null);

    const specialtiesArr = formData.specialties
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    let result;
    if (editingTherapist) {
      result = await updateTherapist({
        therapistId: editingTherapist.id,
        name: formData.name.trim(),
        gender: formData.gender,
        specialties: specialtiesArr,
      });
    } else {
      result = await createTherapist({
        name: formData.name.trim(),
        gender: formData.gender,
        specialties: specialtiesArr,
        branchId,
      });
    }

    if (result.error) {
      setFormError(result.error.message || 'Operation failed.');
    } else {
      setShowModal(false);
      await loadTherapists();
    }
    setSaving(false);
  };

  const handleToggle = async (therapist) => {
    if (therapist.is_active) {
      setConfirmToggle(therapist);
      return;
    }
    await executeToggle(therapist, true);
  };

  const executeToggle = async (therapist, newState) => {
    setError(null);
    const result = await toggleTherapistActive({ therapistId: therapist.id, isActive: newState });
    if (result.error) {
      setError(result.error.message || 'Toggle failed.');
    } else {
      await loadTherapists();
    }
    setConfirmToggle(null);
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        <p className="font-body text-sm text-text-secondary">Loading therapists...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Therapist Management</h3>
          <p className="font-body text-sm text-text-secondary">{therapists.length} therapist{therapists.length !== 1 ? 's' : ''} configured</p>
        </div>
        <Button variant="primary" size="sm" iconName="Plus" onClick={handleOpenCreate}>
          Add Therapist
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
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Name</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Gender</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary hidden sm:table-cell">Specialties</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Status</th>
              <th className="text-right px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {therapists.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-secondary font-body text-sm">
                  No therapists found. Add your first therapist.
                </td>
              </tr>
            ) : (
              therapists.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-b-0 hover:bg-background/50 spa-transition-fast">
                  <td className="px-4 py-3 font-body font-body-medium text-sm text-text-primary">{t.name}</td>
                  <td className="px-4 py-3 font-body text-sm text-text-secondary">{t.gender}</td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {(t.specialties || []).length > 0 ? (
                        t.specialties.map((s, i) => (
                          <span key={i} className="inline-flex px-2 py-0.5 rounded text-xs font-caption bg-primary/10 text-primary">
                            {s}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-text-secondary">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-caption ${
                      t.is_active
                        ? 'bg-success/10 text-success'
                        : 'bg-text-secondary/10 text-text-secondary'
                    }`}>
                      {t.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleOpenEdit(t)}
                        className="p-1.5 rounded hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
                        title="Edit"
                      >
                        <Icon name="Pencil" size={16} />
                      </button>
                      <button
                        onClick={() => handleToggle(t)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full spa-transition-fast ${
                          t.is_active ? 'bg-success' : 'bg-border'
                        }`}
                        title={t.is_active ? 'Deactivate' : 'Activate'}
                      >
                        <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
                          t.is_active ? 'translate-x-6' : 'translate-x-1'
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

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
                {editingTherapist ? 'Edit Therapist' : 'Add Therapist'}
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
                <label className="block font-body font-body-medium text-sm text-text-primary">Name</label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Anjali Thapa"
                  autoFocus
                />
              </div>

              <Select
                label="Gender"
                options={GENDER_OPTIONS}
                value={formData.gender}
                onChange={(val) => setFormData({ ...formData, gender: val })}
              />

              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">Specialties</label>
                <Input
                  value={formData.specialties}
                  onChange={(e) => setFormData({ ...formData, specialties: e.target.value })}
                  placeholder="e.g. Deep Tissue, Swedish (comma-separated)"
                />
                <p className="font-caption text-xs text-text-secondary">Separate multiple specialties with commas</p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>
                {editingTherapist ? 'Save Changes' : 'Add Therapist'}
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
                <h3 className="font-heading font-heading-semibold text-text-primary">Deactivate Therapist?</h3>
                <p className="font-body text-sm text-text-secondary">
                  "{confirmToggle.name}" will be hidden from therapist assignment but remain in historical booking records.
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
    </div>
  );
};

export default TherapistManagementPanel;
