import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import Select from '../../../../components/ui/Select';
import { useIndustry } from '../../../../hooks/useIndustry';
import {
  fetchTherapistsForManagement,
  createTherapist,
  updateTherapist,
  toggleTherapistActive,
  deleteTherapist,
  updateTherapistOrder,
} from '../../../../services/api';

const GENDER_OPTIONS = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
];

const SortableRow = ({ therapist, disabled, onEdit, onDelete, onToggle }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: therapist.id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className="border-b border-border last:border-b-0 hover:bg-background/50 spa-transition-fast"
    >
      {/* Drag handle */}
      <td className="px-2 py-3 w-8">
        {!disabled && (
          <button
            {...attributes}
            {...listeners}
            className="p-1 rounded cursor-grab active:cursor-grabbing text-text-secondary hover:text-text-primary hover:bg-background spa-transition-fast"
            title="Drag to reorder"
          >
            <Icon name="GripVertical" size={16} />
          </button>
        )}
      </td>
      <td className="px-4 py-3 font-body font-body-medium text-sm text-text-primary">{therapist.name}</td>
      <td className="px-4 py-3 font-body text-sm text-text-secondary">{therapist.gender}</td>
      <td className="px-4 py-3 hidden sm:table-cell">
        <div className="flex flex-wrap gap-1">
          {(therapist.specialties || []).length > 0 ? (
            therapist.specialties.map((s, i) => (
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
          therapist.is_active
            ? 'bg-success/10 text-success'
            : 'bg-text-secondary/10 text-text-secondary'
        }`}>
          {therapist.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => onEdit(therapist)}
            className="p-1.5 rounded hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
            title="Edit"
          >
            <Icon name="Pencil" size={16} />
          </button>
          <button
            onClick={() => onDelete(therapist)}
            className="p-1.5 rounded hover:bg-error/10 spa-transition-fast text-text-secondary hover:text-error"
            title="Delete"
          >
            <Icon name="Trash2" size={16} />
          </button>
          <button
            onClick={() => onToggle(therapist)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full spa-transition-fast ${
              therapist.is_active ? 'bg-success' : 'bg-border'
            }`}
            title={therapist.is_active ? 'Deactivate' : 'Activate'}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
              therapist.is_active ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
      </td>
    </tr>
  );
};

const TherapistManagementPanel = ({ branchId }) => {
  const { staffLabel, staffLabelPlural } = useIndustry();
  const [therapists, setTherapists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingTherapist, setEditingTherapist] = useState(null);
  const [formData, setFormData] = useState({ name: '', gender: 'Male', specialties: '' });
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const isSearching = searchQuery.trim().length > 0;

  const filteredTherapists = useMemo(() => {
    if (!isSearching) return therapists;
    const q = searchQuery.toLowerCase().trim();
    return therapists.filter(t => t.name.toLowerCase().includes(q));
  }, [therapists, searchQuery, isSearching]);

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

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = therapists.findIndex(t => t.id === active.id);
    const newIndex = therapists.findIndex(t => t.id === over.id);
    const reordered = arrayMove(therapists, oldIndex, newIndex);

    // Optimistic update
    setTherapists(reordered);

    const result = await updateTherapistOrder({
      branchId,
      orderedIds: reordered.map(t => t.id),
    });

    if (result.error) {
      setError('Failed to save order. Reverting...');
      await loadTherapists();
    }
  };

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

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    setError(null);

    const result = await deleteTherapist({ therapistId: confirmDelete.id });

    if (result.error) {
      if (result.error.code === 'HAS_BOOKINGS') {
        setError(`"${confirmDelete.name}" has booking history and cannot be deleted. Use the toggle to deactivate instead.`);
      } else {
        setError(result.error.message || 'Delete failed.');
      }
    } else {
      await loadTherapists();
    }

    setConfirmDelete(null);
    setDeleting(false);
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        <p className="font-body text-sm text-text-secondary">Loading {staffLabelPlural.toLowerCase()}...</p>
      </div>
    );
  }

  const countLabel = isSearching
    ? `${filteredTherapists.length} of ${therapists.length} ${therapists.length !== 1 ? staffLabelPlural.toLowerCase() : staffLabel.toLowerCase()}`
    : `${therapists.length} ${therapists.length !== 1 ? staffLabelPlural.toLowerCase() : staffLabel.toLowerCase()} configured`;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">{staffLabel} Management</h3>
          <p className="font-body text-sm text-text-secondary">{countLabel}</p>
        </div>
        <Button variant="primary" size="sm" iconName="Plus" onClick={handleOpenCreate}>
          Add {staffLabel}
        </Button>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
          <Icon name="Search" size={16} className="text-text-secondary" />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={`Search ${staffLabelPlural.toLowerCase()}...`}
          className="w-full pl-9 pr-9 py-2 bg-surface border border-border rounded-spa font-body text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary spa-transition-fast"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute inset-y-0 right-3 flex items-center text-text-secondary hover:text-text-primary"
          >
            <Icon name="X" size={16} />
          </button>
        )}
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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <table className="w-full">
            <thead>
              <tr className="bg-background border-b border-border">
                <th className="w-8 px-2 py-3" />
                <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Name</th>
                <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Gender</th>
                <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary hidden sm:table-cell">Specialties</th>
                <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Status</th>
                <th className="text-right px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTherapists.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-secondary font-body text-sm">
                    {isSearching
                      ? `No ${staffLabelPlural.toLowerCase()} match "${searchQuery}"`
                      : `No ${staffLabelPlural.toLowerCase()} found. Add your first ${staffLabel.toLowerCase()}.`
                    }
                  </td>
                </tr>
              ) : (
                <SortableContext items={filteredTherapists.map(t => t.id)} strategy={verticalListSortingStrategy}>
                  {filteredTherapists.map((t) => (
                    <SortableRow
                      key={t.id}
                      therapist={t}
                      disabled={isSearching}
                      onEdit={handleOpenEdit}
                      onDelete={setConfirmDelete}
                      onToggle={handleToggle}
                    />
                  ))}
                </SortableContext>
              )}
            </tbody>
          </table>
        </DndContext>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
                {editingTherapist ? `Edit ${staffLabel}` : `Add ${staffLabel}`}
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
                {editingTherapist ? 'Save Changes' : `Add ${staffLabel}`}
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
                <h3 className="font-heading font-heading-semibold text-text-primary">Deactivate {staffLabel}?</h3>
                <p className="font-body text-sm text-text-secondary">
                  "{confirmToggle.name}" will be hidden from assignment but remain in historical booking records.
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
                <h3 className="font-heading font-heading-semibold text-text-primary">Delete {staffLabel}?</h3>
                <p className="font-body text-sm text-text-secondary">
                  "{confirmDelete.name}" will be permanently deleted. This action cannot be undone.
                </p>
              </div>
            </div>
            <p className="font-body text-xs text-text-tertiary bg-background rounded-spa p-2">
              Note: {staffLabelPlural} with booking history cannot be deleted. Use deactivation instead to hide them from new bookings.
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

export default TherapistManagementPanel;
