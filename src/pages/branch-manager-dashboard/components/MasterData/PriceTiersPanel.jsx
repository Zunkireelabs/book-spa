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
import SidePanel from '../../../../components/ui/SidePanel';
import ConfirmDialog from '../../../../components/ui/ConfirmDialog';
import { TextInput } from '../../../../components/ui/PanelFormKit';
import { useIndustry } from '../../../../hooks/useIndustry';
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

const ICON_BTN = 'w-[34px] h-[34px] rounded-spa border border-border bg-surface inline-flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-background';

const SortableTierRow = ({ tier, staffCount, staffWord, onRename, onOpenAssign, onDelete, readOnly }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tier.id, disabled: readOnly });
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
    <div ref={setNodeRef} style={style} className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border last:border-b-0 bg-surface" data-tier-row>
      {!readOnly && (
        <button type="button" {...attributes} {...listeners} aria-label={`Drag to reorder ${tier.name}`} className="p-1 -ml-1 rounded cursor-grab active:cursor-grabbing text-text-tertiary hover:text-text-primary">
          <Icon name="GripVertical" size={16} />
        </button>
      )}
      {editing ? (
        <input
          autoFocus
          aria-label={`Rename ${tier.name}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setValue(tier.name); setEditing(false); } }}
          className="flex-1 h-9 px-2.5 text-[13.5px] border border-primary rounded-spa bg-surface focus:outline-none"
        />
      ) : (
        <span className="flex-1 min-w-0 truncate font-body font-body-medium text-[13.5px] text-text-primary">{tier.name}</span>
      )}
      <span className="inline-flex items-center h-[22px] px-[9px] rounded-full bg-[#F3F4F1] text-[12px] text-[#3A3A3C] whitespace-nowrap">{staffCount} {staffCount === 1 ? staffWord.one : staffWord.many}</span>
      <button type="button" onClick={() => onOpenAssign(tier)} className="h-[34px] px-3 rounded-spa border border-border bg-surface text-[13px] font-medium text-text-primary hover:bg-background">
        {readOnly ? 'View' : 'Assign'}
      </button>
      {!readOnly && (
        <>
          <button type="button" onClick={() => setEditing(true)} className={ICON_BTN} aria-label={`Rename ${tier.name}`} title="Rename">
            <Icon name="Pencil" size={14} />
          </button>
          <button type="button" onClick={() => onDelete(tier)} className={`${ICON_BTN} hover:!text-error hover:!bg-error/10`} aria-label={`Delete ${tier.name}`} title="Delete">
            <Icon name="Trash2" size={14} />
          </button>
        </>
      )}
    </div>
  );
};

const PriceTiersPanel = ({ readOnly = false }) => {
  const { staffLabel, staffLabelPlural } = useIndustry();
  const staffWord = { one: staffLabel.toLowerCase(), many: staffLabelPlural.toLowerCase() };
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

  const impactSentence = confirmDelete && (
    <>
      {confirmDelete.staffCount > 0 && <>{confirmDelete.staffCount} {confirmDelete.staffCount === 1 ? staffWord.one : staffWord.many} will have no tier and charge the standard price. </>}
      {confirmDelete.servicePriceCount > 0 && <>{confirmDelete.servicePriceCount} service price{confirmDelete.servicePriceCount === 1 ? '' : 's'} set for this tier will be removed. </>}
      {confirmDelete.staffCount === 0 && confirmDelete.servicePriceCount === 0 && <>Nothing else is affected. </>}
      Appointments already booked keep their price.
    </>
  );

  return (
    <div className="space-y-4 max-w-3xl">
      {error && (
        <div role="alert" className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-[13px]">
          <Icon name="AlertCircle" size={16} />
          <span>Couldn't save the change. Nothing was changed. <span className="text-text-tertiary">({error})</span></span>
          <button type="button" onClick={() => { setError(null); load(); }} className="ml-auto underline font-medium">Try again</button>
        </div>
      )}

      {tiers.length === 0 ? (
        <div className="bg-surface border border-border rounded-spa-lg p-[18px] space-y-2" data-tiers-empty>
          <p className="font-heading font-heading-semibold text-[14px] text-text-primary">No price tiers yet</p>
          <p className="text-[12.5px] text-text-secondary leading-relaxed">Use tiers when the same service costs more with a senior {staffWord.one}. Skip them if every service has one price.</p>
          {!readOnly && (
            <div className="flex gap-2 max-w-sm pt-1">
              <TextInput value={newTierName} onChange={(e) => setNewTierName(e.target.value)} placeholder="Tier name (e.g. Senior)" aria-label="New tier name" />
              <Button variant="primary" size="sm" onClick={handleCreate} loading={creating}>Add the first tier</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-spa-lg overflow-hidden">
          <div className="px-3.5 pt-3.5 pb-1">
            <p className="mt-0.5 text-[12.5px] text-text-secondary">Named groups of {staffWord.many} that a service can price differently. Not the same as job title.</p>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={tiers.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              {tiers.map((tier) => (
                <SortableTierRow
                  key={tier.id}
                  tier={tier}
                  staffCount={staffCountByTier[tier.id] || 0}
                  staffWord={staffWord}
                  onRename={handleRename}
                  onOpenAssign={(t) => { setAssignTier(t); setAssignSearch(''); }}
                  onDelete={openDeleteConfirm}
                  readOnly={readOnly}
                />
              ))}
            </SortableContext>
          </DndContext>
          {!readOnly && (
            <div className="flex gap-2 px-3.5 py-2.5 bg-background border-t border-border">
              <TextInput value={newTierName} onChange={(e) => setNewTierName(e.target.value)} placeholder="New tier name" aria-label="New tier name" onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }} />
              <Button variant="primary" size="sm" onClick={handleCreate} loading={creating} className="flex-shrink-0">Add tier</Button>
            </div>
          )}
        </div>
      )}
      {tiers.length > 0 && !readOnly && <p className="text-[12px] text-text-secondary">Drag to reorder: the order is also the order in each service's price list.</p>}
      {readOnly && <p className="text-[12.5px] text-text-secondary" data-tiers-readonly>You can see the tiers, counts and who is in each tier. Only an admin can assign, rename, delete or add.</p>}

      {/* Assign team members: a docked side panel (B2.2 #2). Changes save at once. */}
      <SidePanel isOpen={!!assignTier} title={assignTier ? assignTier.name : ''} onClose={() => setAssignTier(null)}
        footer={<div className="flex justify-end"><Button variant="primary" size="sm" onClick={() => setAssignTier(null)}>Done</Button></div>}>
        {assignTier && (
          <div className="px-5 py-4 space-y-3">
            <TextInput value={assignSearch} onChange={(e) => setAssignSearch(e.target.value)} placeholder={`Search ${staffWord.many}`} aria-label={`Search ${staffWord.many}`} />
            <div className="border border-border rounded-spa-lg">
              {assignMatches.map((t) => {
                const currentName = tiers.find((x) => x.id === t.price_tier_id)?.name;
                return (
                  <label key={t.id} className="flex items-center gap-2.5 px-3 py-2 border-b border-[#F0F0EE] last:border-b-0 cursor-pointer text-[13px]">
                    <input type="checkbox" className="accent-primary w-4 h-4" checked={t.price_tier_id === assignTier.id} disabled={readOnly || assigning === t.id} onChange={() => handleToggleAssign(t)} />
                    <span className="flex-1 min-w-0 truncate">{t.name}</span>
                    <span className={`inline-flex items-center h-[22px] px-[9px] rounded-full text-[12px] ${t.price_tier_id === assignTier.id ? 'bg-[#E6EFE4] text-primary' : 'bg-[#F3F4F1] text-[#3A3A3C]'} ${currentName ? '' : 'text-text-tertiary'}`}>{currentName || 'No tier'}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-[12px] text-text-secondary">A {staffWord.one} has one tier. Ticking someone moves them out of their current tier. Changes save at once.</p>
          </div>
        )}
      </SidePanel>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${confirmDelete.tier.name}"?`}
          message={impactSentence}
          confirmLabel="Delete tier"
          cancelLabel="Cancel"
          requireReason={false}
          isSubmitting={deleting}
          onClose={() => !deleting && setConfirmDelete(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
};

export default PriceTiersPanel;
