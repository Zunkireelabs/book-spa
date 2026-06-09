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
import FilterBar from '../../../../components/ui/FilterBar';
import { useIndustry } from '../../../../hooks/useIndustry';
import {
  fetchTherapistsForManagement,
  createTherapist,
  updateTherapist,
  toggleTherapistActive,
  deleteTherapist,
  updateTherapistOrder,
  transferTherapist,
  fetchAllBranches,
  fetchStaffTransfers,
} from '../../../../services/api';

const GENDER_OPTIONS = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
];

const SortableRow = ({ therapist, disabled, readOnly, showBranch, branchName, onEdit, onDelete, onToggle, onTransfer }) => {
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
      {showBranch && (
        <td className="px-4 py-3 font-body text-sm text-text-secondary">{branchName || '—'}</td>
      )}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-body text-sm text-text-secondary">{therapist.position || '—'}</span>
          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
            therapist.is_service_staff !== false ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-500'
          }`}>
            {therapist.is_service_staff !== false ? 'Service' : 'Support'}
          </span>
        </div>
      </td>
      <td className="px-4 py-3 font-body text-sm text-text-secondary hidden sm:table-cell">{therapist.gender}</td>
      <td className="px-4 py-3 hidden md:table-cell">
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
        {readOnly ? (
          <div className="flex items-center justify-end text-text-secondary text-sm">—</div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => onEdit(therapist)}
              className="p-1.5 rounded hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
              title="Edit"
            >
              <Icon name="Pencil" size={16} />
            </button>
            <button
              onClick={() => onTransfer(therapist)}
              className="p-1.5 rounded hover:bg-background spa-transition-fast text-text-secondary hover:text-primary"
              title="Transfer to another branch"
            >
              <Icon name="ArrowRightLeft" size={16} />
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
        )}
      </td>
    </tr>
  );
};

const TherapistManagementPanel = ({ branchId, readOnly = false }) => {
  const { staffLabel, staffLabelPlural } = useIndustry();
  const [therapists, setTherapists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingTherapist, setEditingTherapist] = useState(null);
  const [formData, setFormData] = useState({ name: '', gender: 'Male', positions: [], specialties: '', isServiceStaff: true });
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [transferTarget, setTransferTarget] = useState(null);
  const [transferToBranch, setTransferToBranch] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [transferError, setTransferError] = useState(null);
  const [transferring, setTransferring] = useState(false);
  const [orgBranches, setOrgBranches] = useState([]);
  const [showTransferLog, setShowTransferLog] = useState(false);
  const [transferLog, setTransferLog] = useState([]);
  const [transferLogLoading, setTransferLogLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPosition, setSelectedPosition] = useState('all');
  const [selectedStaffType, setSelectedStaffType] = useState('all');
  const [showPositionModal, setShowPositionModal] = useState(false);
  const [newPosition, setNewPosition] = useState('');
  const [positionError, setPositionError] = useState(null);
  const [customPositions, setCustomPositions] = useState([]);
  const [editingPositionName, setEditingPositionName] = useState(null); // original name being edited
  const [editingPositionValue, setEditingPositionValue] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Individual position names (split compound ones like "Hairdresser/Beautician")
  const allPositionNames = useMemo(() => {
    const names = new Set();
    therapists.forEach(t => {
      if (t.position) t.position.split('/').forEach(p => names.add(p.trim()));
    });
    customPositions.forEach(p => names.add(p));
    return Array.from(names).sort();
  }, [therapists, customPositions]);

  const positionOptions = useMemo(() => {
    const positions = new Set();
    therapists.forEach(t => { if (t.position) positions.add(t.position); });
    customPositions.forEach(p => positions.add(p));
    return [
      { value: 'all', label: 'All Positions' },
      ...Array.from(positions).sort().map(p => ({ value: p, label: p })),
    ];
  }, [therapists, customPositions]);

  const branchNameById = useMemo(() => {
    const map = {};
    orgBranches.forEach(b => { map[b.id] = b.name; });
    return map;
  }, [orgBranches]);

  const hasActiveFilters = searchQuery.trim().length > 0 || selectedPosition !== 'all' || selectedStaffType !== 'all';

  const filteredTherapists = useMemo(() => {
    return therapists.filter(t => {
      const matchesSearch = !searchQuery.trim() || t.name.toLowerCase().includes(searchQuery.toLowerCase().trim());
      const matchesPosition = selectedPosition === 'all' || t.position === selectedPosition;
      const matchesType = selectedStaffType === 'all'
        || (selectedStaffType === 'service' && t.is_service_staff !== false)
        || (selectedStaffType === 'support' && t.is_service_staff === false);
      return matchesSearch && matchesPosition && matchesType;
    });
  }, [therapists, searchQuery, selectedPosition, selectedStaffType]);

  const isSearching = hasActiveFilters;

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

  useEffect(() => {
    fetchAllBranches().then(({ data }) => setOrgBranches(data || []));
  }, []);

  const handleOpenTransfer = (therapist) => {
    setTransferTarget(therapist);
    setTransferToBranch('');
    setTransferNote('');
    setTransferError(null);
  };

  const handleOpenTransferLog = async () => {
    setShowTransferLog(true);
    setTransferLogLoading(true);
    const { data } = await fetchStaffTransfers();
    setTransferLog(data || []);
    setTransferLogLoading(false);
  };

  const handleTransfer = async () => {
    if (!transferToBranch) {
      setTransferError('Select a destination branch.');
      return;
    }
    setTransferring(true);
    setTransferError(null);

    const result = await transferTherapist({
      therapistId: transferTarget.id,
      toBranchId: transferToBranch,
      note: transferNote.trim() || null,
    });

    if (result.error) {
      setTransferError(result.error.message || 'Transfer failed.');
    } else {
      setTransferTarget(null);
      await loadTherapists();
    }
    setTransferring(false);
  };

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
    setFormData({ name: '', gender: 'Male', positions: [], specialties: '', isServiceStaff: true });
    setFormError(null);
    setShowModal(true);
  };

  const handleOpenEdit = (t) => {
    setEditingTherapist(t);
    setFormData({
      name: t.name,
      gender: t.gender || 'Male',
      positions: t.position ? t.position.split('/').map(p => p.trim()) : [],
      specialties: (t.specialties || []).join(', '),
      isServiceStaff: t.is_service_staff !== false,
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
        position: formData.positions.length > 0 ? formData.positions.join('/') : null,
        specialties: specialtiesArr,
        isServiceStaff: formData.isServiceStaff,
      });
    } else {
      result = await createTherapist({
        name: formData.name.trim(),
        gender: formData.gender,
        position: formData.positions.length > 0 ? formData.positions.join('/') : null,
        specialties: specialtiesArr,
        isServiceStaff: formData.isServiceStaff,
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

  const handleRenamePosition = async (oldName, newName) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) { setEditingPositionName(null); return; }
    // Check duplicate
    if (allPositionNames.some(p => p.toLowerCase() === trimmed.toLowerCase() && p !== oldName)) {
      setPositionError('A position with this name already exists.');
      return;
    }
    // Update all therapists that have this position
    const affected = therapists.filter(t => t.position && t.position.split('/').map(p => p.trim()).includes(oldName));
    for (const t of affected) {
      const parts = t.position.split('/').map(p => p.trim());
      const updated = parts.map(p => p === oldName ? trimmed : p).join('/');
      await updateTherapist({ therapistId: t.id, position: updated });
    }
    // Update custom positions list
    setCustomPositions(prev => prev.map(p => p === oldName ? trimmed : p));
    setEditingPositionName(null);
    setPositionError(null);
    await loadTherapists();
  };

  const handleDeletePosition = async (posName) => {
    // Remove from all therapists that have this position
    const affected = therapists.filter(t => t.position && t.position.split('/').map(p => p.trim()).includes(posName));
    for (const t of affected) {
      const parts = t.position.split('/').map(p => p.trim()).filter(p => p !== posName);
      await updateTherapist({ therapistId: t.id, position: parts.length > 0 ? parts.join('/') : null });
    }
    // Remove from custom positions
    setCustomPositions(prev => prev.filter(p => p !== posName));
    await loadTherapists();
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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" iconName="History" onClick={handleOpenTransferLog}>
            Transfer Log
          </Button>
          {!readOnly && (
            <>
              <Button variant="primary" size="sm" iconName="Plus" onClick={() => { setShowPositionModal(true); setNewPosition(''); setPositionError(null); }}>
                Add Position
              </Button>
              <Button variant="primary" size="sm" iconName="Plus" onClick={handleOpenCreate}>
                Add {staffLabel}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Search & Position Filter */}
      <FilterBar
        search={{
          value: searchQuery,
          onChange: setSearchQuery,
          placeholder: `Search ${staffLabelPlural.toLowerCase()}...`,
        }}
        filters={[
          {
            value: selectedPosition,
            onChange: setSelectedPosition,
            options: positionOptions,
          },
          {
            value: selectedStaffType,
            onChange: setSelectedStaffType,
            options: [
              { value: 'all', label: 'All Types' },
              { value: 'service', label: 'Service Staff' },
              { value: 'support', label: 'Support Staff' },
            ],
          },
        ]}
        hasActiveFilters={hasActiveFilters}
        onClear={() => { setSearchQuery(''); setSelectedPosition('all'); setSelectedStaffType('all'); }}
      />

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
                {readOnly && <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Branch</th>}
                <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Position</th>
                <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary hidden sm:table-cell">Gender</th>
                <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary hidden md:table-cell">Specialties</th>
                <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Status</th>
                <th className="text-right px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTherapists.length === 0 ? (
                <tr>
                  <td colSpan={readOnly ? 8 : 7} className="px-4 py-8 text-center text-text-secondary font-body text-sm">
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
                      disabled={isSearching || readOnly}
                      readOnly={readOnly}
                      showBranch={readOnly}
                      branchName={branchNameById[t.branch_id]}
                      onEdit={handleOpenEdit}
                      onDelete={setConfirmDelete}
                      onToggle={handleToggle}
                      onTransfer={handleOpenTransfer}
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
                <label className="block font-body font-body-medium text-sm text-text-primary">
                  Position{formData.positions.length > 0 && <span className="ml-1 text-xs text-text-secondary font-normal">({formData.positions.join(', ')})</span>}
                </label>
                <div className="border border-border rounded-spa bg-background max-h-[120px] overflow-y-auto p-2 space-y-1">
                  {allPositionNames.length === 0 ? (
                    <p className="text-xs text-text-secondary px-2 py-1">No positions yet. Use "Add Position" to create one.</p>
                  ) : (
                    allPositionNames.map(pos => (
                      <label key={pos} className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-primary/5 ${formData.positions.includes(pos) ? 'bg-primary/5' : ''}`}>
                        <input
                          type="checkbox"
                          checked={formData.positions.includes(pos)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData(f => ({ ...f, positions: [...f.positions, pos] }));
                            } else {
                              setFormData(f => ({ ...f, positions: f.positions.filter(p => p !== pos) }));
                            }
                          }}
                          className="text-primary focus:ring-primary w-3.5 h-3.5 rounded"
                        />
                        <span className="font-body text-sm text-text-primary">{pos}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">Specialties</label>
                <Input
                  value={formData.specialties}
                  onChange={(e) => setFormData({ ...formData, specialties: e.target.value })}
                  placeholder="e.g. Deep Tissue, Swedish (comma-separated)"
                />
                <p className="font-caption text-xs text-text-secondary">Separate multiple specialties with commas</p>
              </div>

              <label className="flex items-center justify-between p-3 border border-border rounded-spa cursor-pointer hover:bg-background">
                <div>
                  <span className="font-body font-body-medium text-sm text-text-primary">Service Staff</span>
                  <p className="font-caption text-xs text-text-secondary">Can be assigned to bookings</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFormData(f => ({ ...f, isServiceStaff: !f.isServiceStaff }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full spa-transition-fast ${
                    formData.isServiceStaff ? 'bg-success' : 'bg-border'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
                    formData.isServiceStaff ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </label>
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

      {/* Transfer Modal */}
      {transferTarget && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => !transferring && setTransferTarget(null)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
                Transfer {staffLabel}
              </h3>
              <button onClick={() => !transferring && setTransferTarget(null)} className="p-1 rounded hover:bg-background">
                <Icon name="X" size={20} className="text-text-secondary" />
              </button>
            </div>

            <p className="font-body text-sm text-text-secondary">
              Move <span className="font-body-medium text-text-primary">"{transferTarget.name}"</span> to another branch.
              The {staffLabel.toLowerCase()} will appear in the destination branch's roster; existing bookings at the current branch are left in place.
            </p>

            {transferError && (
              <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
                <Icon name="AlertCircle" size={16} />
                <span>{transferError}</span>
              </div>
            )}

            <Select
              label="Destination Branch"
              placeholder="Select a branch..."
              options={orgBranches
                .filter(b => b.id !== transferTarget.branch_id)
                .map(b => ({ value: b.id, label: b.name }))}
              value={transferToBranch}
              onChange={setTransferToBranch}
            />

            <div className="space-y-1">
              <label className="block font-body font-body-medium text-sm text-text-primary">Note (optional)</label>
              <Input
                value={transferNote}
                onChange={(e) => setTransferNote(e.target.value)}
                placeholder="Reason for transfer..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setTransferTarget(null)} disabled={transferring}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleTransfer} loading={transferring}>Transfer</Button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Log Modal */}
      {showTransferLog && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => setShowTransferLog(false)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-heading-semibold text-lg text-text-primary">{staffLabel} Transfer Log</h3>
              <button onClick={() => setShowTransferLog(false)} className="p-1 rounded hover:bg-background">
                <Icon name="X" size={20} className="text-text-secondary" />
              </button>
            </div>

            {transferLogLoading ? (
              <div className="py-10 text-center">
                <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                <p className="font-body text-sm text-text-secondary">Loading transfer history...</p>
              </div>
            ) : transferLog.length === 0 ? (
              <div className="py-10 text-center">
                <Icon name="ArrowRightLeft" size={32} className="text-text-secondary mx-auto mb-3" />
                <p className="font-body text-sm text-text-secondary">No transfers recorded yet.</p>
              </div>
            ) : (
              <div className="border border-border rounded-spa overflow-hidden max-h-[60vh] overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0">
                    <tr className="bg-background border-b border-border">
                      <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Recorded</th>
                      <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">{staffLabel}</th>
                      <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">From → To</th>
                      <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Effective</th>
                      <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Status</th>
                      <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">By</th>
                      <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transferLog.map(t => (
                      <tr key={t.id} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-3 font-body text-sm text-text-secondary whitespace-nowrap">
                          {new Date(t.transferredAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-4 py-3 font-body font-body-medium text-sm text-text-primary">{t.therapistName}</td>
                        <td className="px-4 py-3 font-body text-sm text-text-secondary whitespace-nowrap">
                          {t.fromBranch} <span className="text-text-tertiary">→</span> {t.toBranch}
                        </td>
                        <td className="px-4 py-3 font-body text-sm text-text-secondary whitespace-nowrap">
                          {t.effectiveDate
                            ? (() => { const [y, m, d] = t.effectiveDate.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); })()
                            : '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-caption font-caption-medium ${
                            t.applied ? 'bg-success/10 text-success' : 'bg-accent/10 text-accent'
                          }`}>
                            <Icon name={t.applied ? 'CheckCircle' : 'Clock'} size={12} />
                            {t.applied ? 'Applied' : 'Scheduled'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-body text-sm text-text-secondary">{t.transferredBy}</td>
                        <td className="px-4 py-3 font-body text-sm text-text-secondary">{t.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Manage Positions Modal */}
      {showPositionModal && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => setShowPositionModal(false)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Manage Positions</h3>
              <button onClick={() => setShowPositionModal(false)} className="p-1 rounded hover:bg-background">
                <Icon name="X" size={20} className="text-text-secondary" />
              </button>
            </div>

            {/* Existing positions */}
            {allPositionNames.length > 0 && (
              <div className="space-y-1.5">
                <label className="block font-body font-body-medium text-xs text-text-secondary uppercase">Existing Positions</label>
                <div className="border border-border rounded-spa bg-background max-h-[180px] overflow-y-auto divide-y divide-border">
                  {allPositionNames.map(pos => {
                    const staffCount = therapists.filter(t => t.position && t.position.split('/').map(p => p.trim()).includes(pos)).length;
                    const isEditing = editingPositionName === pos;
                    return (
                      <div key={pos} className="flex items-center justify-between px-3 py-2 gap-2">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editingPositionValue}
                            onChange={(e) => setEditingPositionValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenamePosition(pos, editingPositionValue);
                              if (e.key === 'Escape') setEditingPositionName(null);
                            }}
                            autoFocus
                            className="flex-1 px-2 py-1 text-sm border border-primary rounded bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        ) : (
                          <div className="flex-1 min-w-0">
                            <span className="font-body text-sm text-text-primary">{pos}</span>
                            <span className="ml-2 text-xs text-text-secondary">({staffCount} staff)</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => handleRenamePosition(pos, editingPositionValue)}
                                className="p-1 rounded hover:bg-success/10 text-success"
                                title="Save"
                              >
                                <Icon name="Check" size={14} />
                              </button>
                              <button
                                onClick={() => setEditingPositionName(null)}
                                className="p-1 rounded hover:bg-background text-text-secondary"
                                title="Cancel"
                              >
                                <Icon name="X" size={14} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => { setEditingPositionName(pos); setEditingPositionValue(pos); setPositionError(null); }}
                                className="p-1 rounded hover:bg-background text-text-secondary hover:text-text-primary"
                                title="Edit position"
                              >
                                <Icon name="Pencil" size={14} />
                              </button>
                              <button
                                onClick={() => handleDeletePosition(pos)}
                                className="p-1 rounded hover:bg-error/10 text-text-secondary hover:text-error"
                                title="Delete position"
                              >
                                <Icon name="Trash2" size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Add new position */}
            {positionError && (
              <div className="flex items-center gap-2 p-2 bg-error/10 border border-error/20 rounded-spa text-error text-xs">
                <Icon name="AlertCircle" size={14} />
                <span>{positionError}</span>
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={newPosition}
                onChange={(e) => { setNewPosition(e.target.value); setPositionError(null); }}
                placeholder="New position name..."
                className="flex-1"
              />
              <Button variant="primary" size="sm" onClick={() => {
                const name = newPosition.trim();
                if (!name) { setPositionError('Position name is required.'); return; }
                const exists = allPositionNames.some(p => p.toLowerCase() === name.toLowerCase());
                if (exists) { setPositionError('This position already exists.'); return; }
                setCustomPositions(prev => [...prev, name]);
                setNewPosition('');
                setPositionError(null);
              }}>
                Add
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TherapistManagementPanel;
