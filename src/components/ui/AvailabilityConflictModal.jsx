import React from 'react';
import Icon from '../AppIcon';
import Button from './Button';
import ModalShell from './ModalShell';

// "N upcoming bookings fall outside the new hours" (staff-availability mockup, panel D). One component for every place
// that changes availability. The bookings are kept as they are; this only shows them before the manager saves.
const fmtDate = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};

const AvailabilityConflictModal = ({ title, summary, conflicts, saveLabel = 'Save anyway', onBack, onSaveAnyway, onOpenInCalendar, isSaving = false }) => (
  <ModalShell onClose={isSaving ? undefined : onBack} className="max-w-xl" data-testid="availability-conflict-modal">
    <div>
      <div className="flex items-center justify-between p-5 border-b border-border">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-warning/10">
            <Icon name="AlertTriangle" size={20} className="text-warning" />
          </div>
          <h2 className="font-heading font-heading-semibold text-lg text-text-primary">{title}</h2>
        </div>
        <button onClick={onBack} disabled={isSaving} className="p-2 rounded-spa hover:bg-background spa-transition-fast spa-touch-target" aria-label="Back to editing">
          <Icon name="X" size={20} className="text-text-secondary" />
        </button>
      </div>

      <div className="p-5 space-y-3">
        {summary && <p className="font-body text-sm text-text-secondary">{summary} These bookings stay as they are; move them if needed.</p>}
        <ul className="max-h-64 overflow-y-auto divide-y divide-border border border-border rounded-spa">
          {conflicts.map((c) => (
            <li key={`${c.id}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="font-body font-body-medium text-sm text-text-primary">
                  {c.who ? `${c.who} · ` : ''}{fmtDate(c.date)} · <span className="font-data">{c.time}</span> · {c.customer}
                </p>
                <p className="font-caption text-xs text-text-secondary">
                  {c.service ? `${c.service} · ` : ''}<span className="text-warning">{c.text}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenInCalendar(c)}
                className="flex-shrink-0 inline-flex items-center gap-1 font-caption text-xs text-primary hover:underline"
              >
                <Icon name="ExternalLink" size={12} />
                <span>Open in calendar</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center justify-end space-x-3 p-5 border-t border-border">
        <Button variant="outline" onClick={onBack} disabled={isSaving}>Cancel</Button>
        <Button variant="primary" onClick={onSaveAnyway} disabled={isSaving}>{saveLabel}</Button>
      </div>
    </div>
  </ModalShell>
);

export default AvailabilityConflictModal;
