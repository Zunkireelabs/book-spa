import { friendlyError } from '../../../../utils/friendlyError';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import Icon from '../../../../components/AppIcon';
import { fetchBlockById, updateBlock, deleteBlock } from '../../../../services/api';
import { useAvailabilityConflictGuard } from '../../../../hooks/useAvailabilityConflictGuard';
import { blockChange } from '../../../../services/availabilityConflicts';
import { countBookingsInRange, bookingsInRangeMessage } from '../../../../utils/bookingsInRange';
import { PanelShell, FormBody, Field, TextInput, NumberInput, SelectField, Segmented, TabBar, DateField, TimeField, InlineError, InlineWarning, addMinutes, formatShortDate } from '../../../../components/ui/PanelFormKit';
import { useIndustry } from '../../../../hooks/useIndustry';
import { teamMemberLower, teamMemberWord } from '../../../../utils/industryTerms';
import { useClock } from '../../../../hooks/useUse24h';

const TABS = [
  { id: 'details', label: 'Details', icon: 'FileText' },
  { id: 'recurrence', label: 'Recurrence', icon: 'Repeat' },
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

const slotTime = (slot) => (slot?.hour != null ? `${String(slot.hour).padStart(2, '0')}:${String(slot.minute ?? 0).padStart(2, '0')}` : '');

// Editing counterpart to AddBlockModal — opened by clicking an existing block overlay on the Calendar. Occurrence rows
// only carry what's needed to render/gate the calendar, so this fetches the full row via fetchBlockById on open. A
// recurring block's Save/Delete asks this / this-and-following / all, inline in the panel footer.
// While open it reports a live draft (the grid hides the original occurrence and shows the edited one) and accepts
// `retarget` (click an empty slot to move the block).
const EditBlockModal = ({
  variant = 'modal', blockId, occurrenceDate, therapists, rooms, bookings = [], branchHours, retarget, guardRef,
  onClose, onSuccess, onDraftChange,
}) => {
  const clock = useClock();
  const { confirmConflicts, conflictModal } = useAvailabilityConflictGuard();
  const { enableRooms, locationLabel } = useIndustry();
  const roomWord = locationLabel.toLowerCase();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('details');

  const [assigneeType, setAssigneeType] = useState('location');
  const [therapistId, setTherapistId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [date, setDate] = useState(occurrenceDate || '');
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
  const [moveConfirm, setMoveConfirm] = useState(null);
  const loadedRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetchBlockById(blockId).then(({ data, error: fetchError }) => {
      if (cancelled) return;
      if (fetchError || !data) {
        setError(friendlyError(fetchError, 'Failed to load block.'));
        setLoading(false);
        return;
      }
      const snap = {
        assigneeType: data.therapistId ? 'therapist' : 'location',
        therapistId: data.therapistId || '',
        roomId: data.roomId || '',
        date: occurrenceDate || data.blockDate,
        startTime: (data.startTime || '').slice(0, 5),
        durationMinutes: String(data.durationMinutes || 30),
        description: data.description || '',
        preventOnlineBooking: !!data.preventOnlineBooking,
      };
      loadedRef.current = snap;
      setAssigneeType(snap.assigneeType);
      setTherapistId(snap.therapistId);
      setRoomId(snap.roomId);
      setDate(snap.date);
      setStartTime(snap.startTime);
      setDurationMinutes(snap.durationMinutes);
      setDescription(snap.description);
      setPreventOnlineBooking(snap.preventOnlineBooking);
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

  const isFormComplete = !!date && !!startTime && Number(durationMinutes) > 0 && (assigneeType !== 'therapist' || !!therapistId);
  const dirty = !!loadedRef.current && JSON.stringify(loadedRef.current) !== JSON.stringify({
    assigneeType, therapistId, roomId, date, startTime, durationMinutes, description, preventOnlineBooking,
  });

  const dur = Number(durationMinutes) > 0 ? Number(durationMinutes) : 0;
  const effTherapist = assigneeType === 'therapist' ? therapistId : '';
  const bookingCount = useMemo(
    () => countBookingsInRange(bookings, { date, startTime, durationMinutes: dur, therapistId: effTherapist, roomId }),
    [bookings, date, startTime, dur, effTherapist, roomId]
  );
  const bookingWarning = bookingsInRangeMessage(bookingCount);

  useEffect(() => {
    if (loading) return;
    onDraftChange?.({
      kind: 'block', date, startTime, durationMinutes: dur || 30,
      therapistId: effTherapist || null, roomId: roomId || null, wholeBranch: !effTherapist && !roomId,
      overlap: bookingCount > 0, label: description.trim(),
      hideBlock: { blockId, day: occurrenceDate },
    });
  }, [loading, date, startTime, dur, effTherapist, roomId, bookingCount, description]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDraftChange?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Retarget by clicking an empty slot (not for the Unassigned / day columns, which carry no therapist or room).
  const lastRetargetRef = useRef(retarget?.nonce ?? null); // ignore a retarget request left over from an earlier panel
  const applyRetarget = (s) => {
    setDate(s.day);
    setStartTime(slotTime(s));
    if (s.colType === 'therapist' && s.colId) { setAssigneeType('therapist'); setTherapistId(s.colId); }
    if (s.colType === 'room' && s.colId) setRoomId(s.colId);
  };
  useEffect(() => {
    if (!retarget || retarget.nonce === lastRetargetRef.current || loading) return;
    lastRetargetRef.current = retarget.nonce;
    const s = retarget.slot;
    const curCol = s.colType === 'room' ? roomId : s.colType === 'therapist' ? (assigneeType === 'therapist' ? therapistId : '') : '';
    const changes = s.day !== date || ((s.colType === 'room' || s.colType === 'therapist') && (s.colId || '') !== curCol);
    if (dirty && changes) setMoveConfirm(s); else applyRetarget(s);
  }, [retarget, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Which action is waiting on the "this / following / all" choice (null = none).
  const [pendingAction, setPendingAction] = useState(null); // 'save' | 'delete'

  const validate = () => {
    if (!date || !startTime) { setError('Select a date and start time.'); return false; }
    if (!(Number(durationMinutes) > 0)) { setError('Enter a valid duration.'); return false; }
    if (assigneeType === 'therapist' && !therapistId) { setError(`Select a ${teamMemberLower()}.`); return false; }
    return true;
  };

  // A recurring block's edit/delete is scoped from the occurrence the user actually clicked, never the series' anchor.
  const runSave = async (scope) => {
    setSubmitting(true);
    setError(null);
    // Same "falls inside this block" list as adding one (the edited time / person, on the date being edited).
    if (assigneeType === 'therapist') {
      const proceed = await confirmConflicts({
        therapistId,
        change: blockChange({ date, start: startTime, durationMinutes: Number(durationMinutes) }),
        summary: `Block ${startTime} for ${durationMinutes} min${description.trim() ? ` (${description.trim()})` : ''}.`,
        titleFor: (n) => `${n} booking${n === 1 ? '' : 's'} ${n === 1 ? 'falls' : 'fall'} inside this block`,
        saveLabel: 'Save block, keep bookings',
      });
      if (!proceed) { setSubmitting(false); return; }
    }
    const result = await updateBlock({
      blockId,
      scope,
      occurrenceDate,
      therapistId: assigneeType === 'therapist' ? therapistId : null,
      roomId: roomId || null,
      blockDate: date,
      startTime,
      durationMinutes: Number(durationMinutes),
      description,
      preventOnlineBooking,
    });
    if (result.error) {
      setError(friendlyError(result.error, 'Failed to save block.'));
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    onSuccess?.();
  };

  const runDelete = async (scope) => {
    setDeleting(true);
    setError(null);
    const result = await deleteBlock({ blockId, scope, occurrenceDate });
    if (result.error) {
      setError(friendlyError(result.error, 'Failed to remove block.'));
      setDeleting(false);
      return;
    }
    setDeleting(false);
    onSuccess?.();
  };

  const handleSave = () => {
    if (!validate()) return;
    if (isRecurring) setPendingAction('save');
    else runSave('series');
  };

  const handleScopeChosen = (scope) => {
    const action = pendingAction;
    setPendingAction(null);
    if (action === 'save') runSave(scope);
    else if (action === 'delete') runDelete(scope);
  };

  const outlineBtn = 'w-full h-9 px-3 text-[13px] font-body font-body-medium border border-border rounded-spa hover:bg-background spa-transition-fast text-left';
  const scopeOverride = pendingAction ? (
    isRecurring ? (
      <div role="alertdialog" aria-label={pendingAction === 'delete' ? 'Remove block' : 'Save changes'} className="space-y-2">
        <p className="text-[13px] text-text-primary">
          This block repeats. Which blocks should be {pendingAction === 'delete' ? 'removed' : 'changed'}?
        </p>
        <button type="button" className={outlineBtn} onClick={() => handleScopeChosen('this')}>This block only</button>
        <button type="button" className={outlineBtn} onClick={() => handleScopeChosen('following')}>This and following</button>
        <button type="button" className={outlineBtn} onClick={() => handleScopeChosen('series')}>All blocks in the series</button>
        <button type="button" className="w-full h-9 text-[13px] font-body font-body-medium text-text-secondary hover:text-text-primary" onClick={() => setPendingAction(null)}>Cancel</button>
      </div>
    ) : (
      <div role="alertdialog" aria-label="Remove block" className="flex items-center gap-3">
        <p className="flex-1 min-w-0 text-[13px] text-text-primary">Remove this block?</p>
        <button type="button" onClick={() => setPendingAction(null)} className="h-9 px-3 text-[13px] font-body font-body-medium border border-border rounded-spa hover:bg-background whitespace-nowrap">Keep</button>
        <button type="button" onClick={() => handleScopeChosen('series')} className="h-9 px-3 text-[13px] font-body font-body-medium bg-error text-white rounded-spa hover:opacity-90 whitespace-nowrap">Remove</button>
      </div>
    )
  ) : moveConfirm ? (
    <div role="alertdialog" aria-label="Move block" className="flex items-center gap-3">
      <p className="flex-1 min-w-0 text-[13px] text-text-primary">
        Move this block to {[formatShortDate(moveConfirm.day), clock(slotTime(moveConfirm))].filter(Boolean).join(' · ')}?
      </p>
      <button type="button" onClick={() => setMoveConfirm(null)} className="h-9 px-3 text-[13px] font-body font-body-medium border border-border rounded-spa hover:bg-background whitespace-nowrap">Keep here</button>
      <button type="button" onClick={() => { applyRetarget(moveConfirm); setMoveConfirm(null); }} className="h-9 px-3 text-[13px] font-body font-body-medium bg-text-primary text-white rounded-spa hover:opacity-90 whitespace-nowrap">Move</button>
    </div>
  ) : null;

  const reason = !date ? 'Pick a date' : !startTime ? 'Pick a start time'
    : !(Number(durationMinutes) > 0) ? 'Enter a duration'
    : assigneeType === 'therapist' && !therapistId ? `Select a ${teamMemberLower()}` : '';

  return (
    <>
    <PanelShell
      variant={variant}
      title="Edit block"
      onClose={onClose}
      dirty={dirty}
      guardRef={guardRef}
      busy={submitting || deleting}
      reason={reason}
      footerOverride={scopeOverride}
      hideFooter={loading}
      footerLeft={!loading && (
        <button
          type="button"
          onClick={() => setPendingAction('delete')}
          disabled={submitting || deleting}
          className="flex items-center gap-1.5 h-9 px-1 text-[13px] font-body font-body-medium text-error hover:underline whitespace-nowrap disabled:opacity-50"
        >
          <Icon name="Trash2" size={14} />
          Delete
        </button>
      )}
      primary={{ label: submitting ? 'Saving…' : 'Save', onClick: handleSave, disabled: !isFormComplete || deleting, loading: submitting }}
    >
      {loading ? (
        <div className="py-12 flex items-center justify-center">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
        <>
          <TabBar tabs={TABS} value={activeTab} onChange={setActiveTab} />
          <FormBody>
            <InlineError message={error} />
            <InlineWarning message={bookingWarning} icon="CalendarClock" />

            {activeTab === 'details' && (
              <>
                <Segmented
                  options={[['therapist', teamMemberWord()], ['location', 'Whole location']]}
                  value={assigneeType}
                  onChange={setAssigneeType}
                />

                {assigneeType === 'therapist' && (
                  <Field label={teamMemberWord()} required>
                    <SelectField
                      placeholder={`Select ${teamMemberLower()}...`}
                      options={(therapists || []).map((t) => ({ value: t.id, label: t.name }))}
                      value={therapistId}
                      onChange={setTherapistId}
                    />
                  </Field>
                )}

                {enableRooms && (
                <Field label={`${locationLabel} (optional)`}>
                  <SelectField
                    placeholder={`No specific ${roomWord}...`}
                    options={[{ value: '', label: `No specific ${roomWord}` }, ...(rooms || []).map((r) => ({ value: r.id, label: r.name }))]}
                    value={roomId}
                    onChange={setRoomId}
                  />
                </Field>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <DateField label="Date" required value={date} onChange={setDate} />
                  <TimeField
                    label="Start time"
                    required
                    value={startTime}
                    onChange={setStartTime}
                    fromTime={(branchHours?.openTime || '06:00').slice(0, 5)}
                    toTime="23:50"
                  />
                </div>

                <Field
                  label="Duration (minutes)"
                  required
                  hint={startTime && dur ? `Opens back up at ${clock(addMinutes(startTime, dur))}` : undefined}
                >
                  <NumberInput min="5" step="5" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
                </Field>

                <Field label="Description (optional)">
                  <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Lunch break, room sterilisation..." />
                </Field>

                <label className="flex items-center gap-2 text-[13px] font-body text-text-primary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preventOnlineBooking}
                    onChange={(e) => setPreventOnlineBooking(e.target.checked)}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30"
                  />
                  Prevent online bookings during this time
                </label>
              </>
            )}

            {activeTab === 'recurrence' && (
              <>
                <Field label="Repeat" hint="Recurrence can't be changed once a block exists — remove it and create a new recurring block instead.">
                  <SelectField options={REPEAT_OPTIONS} value={repeat} onChange={() => {}} disabled />
                </Field>
                {repeat && (
                  <>
                    <p className="text-[13px] text-text-primary">
                      Every {recurrenceIntervalInput || 1} {repeat === 'daily' ? 'day(s)' : repeat === 'weekly' ? 'week(s)' : 'month(s)'}
                    </p>
                    <Field label="Ends">
                      <SelectField options={END_CONDITION_OPTIONS} value={endCondition} onChange={() => {}} disabled />
                    </Field>
                    {endCondition === 'date' && <p className="text-[13px] text-text-secondary">Ends on {formatShortDate(endDate, true)}</p>}
                    {endCondition === 'count' && <p className="text-[13px] text-text-secondary">Ends after {endCount} occurrences</p>}
                  </>
                )}
              </>
            )}
          </FormBody>
        </>
      )}
    </PanelShell>
    {conflictModal}
    </>
  );
};

export default EditBlockModal;
