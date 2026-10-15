import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanelShell, FormBody, Field, TextInput, Stepper, InlineError, controlA11y } from '../../../../components/ui/PanelFormKit';
import { createRoom, updateRoom } from '../../../../services/api';
import { friendlyError } from '../../../../utils/friendlyError';

// "New room" / "Edit room" in the right-hand panel. `label` is the industry's word for a room (singular).
// Callbacks: onClose(), onSaved(id, isNew).
const RoomFormPanel = ({ room, branchId, label = 'Room', onClose, onSaved }) => {
  const editing = !!room;
  const lower = label.toLowerCase();
  const original = useMemo(() => ({
    name: room?.name || '',
    floor: room?.floor || '',
    amenities: room?.amenities ? room.amenities.join(', ') : '',
    capacity: String(room?.capacity ?? 1),
  }), [room]);
  const [form, setForm] = useState(original);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setServerError(null); };
  const clear = (k) => setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  const changed = form.name !== original.name || form.floor !== original.floor || form.amenities !== original.amenities || form.capacity !== original.capacity;
  const reason = editing ? (!changed ? 'No changes' : !form.name.trim() ? `Enter the ${lower} name` : '') : (!form.name.trim() ? `Enter the ${lower} name` : '');

  const submit = async () => {
    if (savingRef.current || reason) return;
    const e = {};
    if (!form.name.trim()) e.name = `${label} name is required.`;
    const capacity = parseInt(form.capacity, 10);
    if (!capacity || capacity < 1) e.capacity = 'Capacity must be at least 1.';
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) { document.getElementById(`room-${first}`)?.focus({ preventScroll: true }); return; }
    savingRef.current = true;
    setSaving(true);
    setServerError(null);
    const amenities = form.amenities.split(',').map((s) => s.trim()).filter(Boolean);
    const floor = form.floor.trim() || null;
    const result = editing
      ? await updateRoom({ roomId: room.id, name: form.name.trim(), amenities, floor, capacity })
      : await createRoom({ name: form.name.trim(), branchId, amenities, floor, capacity });
    savingRef.current = false;
    setSaving(false);
    if (result.error) { setServerError(friendlyError(result.error, 'Could not save.')); return; }
    onSaved(editing ? room.id : result.data?.id, !editing);
  };

  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitRef.current(); } };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => document.getElementById('room-name')?.focus({ preventScroll: true }), 260);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, []);

  return (
    <PanelShell
      variant="panel" title={editing ? `Edit ${lower}` : `New ${lower}`} onClose={onClose} dirty={changed} busy={saving} reason={reason}
      primary={{ label: saving ? 'Saving…' : (editing ? 'Save changes' : `Create ${lower}`), onClick: submit, disabled: !!reason, loading: saving }}
    >
      <FormBody>
        <InlineError message={serverError} />
        <Field label={`${label} name`} required id="room-name" error={errors.name}>
          <TextInput {...controlA11y('room-name', errors.name)} error={!!errors.name} value={form.name} onChange={(e) => { set({ name: e.target.value }); clear('name'); }} placeholder="e.g. Room 1" />
        </Field>
        <Field label="Floor" id="room-floor">
          <TextInput id="room-floor" value={form.floor} onChange={(e) => set({ floor: e.target.value })} placeholder="e.g. Ground floor, VIP floor" />
        </Field>
        <Field label="Amenities" id="room-amenities" hint="Separate with commas, e.g. Sauna, Jacuzzi.">
          <TextInput id="room-amenities" value={form.amenities} onChange={(e) => set({ amenities: e.target.value })} />
        </Field>
        <Field label="Capacity" required id="room-capacity" error={errors.capacity} hint="How many bookings can run at the same time.">
          <Stepper id="room-capacity" ariaLabel="Capacity" min={1} value={form.capacity} error={!!errors.capacity} onChange={(v) => { set({ capacity: v }); clear('capacity'); }} />
        </Field>
      </FormBody>
    </PanelShell>
  );
};

export default RoomFormPanel;
