import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import ConfirmDialog from '../../../../components/ui/ConfirmDialog';
import TherapistPositionsPanel from './TherapistPositionsPanel';
import TherapistTransferLogPanel from './TherapistTransferLogPanel';
import { friendlyError } from '../../../../utils/friendlyError';
import FilterBar from '../../../../components/ui/FilterBar';
import { useIndustry } from '../../../../hooks/useIndustry';
import {
  fetchTherapistsForManagement,
  toggleTherapistActive,
  deleteTherapist,
  updateTherapistOrder,
  fetchAllBranches,
  fetchStaffTransfers,
} from '../../../../services/api';

const SortableRow = ({ therapist, disabled, readOnly, showBranch, branchName, onEdit, onDelete, onToggle }) => {
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
  const navigate = useNavigate();
  const { orgSlug } = useParams();
  const { staffLabel, staffLabelPlural } = useIndustry();
  const [therapists, setTherapists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [orgBranches, setOrgBranches] = useState([]);
  const [showTransferLog, setShowTransferLog] = useState(false);
  const [transferLog, setTransferLog] = useState(null); // null while loading
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPosition, setSelectedPosition] = useState('all');
  const [selectedStaffType, setSelectedStaffType] = useState('all');
  const [showPositions, setShowPositions] = useState(false);
  const [customPositions, setCustomPositions] = useState([]);
  const [toggling, setToggling] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

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

  const hasLoadedRef = useRef(false);
  const loadTherapists = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true);
    setError(null);
    const result = await fetchTherapistsForManagement(branchId);
    if (result.error) {
      setError(result.error.message || 'Failed to load therapists.');
    } else {
      setTherapists(result.data || []);
    }
    hasLoadedRef.current = true;
    setLoading(false);
  }, [branchId]);

  useEffect(() => { loadTherapists(); }, [loadTherapists]);

  useEffect(() => {
    fetchAllBranches().then(({ data }) => setOrgBranches(data || []));
  }, []);

  const handleOpenTransferLog = async () => {
    setShowTransferLog(true);
    setTransferLog(null);
    const { data } = await fetchStaffTransfers();
    setTransferLog(data || []);
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

  const handleOpenCreate = () => navigate(`/${orgSlug}/staff/new`);
  const handleOpenEdit = (t) => navigate(`/${orgSlug}/staff/${t.id}`);

  const handleToggle = async (therapist) => {
    if (therapist.is_active) {
      setConfirmToggle(therapist);
      return;
    }
    await executeToggle(therapist, true);
  };

  const executeToggle = async (therapist, newState) => {
    setError(null);
    setToggling(true);
    const result = await toggleTherapistActive({ therapistId: therapist.id, isActive: newState });
    setToggling(false);
    if (result.error) {
      setError(friendlyError(result.error, 'Toggle failed.'));
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
      if (result.error.code === 'HAS_BOOKINGS' || /foreign key|23503/i.test(`${result.error.code || ''} ${result.error.message || ''}`)) {
        setError(`"${confirmDelete.name}" has booking history, so it can't be deleted. Deactivate it instead to hide it from new bookings.`);
      } else {
        setError(friendlyError(result.error, 'Delete failed.'));
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
    <>
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
              <Button variant="primary" size="sm" iconName="Plus" onClick={() => setShowPositions(true)}>
                Manage Positions
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
                      : (<>No {staffLabelPlural.toLowerCase()} yet.{!readOnly && <> <button type="button" onClick={handleOpenCreate} className="text-primary font-body-medium hover:underline">Add the first {staffLabel.toLowerCase()}</button></>}</>)
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
                    />
                  ))}
                </SortableContext>
              )}
            </tbody>
          </table>
        </DndContext>
      </div>
    </div>

      {confirmToggle && (
        <ConfirmDialog
          title={`Deactivate ${staffLabel.toLowerCase()}?`}
          message={`"${confirmToggle.name}" will be hidden from assignment but remain in historical booking records.`}
          confirmLabel="Deactivate"
          requireReason={false}
          isSubmitting={toggling}
          onConfirm={() => executeToggle(confirmToggle, false)}
          onClose={() => !toggling && setConfirmToggle(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${staffLabel.toLowerCase()}?`}
          message={`"${confirmDelete.name}" will be permanently deleted. This action cannot be undone. ${staffLabelPlural} with booking history cannot be deleted; deactivate them instead to hide them from new bookings.`}
          confirmLabel="Delete"
          requireReason={false}
          isSubmitting={deleting}
          onConfirm={handleDelete}
          onClose={() => !deleting && setConfirmDelete(null)}
        />
      )}

      {showTransferLog && (
        <TherapistTransferLogPanel log={transferLog} staffLabel={staffLabel} onClose={() => setShowTransferLog(false)} />
      )}

      {showPositions && !readOnly && (
        <TherapistPositionsPanel
          therapists={therapists}
          customPositions={customPositions}
          onCustomChange={setCustomPositions}
          onReload={loadTherapists}
          staffLabel={staffLabel}
          staffLabelPlural={staffLabelPlural}
          onClose={() => setShowPositions(false)}
        />
      )}
    </>
  );
};

export default TherapistManagementPanel;
