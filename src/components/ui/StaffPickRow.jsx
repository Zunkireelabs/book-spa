import React from 'react';
import { avatarColor } from '../../pages/branch-manager-dashboard/components/calendar/phoneCalendarLayout';
import PickShell from './PickShell';

// ONE "who is picked, tap to change" row (ZNLY-303): avatar · name · status line · Free/Busy pill · ›.
// Empty = a dashed "＋ Pick staff". `problem` turns it amber and shows the reason. Tapping opens `renderPicker(close)`:
// a bottom sheet on phone, a popover anchored under the row on desktop (↑/↓ move, Enter picks, Esc closes).
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

// ZNLY-318 extensions (every user gets them): `people` + `max` for a couple (two overlapping avatars, "A, B", amber "1 of 2 · pick one more"),
// `assignedIds` / `assignedNames` (the saved assignment: ASSIGNED tag when the pick equals it, "Was <name>" hint when it differs),
// `onOpenPhone` (phone: the caller shows the list itself, e.g. in place inside its own sheet, instead of this row's own bottom sheet).
const StaffPickRow = ({ id = null, name = '', people = null, max = 1, statusLine: statusLineProp = '', pill: pillProp = null, problem = '', note = '', assignedIds = [], assignedNames = [], emptyLabel = 'Pick staff', title = 'Pick staff', renderPicker, onOpenPhone = null, disabled = false }) => {
  const picks = people || (name ? [{ id, name }] : []);
  const multi = max > 1;
  const partial = multi && Number.isFinite(max) && picks.length > 0 && picks.length < max;
  const need = max - picks.length;
  // One rule: a problem on the row replaces its Free / Busy chip and status line (never "Free" next to a refusal).
  const statusLine = problem ? '' : statusLineProp;
  const pill = problem ? null : pillProp;
  const shownProblem = problem || (partial ? `${picks.length} of ${max} · pick ${need === 1 ? 'one' : need} more` : '');
  const shownLine = multi && Number.isFinite(max) && picks.length === max && statusLine ? `${statusLine} · ${picks.length} of ${max}` : statusLine;
  const hasSaved = assignedIds.length > 0;
  const isSaved = hasSaved && picks.length > 0 && picks.length === assignedIds.length && picks.every((p) => assignedIds.includes(p.id));
  const wasHint = hasSaved && !isSaved && assignedNames.length > 0 ? `Was ${assignedNames.join(', ')}` : '';
  const empty = picks.length === 0;
  const tone = shownProblem ? 'border-amber-300 bg-amber-50' : empty ? 'border-dashed border-border bg-surface' : 'border-border bg-surface';
  return (
    <PickShell tone={tone} title={title} renderPicker={renderPicker} onOpenPhone={onOpenPhone} disabled={disabled}
      sheetFooter={multi ? (close) => <button type="button" onClick={close} className="w-full min-h-[44px] rounded-spa bg-primary text-white text-sm font-semibold">Done</button> : undefined}
      belowRow={(open) => (open ? null : (
        <>
          {wasHint && <p className="mt-1.5 px-0.5 text-xs text-text-secondary">{wasHint}</p>}
          {note && !problem && <p data-overlap-note className="mt-1.5 px-0.5 text-xs text-amber-800">{note}</p>}
        </>
      ))}>
      {empty ? (
        <span className="flex-1 text-sm text-text-secondary">＋ {emptyLabel}</span>
      ) : (
        <>
          <span className="flex flex-shrink-0">
            {picks.map((p, i) => (
              <span key={p.id || i} aria-hidden="true" className={`w-7 h-7 rounded-full text-white flex items-center justify-center text-[11px] font-semibold ${i > 0 ? '-ml-2 ring-2 ring-surface' : ''}`} style={{ background: avatarColor(p.id) }}>{initials(p.name)}</span>
            ))}
          </span>
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="truncate text-sm font-body-medium text-text-primary">{picks.map((p) => p.name).join(', ')}</span>
              {isSaved && <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-success/10 text-success">Assigned</span>}
            </span>
            {(shownProblem || shownLine) && <span className={`block truncate text-xs ${shownProblem ? 'text-amber-800' : 'text-text-secondary'}`}>{shownProblem || shownLine}</span>}
          </span>
          {pill && !shownProblem && (
            <span className={`flex-shrink-0 whitespace-nowrap text-[11.5px] rounded-full px-2 py-0.5 ${pill === 'free' ? 'bg-success/10 text-success' : 'bg-amber-100 text-amber-800'}`}>{pill === 'free' ? 'Free' : 'Busy'}</span>
          )}
        </>
      )}
    </PickShell>
  );
};

export default StaffPickRow;
