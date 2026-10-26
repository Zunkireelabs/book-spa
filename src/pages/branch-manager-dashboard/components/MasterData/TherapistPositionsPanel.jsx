import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import ConfirmDialog from '../../../../components/ui/ConfirmDialog';
import { PanelShell, FormBody, InlineError, CONTROL, CONTROL_ERROR } from '../../../../components/ui/PanelFormKit';
import { updateTherapist } from '../../../../services/api';
import { friendlyError } from '../../../../utils/friendlyError';

// `inline` renders the editor as the page's Positions tab (V28); otherwise it is the right-hand panel it used to be.
const Wrap = ({ inline, onClose, children }) => (inline
  ? <div className="max-w-[640px] pt-4 space-y-4">{children}</div>
  : <PanelShell variant="panel" title="Manage positions" onClose={onClose} hideFooter><FormBody>{children}</FormBody></PanelShell>);

const parts = (position) => (position ? position.split('/').map((p) => p.trim()) : []);

// "Manage positions" in the right-hand panel: an add row on top, then one row per position with inline rename (Enter saves,
// Esc cancels) and delete (through a ConfirmDialog, since it edits every staff member holding the position).
// A position exists because staff hold it; a newly added one lives in the filter list until a staff member is given it.
const TherapistPositionsPanel = ({ therapists, customPositions, onCustomChange, onReload, staffLabel = 'Staff', staffLabelPlural = 'Staff', onClose, inline = false }) => {
  const names = useMemo(() => {
    const set = new Set();
    therapists.forEach((t) => parts(t.position).forEach((p) => set.add(p)));
    customPositions.forEach((p) => set.add(p));
    return Array.from(set).sort();
  }, [therapists, customPositions]);

  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState(null);
  const [editing, setEditing] = useState(null); // original name
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const addRef = useRef(null);
  const editRef = useRef(null);

  useEffect(() => { const t = setTimeout(() => addRef.current?.focus({ preventScroll: true }), 260); return () => clearTimeout(t); }, []);
  useEffect(() => { if (editing) editRef.current?.focus(); }, [editing]);

  const holders = (pos) => therapists.filter((t) => parts(t.position).includes(pos));

  const add = () => {
    const name = newName.trim();
    if (!name) { setAddError('Enter a position name.'); return; }
    if (names.some((p) => p.toLowerCase() === name.toLowerCase())) { setAddError('This position already exists.'); return; }
    onCustomChange((prev) => [...prev, name]);
    setNewName('');
    setAddError(null);
    addRef.current?.focus({ preventScroll: true });
  };

  const rename = async (oldName) => {
    const name = editValue.trim();
    if (!name || name === oldName) { setEditing(null); setEditError(null); return; }
    if (names.some((p) => p.toLowerCase() === name.toLowerCase() && p !== oldName)) { setEditError('A position with this name already exists.'); return; }
    setBusy(true);
    setError(null);
    for (const t of holders(oldName)) {
      const updated = parts(t.position).map((p) => (p === oldName ? name : p)).join('/');
      const result = await updateTherapist({ therapistId: t.id, position: updated });
      if (result.error) { setBusy(false); setEditing(null); setError(friendlyError(result.error, `Could not rename the position for ${t.name}.`)); await onReload(); return; }
    }
    onCustomChange((prev) => prev.map((p) => (p === oldName ? name : p)));
    setBusy(false);
    setEditing(null);
    setEditError(null);
    await onReload();
  };

  const remove = async () => {
    const pos = confirmDelete;
    setBusy(true);
    setError(null);
    for (const t of holders(pos)) {
      const rest = parts(t.position).filter((p) => p !== pos);
      const result = await updateTherapist({ therapistId: t.id, position: rest.length > 0 ? rest.join('/') : null });
      if (result.error) { setBusy(false); setConfirmDelete(null); setError(friendlyError(result.error, `Could not update ${t.name}.`)); await onReload(); return; }
    }
    onCustomChange((prev) => prev.filter((p) => p !== pos));
    setBusy(false);
    setConfirmDelete(null);
    await onReload();
  };

  const deleteCount = confirmDelete ? holders(confirmDelete).length : 0;
  return (
    <>
      <Wrap inline={inline} onClose={onClose}>
        <>
          <InlineError message={error} />
          <div>
            <div className="flex gap-2">
              <input
                ref={addRef} type="text" aria-label="New position name" aria-invalid={addError ? true : undefined} value={newName} placeholder="New position name"
                onChange={(e) => { setNewName(e.target.value); setAddError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
                className={`${CONTROL} ${addError ? CONTROL_ERROR : ''}`}
              />
              <button type="button" onClick={add} disabled={!newName.trim()} className="h-10 px-3 text-[13px] font-body font-body-medium bg-text-primary text-white rounded-spa hover:opacity-90 disabled:opacity-50 whitespace-nowrap">Add</button>
            </div>
            {addError && <p role="alert" className="mt-1.5 text-xs text-error">{addError}</p>}
          </div>

          {names.length === 0 ? (
            <div className="py-10 text-center">
              <Icon name="Briefcase" size={26} className="text-text-tertiary mx-auto mb-2" />
              <p className="text-[13px] text-text-secondary">No positions yet. Add the first one above.</p>
            </div>
          ) : (
            <ul className="border border-border rounded-spa divide-y divide-border">
              {names.map((pos) => {
                const count = holders(pos).length;
                return (
                  <li key={pos} className="flex items-center gap-3 px-3 py-2 min-h-[44px]">
                    <div className="flex-1 min-w-0">
                      {editing === pos ? (
                        <>
                          <input
                            ref={editRef} type="text" aria-label={`Rename ${pos}`} value={editValue} disabled={busy}
                            onChange={(e) => { setEditValue(e.target.value); setEditError(null); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); rename(pos); }
                              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(null); setEditError(null); }
                            }}
                            onBlur={() => { if (!busy) { setEditing(null); setEditError(null); } }}
                            className={`${CONTROL} h-9 ${editError ? CONTROL_ERROR : ''}`}
                          />
                          {editError && <p role="alert" className="mt-1 text-xs text-error">{editError}</p>}
                        </>
                      ) : (
                        <button type="button" onClick={() => { setEditing(pos); setEditValue(pos); setEditError(null); }} title="Click to rename" className="block max-w-full truncate text-left text-[13px] text-text-primary hover:underline">{pos}</button>
                      )}
                    </div>
                    <span className="text-xs text-text-tertiary tabular-nums whitespace-nowrap">{count} staff</span>
                    <button type="button" aria-label={`Delete ${pos}`} onClick={() => setConfirmDelete(pos)} disabled={busy} className="w-7 h-7 flex items-center justify-center rounded-spa text-text-secondary hover:bg-error/10 hover:text-error disabled:opacity-40">
                      <Icon name="Trash2" size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-xs text-text-secondary">Renaming or deleting a position updates everyone who holds it.</p>
        </>
      </Wrap>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete position?"
          message={deleteCount > 0
            ? `"${confirmDelete}" will be removed from ${deleteCount} ${deleteCount === 1 ? staffLabel.toLowerCase() : staffLabelPlural.toLowerCase()}.`
            : `"${confirmDelete}" will be removed from the list.`}
          confirmLabel="Delete"
          requireReason={false}
          isSubmitting={busy}
          onConfirm={remove}
          onClose={() => !busy && setConfirmDelete(null)}
        />
      )}
    </>
  );
};

export default TherapistPositionsPanel;
