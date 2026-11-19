import React from 'react';
import Icon from '../AppIcon';

// Panel B of the staff-availability mockup: the live message under the booking form's therapist/time fields.
// Red hard stop for staff (and for leave/overlap, which nobody can override); amber for managers/admins, who get
// "Book anyway…" when they save. `precheck` comes from useAvailabilityPrecheck.
const AvailabilityNotice = ({ precheck, staffLabel = 'therapist', onPickTime, onPickTherapist }) => {
  if (!precheck?.verdict) return null;
  const { verdict, nextFree, otherFree, blocked } = precheck;
  const tone = blocked
    ? 'border-error/30 bg-error/5 text-error'
    : 'border-warning/40 bg-warning/10 text-warning';
  return (
    <div data-testid="availability-notice" data-code={verdict.code} data-blocked={blocked ? 'true' : 'false'} className={`rounded-spa border px-3 py-2 text-sm ${tone}`}>
      <div className="flex items-start gap-2">
        <Icon name={blocked ? 'Ban' : 'AlertTriangle'} size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="font-body-medium">{verdict.message}</p>
          <p className="text-xs opacity-80">
            {blocked
              ? `Pick another time or ${staffLabel}.`
              : "You can still book it; you'll be asked why."}
          </p>
        </div>
      </div>
      {(nextFree.length > 0 || otherFree) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-text-secondary">
          {nextFree.length > 0 && <span className="mr-1">Next free:</span>}
          {nextFree.map((t) => (
            <button key={t} type="button" onClick={() => onPickTime?.(t)}
              className="px-2 py-0.5 rounded-full border border-border bg-surface text-text-primary hover:bg-background spa-transition-fast">
              {t}
            </button>
          ))}
          {otherFree && (
            <button type="button" onClick={() => onPickTherapist?.(otherFree.id)}
              className="px-2 py-0.5 rounded-full border border-border bg-surface text-text-primary hover:bg-background spa-transition-fast">
              {otherFree.name} at {otherFree.time}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default AvailabilityNotice;
