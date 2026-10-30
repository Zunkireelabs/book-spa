import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../../components/AppIcon';
import Select from '../../../../components/ui/Select';
import Input from '../../../../components/ui/Input';
import Button from '../../../../components/ui/Button';
import { useOrg } from '../../../../contexts/OrgContext';
import { createBlock } from '../../../../services/api';
import { to12h } from '../../../../services/bookingTransformers';

// 'HH:MM' + minutes -> 'HH:MM', for the "ends at" preview next to the duration field.
function addMinutesToTime(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const wrapped = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

// Free-typed 12h time (e.g. "9", "9:30", "9:30am", "21:15") -> "HH:MM", or null while
// the text is incomplete/invalid so the field can just keep showing what was typed.
function parseTimeInput(raw) {
  const match = (raw || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  const m = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3]?.toLowerCase();
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
  }
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
});

// A 12-hour text+dropdown time field — native <input type="time"> renders its picker
// (and typed value) in the OS/browser locale's format, which shows 24h regardless of
// anything we set in HTML/CSS. This guarantees 12h display everywhere.
const TimeField12h = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ? to12h(value).replace(' ', '') : '');
  const ref = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    setText(value ? to12h(value).replace(' ', '') : '');
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'center' });
    }
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <input
          type="text"
          value={text}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            const parsed = parseTimeInput(raw);
            if (parsed) onChange(parsed);
          }}
          onFocus={(e) => { e.target.select(); setOpen(true); }}
          onBlur={() => setText(value ? to12h(value).replace(' ', '') : '')}
          placeholder="--:--"
          autoComplete="off"
          className="w-full pl-2 pr-7 py-1.5 rounded-spa border border-border bg-surface font-data font-data-normal text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-primary spa-transition-fast"
        >
          <Icon name="ChevronDown" size={14} />
        </button>
      </div>
      {open && (
        <div
          ref={listRef}
          className="absolute left-0 top-full mt-1 w-28 max-h-48 overflow-y-auto bg-surface border border-border rounded-spa shadow-spa-elevated z-dropdown"
        >
          {TIME_OPTIONS.map((t) => (
            <button
              key={t}
              type="button"
              data-selected={t === value}
              onClick={() => { onChange(t); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-sm font-body cursor-pointer hover:bg-primary/10 ${
                t === value ? 'bg-primary/10 font-body-medium text-primary' : 'text-text-primary'
              }`}
            >
              {to12h(t)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

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

// Two-tab modal for blocking time off on the Calendar — Details (who/when/why) and
// Recurrence (Repeat + end condition), matching the Fresha-style reference the request was
// scoped against. Tab-switcher visual pattern copied from ProductDetailDrawer.jsx.
const AddBlockModal = ({ branchId, slotInfo, therapists, rooms, onClose, onSuccess }) => {
  const { orgId } = useOrg();
  const [activeTab, setActiveTab] = useState('details');

  const [assigneeType, setAssigneeType] = useState(slotInfo?.colType === 'therapist' ? 'therapist' : 'location');
  const [therapistId, setTherapistId] = useState(slotInfo?.colType === 'therapist' ? slotInfo.colId : '');
  const [roomId, setRoomId] = useState(slotInfo?.colType === 'room' ? slotInfo.colId : '');
  const [date, setDate] = useState(slotInfo?.day || '');
  const [startTime, setStartTime] = useState(
    slotInfo?.hour != null ? `${String(slotInfo.hour).padStart(2, '0')}:${String(slotInfo.minute ?? 0).padStart(2, '0')}` : ''
  );
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [description, setDescription] = useState('');
  const [preventOnlineBooking, setPreventOnlineBooking] = useState(true);

  const [repeat, setRepeat] = useState('');
  const [recurrenceIntervalInput, setRecurrenceIntervalInput] = useState('1');
  const [endCondition, setEndCondition] = useState('never');
  const [endDate, setEndDate] = useState('');
  const [endCount, setEndCount] = useState('10');

  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const isFormComplete = !!date && !!startTime && Number(durationMinutes) > 0
    && (assigneeType !== 'therapist' || !!therapistId);

  const handleSubmit = async () => {
    if (!date || !startTime) { setError('Select a date and start time.'); return; }
    if (!(Number(durationMinutes) > 0)) { setError('Enter a valid duration.'); return; }
    if (assigneeType === 'therapist' && !therapistId) { setError('Select a staff member.'); return; }

    setSubmitting(true);
    setError(null);

    const result = await createBlock({
      orgId,
      branchId,
      therapistId: assigneeType === 'therapist' ? therapistId : null,
      roomId: roomId || null,
      blockDate: date,
      startTime,
      durationMinutes: Number(durationMinutes),
      description,
      preventOnlineBooking,
      recurrenceFreq: repeat || null,
      recurrenceInterval: Number(recurrenceIntervalInput) || 1,
      recurrenceEndDate: repeat && endCondition === 'date' ? endDate : null,
      recurrenceCount: repeat && endCondition === 'count' ? Number(endCount) : null,
    });

    if (result.error) {
      setError(result.error.message || 'Failed to create block.');
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    onSuccess?.();
  };

  return (
    <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => !submitting && onClose()}>
      <div className="bg-surface rounded-spa-lg shadow-spa-modal max-w-xl w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-heading font-heading-medium text-lg text-text-primary">Add Block</h3>
          <button onClick={() => !submitting && onClose()} className="p-1 rounded hover:bg-background">
            <Icon name="X" size={18} className="text-text-secondary" />
          </button>
        </div>

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
                label="Staff member"
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

            <div className="space-y-1">
              <label className="block font-body font-body-medium text-sm text-text-primary">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-2 py-1.5 rounded-spa border border-border bg-surface font-data font-data-normal text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">Start Time</label>
                <TimeField12h value={startTime} onChange={setStartTime} />
              </div>
              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">Duration (minutes)</label>
                <Input
                  type="number"
                  min="5"
                  step="5"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                />
              </div>
            </div>
            {startTime && Number(durationMinutes) > 0 && (
              <p className="text-xs text-text-secondary">
                Opens back up at <span className="font-data font-data-medium text-text-primary">{to12h(addMinutesToTime(startTime, Number(durationMinutes)))}</span>
              </p>
            )}

            <div className="space-y-1">
              <label className="block font-body font-body-medium text-sm text-text-primary">Description (optional)</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Lunch break, room maintenance..." />
            </div>

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
            <Select label="Repeat" options={REPEAT_OPTIONS} value={repeat} onChange={setRepeat} />

            {repeat && (
              <>
                <div className="space-y-1">
                  <label className="block font-body font-body-medium text-sm text-text-primary">
                    Every {recurrenceIntervalInput || 1} {repeat === 'daily' ? 'day(s)' : repeat === 'weekly' ? 'week(s)' : 'month(s)'}
                  </label>
                  <Input type="number" min="1" value={recurrenceIntervalInput} onChange={(e) => setRecurrenceIntervalInput(e.target.value)} />
                </div>

                <Select label="Ends" options={END_CONDITION_OPTIONS} value={endCondition} onChange={setEndCondition} />

                {endCondition === 'date' && (
                  <div className="space-y-1">
                    <label className="block font-body font-body-medium text-sm text-text-primary">End date</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-spa border border-border bg-surface font-data font-data-normal text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                )}

                {endCondition === 'count' && (
                  <div className="space-y-1">
                    <label className="block font-body font-body-medium text-sm text-text-primary">Number of occurrences</label>
                    <Input type="number" min="1" value={endCount} onChange={(e) => setEndCount(e.target.value)} />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} loading={submitting} disabled={!isFormComplete}>
            Add Block
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AddBlockModal;
