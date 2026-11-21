import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import {
  PanelShell, FormBody, DateField, TimeField, InfoRows, format12h, addMinutes, formatShortDate,
} from '../../../components/ui/PanelFormKit';
import { toDateInputValue } from '../../../utils/date';
import { friendlyError } from '../../../utils/friendlyError';

const FROM = '09:00';
const TO = '20:30';
const plusDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00`); d.setDate(d.getDate() + n); return toDateInputValue(d); };

// Staff-side "Reschedule booking" in the right-hand panel (Check Booking). Same rule set as the portal's RescheduleModal it
// replaces here: a date from tomorrow to 14 days out, a time between 9:00am and 8:30pm; availability (room capacity, therapist
// branch window / check-out) is enforced by rescheduleBooking, so its verdict is shown after the inputs.
// `onConfirm({ bookingId, newDate, newStartTime })` returns { error? }; on success the panel closes.
const StaffReschedulePanel = ({ booking, onClose, onConfirm, staffLabel = 'Therapist' }) => {
  const today = toDateInputValue(new Date());
  const minDate = plusDays(today, 1);
  const maxDate = plusDays(today, 14);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [errors, setErrors] = useState({});
  const [conflict, setConflict] = useState(null); // the server's verdict, shown after the inputs
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const durationMin = parseInt(String(booking?.duration || '').replace(/\D/g, ''), 10) || 0;
  const oldSlot = booking?.date && booking?.time ? `${formatShortDate(booking.date)} · ${format12h(booking.time)}` : '—';
  const newSlot = date && time ? `${formatShortDate(date)} · ${format12h(time)}` : null;
  const ready = !!date && !!time;
  const reason = !date ? 'Pick the new date' : !time ? 'Pick the new time' : '';

  const submit = async () => {
    if (busyRef.current || reason) return;
    const e = {};
    if (date < minDate || date > maxDate) e.date = `Pick a date from ${formatShortDate(minDate)} to ${formatShortDate(maxDate)}.`;
    if (time < FROM || time > TO) e.time = `Pick a time between ${format12h(FROM)} and ${format12h(TO)}.`;
    setErrors(e);
    setConflict(null);
    if (e.date || e.time) return;
    busyRef.current = true;
    setBusy(true);
    let result;
    try {
      result = await onConfirm({ bookingId: booking.bookingId, newDate: date, newStartTime: time });
    } catch (err) {
      result = { error: err };
    }
    busyRef.current = false;
    setBusy(false);
    if (result?.error) { setConflict(friendlyError(result.error, 'Failed to reschedule booking.')); return; }
    onClose();
  };

  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); submitRef.current(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const rows = useMemo(() => [
    ['Current slot', oldSlot],
    newSlot ? ['New slot', `${newSlot}${durationMin ? ` – ${format12h(addMinutes(time, durationMin))}` : ''}`, 'total'] : null,
    [staffLabel, booking?.therapist?.name || `${staffLabel} TBA`],
    booking?.roomName ? ['Room', booking.roomName] : null,
  ], [oldSlot, newSlot, durationMin, time, booking]);

  return (
    <PanelShell
      variant="panel" title="Reschedule booking" onClose={onClose} dirty={!!(date || time)} busy={busy} reason={reason}
      primary={{ label: busy ? 'Rescheduling…' : (ready ? `Reschedule to ${newSlot}` : 'Reschedule'), onClick: submit, disabled: !!reason, loading: busy }}
    >
      <FormBody>
        <p className="text-[13px] text-text-secondary">{booking?.service}{booking?.id ? ` · ${booking.id}` : ''}</p>
        <DateField label="New date" required value={date} min={minDate} max={maxDate} onChange={(v) => { setDate(v); setErrors((x) => ({ ...x, date: undefined })); setConflict(null); }} hint={`From ${formatShortDate(minDate)} to ${formatShortDate(maxDate)}.`} />
        {errors.date && <p role="alert" className="-mt-2 text-xs text-error">{errors.date}</p>}
        <TimeField label="New time" required value={time} fromTime={FROM} toTime={TO} step={30} onChange={(v) => { setTime(v); setErrors((x) => ({ ...x, time: undefined })); setConflict(null); }} />
        {errors.time && <p role="alert" className="-mt-2 text-xs text-error">{errors.time}</p>}

        <InfoRows rows={rows} />

        {conflict ? (
          <p role="alert" className="flex items-start gap-2 border border-error/30 bg-error/5 rounded-spa px-3 py-2 text-[13px] text-error">
            <Icon name="AlertTriangle" size={14} className="mt-0.5 flex-shrink-0" /><span>{conflict}</span>
          </p>
        ) : (
          <p className="text-xs text-text-secondary">Room availability and the {staffLabel.toLowerCase()}'s schedule are checked when you confirm. The same {staffLabel.toLowerCase()} stays assigned if they are available.</p>
        )}
      </FormBody>
    </PanelShell>
  );
};

export default StaffReschedulePanel;
