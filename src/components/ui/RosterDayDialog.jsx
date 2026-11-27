import React, { useState } from 'react';
import Icon from '../AppIcon';
import ModalShell from './ModalShell';
import { TimeField, SwitchRow } from './PanelFormKit';
import { upsertRosterOverrides, deleteRosterOverride } from '../../services/api';
import { useAvailabilityConflictGuard } from '../../hooks/useAvailabilityConflictGuard';
import { rosterChange } from '../../services/availabilityConflicts';
import { friendlyError } from '../../utils/friendlyError';
import { useClock } from '../../hooks/useUse24h';

const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const parts = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
export const dayLabel = (iso) => parts(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');

const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

// The one "change this day's hours" box, used by the Roster and the calendar's staff header. Saves that one date on its own.
//   current: what applies on that day now { isDayOff, startTime, endTime, breaks }
//   usual:   the weekly hours for that weekday (same shape), used for the "Usual hours" line and "Back to usual hours"
//   changed: true when that date already has its own hours
const RosterDayDialog = ({ therapist, date, current, usual, changed, onClose, onSaved }) => {
  const clock = useClock();
  const { confirmConflicts, conflictModal } = useAvailabilityConflictGuard();
  const [works, setWorks] = useState(!current.isDayOff);
  const [start, setStart] = useState(hhmm(current.startTime) || '10:00');
  const [end, setEnd] = useState(hhmm(current.endTime) || '18:00');
  const [breaks, setBreaks] = useState((current.breaks || []).map((b) => ({ name: b.name || '', startTime: hhmm(b.startTime), endTime: hhmm(b.endTime) })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const problem = (() => {
    if (!works) return null;
    if (!start || !end || start >= end) return 'Start time must be before end time.';
    for (const b of breaks) {
      if (!b.startTime || !b.endTime || b.startTime >= b.endTime) return 'Each break needs a start before its end.';
      if (b.startTime < start || b.endTime > end) return 'Breaks must sit inside the working hours.';
    }
    return null;
  })();

  const usualLine = usual && !usual.isDayOff
    ? `${clock(hhmm(usual.startTime))}–${clock(hhmm(usual.endTime))}`
    : 'off';

  const run = async (next, write) => {
    setBusy(true); setError(null);
    const checks = [{
      therapistId: therapist.id, name: therapist.name,
      change: rosterChange({ date, isDayOff: next.isDayOff, start: next.startTime, end: next.endTime, breaks: next.breaks.map((b) => ({ start: b.startTime, end: b.endTime })) }),
    }];
    // Bookings outside the new hours are listed first and stay booked either way.
    if (!(await confirmConflicts({ checks, summary: 'You are changing this day\'s hours.', titleFor: (n) => `${n} upcoming booking${n === 1 ? '' : 's'} ${n === 1 ? 'falls' : 'fall'} outside the new hours`, saveLabel: 'Save' }))) { setBusy(false); return; }
    const { error: err } = await write();
    setBusy(false);
    if (err) { setError(friendlyError(err, 'Could not save. Please try again.')); return; }
    onSaved?.();
  };

  const save = () => {
    if (problem) return;
    const next = works
      ? { isDayOff: false, startTime: start, endTime: end, breaks: breaks.filter((b) => b.startTime && b.endTime) }
      : { isDayOff: true, startTime: null, endTime: null, breaks: [] };
    return run(next, () => upsertRosterOverrides([{ therapistId: therapist.id, date, ...next }]));
  };

  const backToUsual = () => run(
    { isDayOff: !!usual?.isDayOff, startTime: hhmm(usual?.startTime), endTime: hhmm(usual?.endTime), breaks: (usual?.breaks || []).map((b) => ({ startTime: hhmm(b.startTime), endTime: hhmm(b.endTime) })) },
    () => deleteRosterOverride({ therapistId: therapist.id, date }),
  );

  const setBreak = (i, patch) => setBreaks((p) => p.map((x, n) => (n === i ? { ...x, ...patch } : x)));

  return (
    <>
    <ModalShell onClose={busy ? undefined : onClose} className="max-w-sm" aria-label="Change hours for this day" data-testid="roster-date-dialog">
      <div>
        <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
          <div className="min-w-0">
            <h4 className="font-heading font-heading-semibold text-base text-text-primary truncate">{therapist.name} · {dayLabel(date)}</h4>
            <p className="font-caption text-xs text-text-tertiary mt-0.5">Usual hours on {WEEKDAYS[parts(date).getDay()]}: {usualLine}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="p-1.5 rounded-spa hover:bg-background" aria-label="Close"><Icon name="X" size={18} className="text-text-secondary" /></button>
        </div>
        <div className="p-4 space-y-4">
          <SwitchRow label="Working this day" checked={works} onChange={setWorks} id="roster-day-works" />
          {works && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <TimeField label="From" value={start} onChange={setStart} step={5} fromTime="00:00" toTime="23:55" />
                <TimeField label="Until" value={end} onChange={setEnd} step={5} fromTime="00:00" toTime="23:55" />
              </div>
              <div>
                <p className="font-caption text-xs text-text-secondary mb-1.5">Breaks</p>
                <div className="space-y-2">
                  {breaks.map((b, i) => (
                    <div key={i} className="space-y-1.5 rounded-spa border border-border/70 p-2">
                      <div className="flex items-center gap-2">
                        <input type="text" aria-label={`Break ${i + 1} name`} placeholder="Name, e.g. Lunch" maxLength={40} value={b.name} onChange={(e) => setBreak(i, { name: e.target.value })}
                          className="min-w-0 flex-1 px-2 py-1.5 rounded-spa border border-border bg-surface font-body text-sm" />
                        <button type="button" aria-label={`Remove break ${i + 1}`} onClick={() => setBreaks((p) => p.filter((_, n) => n !== i))} className="p-1.5 rounded-spa hover:bg-background text-text-tertiary hover:text-error"><Icon name="X" size={14} /></button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <TimeField label={`Break ${i + 1} from`} value={b.startTime} onChange={(v) => setBreak(i, { startTime: v })} step={5} fromTime="00:00" toTime="23:55" />
                        <TimeField label={`Break ${i + 1} until`} value={b.endTime} onChange={(v) => setBreak(i, { endTime: v })} step={5} fromTime="00:00" toTime="23:55" />
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={() => setBreaks((p) => [...p, { name: '', startTime: '13:00', endTime: '14:00' }])} className="inline-flex items-center gap-1 font-caption text-xs text-primary hover:underline">
                    <Icon name="Plus" size={12} /> Add break
                  </button>
                </div>
              </div>
            </>
          )}
          {(problem || error) && <p role="alert" className="font-caption text-xs text-error">{problem || error}</p>}
          <p className="font-caption text-[11px] text-text-tertiary">This changes this one day only, not the usual weekly hours.</p>
        </div>
        <div className="flex items-center justify-between gap-2 p-4 border-t border-border">
          {changed ? (
            <button type="button" onClick={backToUsual} disabled={busy} className="font-body text-[13px] text-primary hover:underline disabled:opacity-50">Back to usual hours</button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="h-9 max-md:h-11 px-3 text-[13px] font-body font-body-medium border border-border rounded-spa hover:bg-background">Cancel</button>
            <button type="button" onClick={save} disabled={busy || !!problem} className="h-9 max-md:h-11 px-4 text-[13px] font-body font-body-medium bg-primary text-white rounded-spa hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </ModalShell>
    {conflictModal}
    </>
  );
};

export default RosterDayDialog;
