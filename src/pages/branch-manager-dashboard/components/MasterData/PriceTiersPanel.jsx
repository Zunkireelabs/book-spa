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
import {
  fetchPriceTiers,
  createPriceTier,
  renamePriceTier,
  reorderPriceTiers,
  deletePriceTier,
  fetchPriceTierImpact,
  fetchTherapistsForTierAssignment,
  assignTherapistTier,
} from '../../../../services/api';

const SortableTierRow = ({ tier, staffCount, onRename, onOpenAssign, onDelete }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tier.id });
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(tier.name);

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const commitRename = () => {
    const trimmed = value.trim();
    setEditing(false);
    if (!trimmed || trimmed === tier.name) { setValue(tier.name); return; }
    onRename(tier.id, trimmed);
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 bg-surface">
      <button {...attributes} {...listeners} className="p-1 rounded cursor-grab active:cursor-grabbing text-text-secondary hover:text-text-primary hover:bg-background">
        <Icon name="GripVertical" size={16} />
      </button>
      {editing ? (
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setValue(tier.name); setEditing(false); } }}
          className="flex-1 px-2 py-1 text-sm border border-primary rounded bg-background focus:outline-none"
        />
      ) : (
        <span className="flex-1 font-body font-body-medium text-sm text-text-primary">{tier.name}</span>
      )}
      <button
        onClick={() => onOpenAssign(tier)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-body-medium hover:bg-primary/20"
        title="Assign staff to this tier"
      >
        <Icon name="Users" size={13} />
        {staffCount}
      </button>
      <button onClick={() => setEditing(true)} className="p-1.5 rounded hover:bg-background text-text-secondary hover:text-text-primary" title="Rename">
        <Icon name="Pencil" size={14} />
      </button>
      <button onClick={() => onDelete(tier)} className="p-1.5 rounded hover:bg-error/10 text-text-secondary hover:text-error" title="Delete">
        <Icon name="Trash2" size={14} />
      </button>
    </div>
  );
};

const PriceTiersPanel = ({ readOnly = false }) => {
  const [tiers, setTiers] = useState([]);
  const [therapists, setTherapists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [newTierName, setNewTierName] = useState('');
  const [creating, setCreating] = useState(false);

  const [assignTier, setAssignTier] = useState(null);
  const [assignSearch, setAssignSearch] = useState('');
  const [assigning, setAssigning] = useState(null); // therapistId currently being toggled

  const [confirmDelete, setConfirmDelete] = useState(null); // { tier, staffCount, servicePriceCount }
  const [deleting, setDeleting] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [tiersResult, therapistsResult] = await Promise.all([
      fetchPriceTiers(),
      fetchTherapistsForTierAssignment(),
    ]);
    if (tiersResult.error) {
      setError(tiersResult.error.message || 'Failed to load price tiers.');
    } else {
      setTiers(tiersResult.data || []);
    }
    setTherapists(therapistsResult.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const staffCountByTier = useMemo(() => {
    const map = {};
    therapists.forEach((t) => { if (t.price_tier_id) map[t.price_tier_id] = (map[t.price_tier_id] || 0) + 1; });
    return map;
  }, [therapists]);

  const handleCreate = async () => {
    const name = newTierName.trim();
    if (!name) return;
    setCreating(true);
    const result = await createPriceTier({ name });
    setCreating(false);
    if (result.error) {
      setError(result.error.message || 'Could not create tier.');
      return;
    }
    setNewTierName('');
    await load();
  };

  const handleRename = async (tierId, name) => {
    const result = await renamePriceTier({ tierId, name });
    if (result.error) {
      setError(result.error.message || 'Could not rename tier.');
      return;
    }
    await load();
  };

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tiers.findIndex((t) => t.id === active.id);
    const newIndex = tiers.findIndex((t) => t.id === over.id);
    const reordered = arrayMove(tiers, oldIndex, newIndex);
    setTiers(reordered);
    const result = await reorderPriceTiers({ orderedIds: reordered.map((t) => t.id) });
    if (result.error) {
      setError('Failed to save the new order. Reverting...');
      await load();
    }
  };

  const openDeleteConfirm = async (tier) => {
    const impact = await fetchPriceTierImpact({ tierId: tier.id });
    setConfirmDelete({ tier, staffCount: impact.data?.staffCount || 0, servicePriceCount: impact.data?.servicePriceCount || 0 });
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    const result = await deletePriceTier({ tierId: confirmDelete.tier.id });
    setDeleting(false);
    setConfirmDelete(null);
    if (result.error) {
      setError(result.error.message || 'Could not delete tier.');
      return;
    }
    await load();
  };

  const assignMatches = useMemo(() => {
    if (!assignTier) return [];
    const q = assignSearch.trim().toLowerCase();
    return therapists.filter((t) => !q || t.name.toLowerCase().includes(q));
  }, [assignTier, assignSearch, therapists]);

  const handleToggleAssign = async (therapist) => {
    if (!assignTier) return;
    const newTierId = therapist.price_tier_id === assignTier.id ? null : assignTier.id;
    setAssigning(therapist.id);
    const result = await assignTherapistTier({ therapistId: therapist.id, tierId: newTierId });
    setAssigning(null);
    if (result.error) {
      setError(result.error.message || 'Could not update staff assignment.');
      return;
    }
    setTherapists((prev) => prev.map((t) => (t.id === therapist.id ? { ...t, price_tier_id: newTierId } : t)));
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        <p className="font-body text-sm text-text-secondary">Loading price tiers...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Price tiers</h3>
          <p className="font-body text-sm text-text-secondary">
            Named staff groups a service can price differently — independent of job position.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={14} /></button>
        </div>
      )}

      <div className="bg-surface border border-border rounded-spa overflow-hidden">
        {tiers.length === 0 ? (
          <div className="px-4 py-8 text-center text-text-secondary font-body text-sm">
            No price tiers yet. Add one below.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={tiers.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              {tiers.map((tier) => (
                <SortableTierRow
                  key={tier.id}
                  tier={tier}
                  staffCount={staffCountByTier[tier.id] || 0}
                  onRename={handleRename}
                  onOpenAssign={(t) => { setAssignTier(t); setAssignSearch(''); }}
                  onDelete={openDeleteConfirm}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {!readOnly && (
        <div className="flex gap-2 max-w-sm">
          <Input value={newTierName} onChange={(e) => setNewTierName(e.target.value)} placeholder="New tier name (e.g. Senior)" />
          <Button variant="primary" size="sm" iconName="Plus" onClick={handleCreate} loading={creating}>Add tier</Button>
        </div>
      )}

      {/* Staff assignment popover */}
      {assignTier && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => setAssignTier(null)}>
          <div className="bg-surface rounded-spa-lg shadow-spa-modal w-full max-w-md p-6 space-y-3 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h4 className="font-heading font-heading-semibold text-base text-text-primary">Assign staff to "{assignTier.name}"</h4>
            <p className="font-body text-xs text-text-secondary">One tier per person — checking someone here moves them out of any other tier.</p>
            <Input value={assignSearch} onChange={(e) => setAssignSearch(e.target.value)} placeholder="Search staff..." />
            <div className="flex-1 overflow-y-auto border-t border-border -mx-6 px-6">
              {assignMatches.map((t) => (
                <label key={t.id} className="flex items-center gap-3 py-2.5 border-b border-border last:border-b-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={t.price_tier_id === assignTier.id}
                    disabled={assigning === t.id}
                    onChange={() => handleToggleAssign(t)}
                  />
                  <div className="flex-1">
                    <div className="font-body-medium text-sm text-text-primary">{t.name}</div>
                    <div className="text-xs text-text-tertiary">
                      {t.position || '—'}
                      {t.price_tier_id && t.price_tier_id !== assignTier.id && (
                        <span className="ml-1 italic">· currently {tiers.find((x) => x.id === t.price_tier_id)?.name || 'another tier'}</span>
                      )}
                    </div>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex justify-end pt-2">
              <Button variant="ghost" size="sm" onClick={() => setAssignTier(null)}>Done</Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="bg-surface rounded-spa-lg shadow-spa-modal w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                <Icon name="Trash2" size={20} className="text-error" />
              </div>
              <div>
                <h3 className="font-heading font-heading-semibold text-text-primary">Delete "{confirmDelete.tier.name}"?</h3>
              </div>
            </div>
            <p className="font-body text-sm text-text-secondary">
              {confirmDelete.staffCount > 0 && <>{confirmDelete.staffCount} staff member{confirmDelete.staffCount === 1 ? '' : 's'} will be un-tiered (back to charging the Unassigned rate). </>}
              {confirmDelete.servicePriceCount > 0 && <>{confirmDelete.servicePriceCount} service price{confirmDelete.servicePriceCount === 1 ? '' : 's'} set for this tier will be removed.</>}
              {confirmDelete.staffCount === 0 && confirmDelete.servicePriceCount === 0 && 'Nothing else is affected.'}
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

export default PriceTiersPanel;
