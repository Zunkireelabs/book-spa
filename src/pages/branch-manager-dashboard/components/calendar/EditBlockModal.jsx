import React, { useState, useEffect } from 'react';
import Icon from '../../../../components/AppIcon';
import Select from '../../../../components/ui/Select';
import Input from '../../../../components/ui/Input';
import Button from '../../../../components/ui/Button';
import { useBranch } from '../../../../contexts/BranchContext';
import { fetchBlockById, updateBlock, deleteBlock } from '../../../../services/api';

const TABS = [
  { id: 'details', label: 'Details' },
  { id: 'recurrence', label: 'Recurrence' },
];

const REPEAT_OPTIONS = [
  { value: '', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const END_CONDITION_OPTIONS = [
  { value: 'never', label: 'Never' },
  { value: 'date', label: 'On date' },
  { value: 'count', label: 'After N occurrences' },
];

// Editing counterpart to AddBlockModal — opened by clicking an existing block overlay on
// the Calendar (Fresha-style "Edit busy time" reference). Occurrence rows from
// fetchBlocksForRange only carry what's needed to render/gate the calendar, not the full
// recurrence rule, so this fetches the complete row via fetchBlockById on open. A recurring
// block's Save/Delete asks this-occurrence-vs-entire-series via the same window.confirm
// pattern CalendarGrid's delete "x" already uses, for a consistent (if plain) UX.
const EditBlockModal = ({ blockId, occurrenceDate, therapists, rooms, onClose, onSuccess }) => {
  const { branchName } = useBranch();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('details');

  const [assigneeType, setAssigneeType] = useState('location');
  const [therapistId, setTherapistId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [date, setDate] = useState(occurrenceDate || '');
  const [editingDate, setEditingDate] = useState(false);
  const [startTime, setStartTime] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [description, setDescription] = useState('');
  const [preventOnlineBooking, setPreventOnlineBooking] = useState(true);

  const [isRecurring, setIsRecurring] = useState(false);
  const [repeat, setRepeat] = useState('');
  const [recurrenceIntervalInput, setRecurrenceIntervalInput] = useState('1');
  const [endCondition, setEndCondition] = useState('never');
  const [endDate, setEndDate] = useState('');
  const [endCount, setEndCount] = useState('10');

  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchBlockById(blockId).then(({ data, error: fetchError }) => {
      if (cancelled) return;
      if (fetchError || !data) {
        setError(fetchError?.message || 'Failed to load block.');
        setLoading(false);
        return;
      }
      setAssigneeType(data.therapistId ? 'therapist' : 'location');
      setTherapistId(data.therapistId || '');
      setRoomId(data.roomId || '');
      setDate(occurrenceDate || data.blockDate);
      setStartTime((data.startTime || '').slice(0, 5));
      setDurationMinutes(String(data.durationMinutes || 30));
      setDescription(data.description || '');
      setPreventOnlineBooking(!!data.preventOnlineBooking);
      setIsRecurring(!!data.recurrenceFreq);
      setRepeat(data.recurrenceFreq || '');
      setRecurrenceIntervalInput(String(data.recurrenceInterval || 1));
      setEndCondition(data.recurrenceEndDate ? 'date' : data.recurrenceCount ? 'count' : 'never');
      setEndDate(data.recurrenceEndDate || '');
      setEndCount(data.recurrenceCount ? String(data.recurrenceCount) : '10');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [blockId, occurrenceDate]);

  const isFormComplete = !!date && !!startTime && Number(durationMinutes) > 0
    && (assigneeType !== 'therapist' || !!therapistId);

  // A recurring block's edit/delete needs to know which occurrence it's scoped from —
  // always the occurrence the user actually clicked, never the series' original anchor.
  const resolveScope = () => {
    if (!isRecurring) return 'series';
    return window.confirm(
      'This block repeats. Click OK to apply this change to the ENTIRE recurring series, or Cancel to apply it to just this one occurrence.'
    ) ? 'series' : 'this';
  };

  const handleSave = async () => {
    if (!date || !startTime) { setError('Select a date and start time.'); return; }
    if (!(Number(durationMinutes) > 0)) { setError('Enter a valid duration.'); return; }
    if (assigneeType === 'therapist' && !therapistId) { setError('Select a staff member.'); return; }

    setSubmitting(true);
    setError(null);

    const scope = resolveScope();
    const result = await updateBlock({
      blockId,
      scope,
      occurrenceDate: occurrenceDate,
      therapistId: assigneeType === 'therapist' ? therapistId : null,
      roomId: roomId || null,
      blockDate: date,
      startTime,
      durationMinutes: Number(durationMinutes),
      description,
      preventOnlineBooking,
    });

    if (result.error) {
      setError(result.error.message || 'Failed to save block.');
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    onSuccess?.();
  };

  const handleDelete = async () => {
    if (!window.confirm('Remove this block?')) return;
    setDeleting(true);
    setError(null);

    const scope = resolveScope();
    const result = await deleteBlock({ blockId, scope, occurrenceDate });

    if (result.error) {
      setError(result.error.message || 'Failed to remove block.');
      setDeleting(false);
      return;
    }

    setDeleting(false);
    onSuccess?.();
  };

  return (
    <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => !submitting && !deleting && onClose()}>
      <div className="bg-surface rounded-spa-lg shadow-spa-modal max-w-md w-full p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-heading font-heading-medium text-lg text-text-primary">Edit Block</h3>
          <button onClick={() => !submitting && !deleting && onClose()} className="p-1 rounded hover:bg-background">
            <Icon name="X" size={18} className="text-text-secondary" />
          </button>
        </div>

        {loading ? (
          <div className="py-8 flex items-center justify-center">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <>
            <div className="flex gap-1 border-b border-border">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-2 text-sm font-body font-body-medium spa-transition-fast border-b-2 -mb-[1px] ${
                    activeTab === tab.id
                      ? 'border-primary text-primary'
                      : 'border-transparent text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
                <Icon name="AlertCircle" size={16} />
                <span>{error}</span>
              </div>
            )}

            {activeTab === 'details' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-text-primary">
                  <Icon name="MapPin" size={15} className="text-text-secondary flex-shrink-0" />
                  <span>{branchName || 'This branch'}</span>
                </div>

                <div className="flex items-center gap-2 text-sm text-text-primary">
                  <Icon name="Calendar" size={15} className="text-text-secondary flex-shrink-0" />
                  {editingDate ? (
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      autoFocus
                      onBlur={() => setEditingDate(false)}
                      className="px-2 py-1 rounded-spa border border-border bg-surface font-data text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  ) : (
                    <>
                      <span>{new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      <button type="button" onClick={() => setEditingDate(true)} className="p-0.5 rounded hover:bg-background">
                        <Icon name="Pencil" size={13} className="text-text-secondary" />
                      </button>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Icon name="Timer" size={15} className="text-text-secondary flex-shrink-0" />
                  <Input
                    type="number"
                    min="5"
                    step="5"
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(e.target.value)}
                    className="w-24"
                  />
                  <span className="text-sm text-text-secondary">from</span>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded-spa border border-border bg-surface font-data font-data-normal text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>

                <div className="flex rounded-spa border border-border p-0.5 bg-background w-fit">
                  <button
                    type="button"
                    onClick={() => setAssigneeType('therapist')}
                    className={`px-3 py-1.5 rounded text-sm font-body font-body-medium transition-colors ${
                      assigneeType === 'therapist' ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    Staff member
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssigneeType('location')}
                    className={`px-3 py-1.5 rounded text-sm font-body font-body-medium transition-colors ${
                      assigneeType === 'location' ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    Whole location
                  </button>
                </div>

                {assigneeType === 'therapist' && (
                  <Select
                    placeholder="Select staff..."
                    options={(therapists || []).map(t => ({ value: t.id, label: t.name }))}
                    value={therapistId}
                    onChange={setTherapistId}
                  />
                )}

                <Select
                  label="Room (optional)"
                  placeholder="No specific room..."
                  options={(rooms || []).map(r => ({ value: r.id, label: r.name }))}
                  value={roomId}
                  onChange={setRoomId}
                />

                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Lunch break, room maintenance..."
                  rows={3}
                  className="w-full px-2.5 py-2 rounded-spa border border-border bg-surface font-body text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
                />

                <label className="flex items-center gap-2 text-sm font-body text-text-primary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preventOnlineBooking}
                    onChange={(e) => setPreventOnlineBooking(e.target.checked)}
                    className="rounded border-border"
                  />
                  Prevent online bookings during this time?
                </label>
              </div>
            )}

            {activeTab === 'recurrence' && (
              <div className="space-y-3">
                <Select label="Repeat" options={REPEAT_OPTIONS} value={repeat} onChange={setRepeat} disabled />
                <p className="font-caption text-xs text-text-tertiary">
                  Recurrence can't be changed once a block exists — remove it and create a new recurring block instead.
                </p>
                {repeat && (
                  <>
                    <div className="space-y-1">
                      <label className="block font-body font-body-medium text-sm text-text-primary">
                        Every {recurrenceIntervalInput || 1} {repeat === 'daily' ? 'day(s)' : repeat === 'weekly' ? 'week(s)' : 'month(s)'}
                      </label>
                    </div>
                    <Select label="Ends" options={END_CONDITION_OPTIONS} value={endCondition} onChange={() => {}} disabled />
                    {endCondition === 'date' && (
                      <p className="font-body text-sm text-text-secondary">Ends on {endDate}</p>
                    )}
                    {endCondition === 'count' && (
                      <p className="font-body text-sm text-text-secondary">Ends after {endCount} occurrences</p>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <button
                type="button"
                onClick={handleDelete}
                disabled={submitting || deleting}
                className="flex items-center gap-1.5 text-sm font-body font-body-medium text-error hover:underline"
              >
                <Icon name="Trash2" size={15} />
                Delete
              </button>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting || deleting}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={handleSave} loading={submitting} disabled={!isFormComplete || deleting}>
                  Save
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default EditBlockModal;
