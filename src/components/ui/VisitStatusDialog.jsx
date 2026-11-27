import React, { useState } from 'react';
import Icon from '../AppIcon';
import Button from './Button';
import CustomSelect from './CustomSelect';
import ModalShell from './ModalShell';
import { splitStatusPreview } from '../../utils/visitPreview';
import { visitSetStatus } from '../../services/visitApi';
import { friendlyError } from '../../utils/friendlyError';

// ZNLY-402 piece 5 (screen C): "Cancel this booking?" / "Mark as no-show?" for a booking with 2+ services. `preview` is the visit_set_status
// dry run: rows with verdict 'change' (will be cancelled) or 'keep' (already started / paid, stay). `lines` maps booking_id -> { name, price, start, staff }.
const money = (n) => `NPR ${Number(n || 0).toLocaleString('en-IN')}`;

const Row = ({ r }) => (
  <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border last:border-b-0">
    <div className="min-w-0">
      <p className="text-sm font-medium text-text-primary truncate">{r.name}</p>
      <p className="text-xs text-text-secondary truncate">{r.sub}</p>
    </div>
    {r.price != null && <span className="font-data text-sm text-text-primary tabular-nums flex-shrink-0">{money(r.price)}</span>}
  </div>
);

const VisitStatusDialog = ({ kind = 'cancel', preview, reasonOptions, onConfirm, onClose, isSubmitting = false, error = null }) => {
  const noShow = kind === 'no show';
  const { change, keep } = preview;
  const [selected, setSelected] = useState('');
  const [custom, setCustom] = useState('');
  const isOthers = selected === 'others';
  const nothing = change.length === 0;
  const reasonOk = noShow ? true : Boolean(selected) && (!isOthers || custom.trim().length > 0);
  const reasonText = noShow ? (custom.trim() || 'No show') : (isOthers ? custom.trim() : reasonOptions.find((o) => o.value === selected)?.label || '');
  const n = change.length;

  return (
    <ModalShell onClose={isSubmitting ? undefined : onClose} data-visit-status-dialog>
      <div>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-error/10">
              <Icon name="AlertTriangle" size={20} className="text-error" />
            </div>
            <h2 className="font-heading font-heading-semibold text-lg text-text-primary">{noShow ? 'Mark as no-show?' : 'Cancel this booking?'}</h2>
          </div>
          <button onClick={onClose} disabled={isSubmitting} aria-label="Close" className="p-2 rounded-spa hover:bg-background spa-transition-fast spa-touch-target">
            <Icon name="X" size={20} className="text-text-secondary" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {nothing ? (
            <p className="text-sm text-text-secondary">All services have started or are paid, so nothing can be {noShow ? 'marked as a no-show' : 'cancelled'}. Use Correct as admin for paid ones.</p>
          ) : (
            <p className="text-sm text-text-secondary">{noShow ? 'The services below will be marked as a no-show.' : 'The services below will be cancelled.'} This cannot be undone.</p>
          )}
          {!nothing && (
            <div>
              <p className="text-xs font-medium tracking-wide uppercase text-text-secondary mb-1.5">{noShow ? 'These will be no-show' : 'These will be cancelled'}</p>
              <div className="border border-border rounded-spa">{change.map((r) => <Row key={r.id} r={r} />)}</div>
            </div>
          )}
          {keep.length > 0 && (
            <div>
              <p className="text-xs font-medium tracking-wide uppercase text-text-secondary mb-1.5">These stay</p>
              <div className="border border-border rounded-spa">{keep.map((r) => <Row key={r.id} r={r} />)}</div>
            </div>
          )}
          {!nothing && (noShow ? (
            <div>
              <label htmlFor="visit-noshow-note" className="block text-sm font-medium text-text-primary mb-1.5">Note <span className="text-text-tertiary font-normal">(optional)</span></label>
              <input id="visit-noshow-note" type="text" value={custom} onChange={(e) => setCustom(e.target.value)} disabled={isSubmitting} placeholder="e.g. Didn't arrive and didn't call"
                className="w-full h-10 px-3 border border-border rounded-spa text-sm text-text-primary bg-surface focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">Reason <span className="text-error">*</span></label>
                <CustomSelect value={selected} onChange={setSelected} options={reasonOptions} placeholder="Select a reason..." disabled={isSubmitting} />
              </div>
              {isOthers && (
                <textarea value={custom} onChange={(e) => setCustom(e.target.value)} rows={3} placeholder="Explain why..." disabled={isSubmitting}
                  className="w-full px-3 py-2 border border-border rounded-spa text-sm text-text-primary bg-surface focus:outline-none focus:ring-2 focus:ring-primary/40" />
              )}
            </div>
          ))}
          {error && (
            <div role="alert" className="flex items-start gap-2 bg-error/5 border border-error/20 rounded-spa p-3">
              <Icon name="AlertCircle" size={16} className="text-error flex-shrink-0 mt-0.5" />
              <p className="text-sm text-error">{error}</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end space-x-3 p-5 border-t border-border">
          {nothing ? (
            <Button variant="primary" onClick={onClose}>OK</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={isSubmitting}>Back</Button>
              <Button variant="danger" onClick={() => onConfirm(reasonText)} disabled={isSubmitting || !reasonOk}>
                {noShow ? `Mark ${n} service${n > 1 ? 's' : ''} no-show` : `Cancel ${n} service${n > 1 ? 's' : ''}`}
              </Button>
            </>
          )}
        </div>
      </div>
    </ModalShell>
  );
};

export default VisitStatusDialog;

// Loads the dry run, shows the dialog, then makes the real all-or-nothing call. Mount it when the person picks Cancel / No-show on a 2+ service booking.
export const VisitStatusFlow = ({ visitKey, kind, lines, reasonOptions, onClose, onDone }) => {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const status = kind === 'no show' ? 'No Show' : 'Cancelled';
  React.useEffect(() => {
    let off = false;
    visitSetStatus({ visitKey, status, dryRun: true }).then(({ data, error: e }) => {
      if (off) return;
      // Nothing left to change (every service started / done / paid): the "nothing can be cancelled" dialog (C3), listing what stays.
      if (e && e.code === 'NOTHING_TO_CHANGE') { setPreview(splitStatusPreview({ rows: e.rows || [] }, lines)); return; }
      if (e) { setError(friendlyError(e, 'Could not check this booking. Try again.')); return; }
      setPreview(splitStatusPreview(data, lines));
    });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitKey, status]);
  if (!preview) {
    return error ? <VisitStatusDialog kind={kind} preview={{ change: [], keep: [] }} reasonOptions={reasonOptions} onClose={onClose} onConfirm={() => {}} error={error} /> : null;
  }
  return (
    <VisitStatusDialog
      kind={kind}
      preview={preview}
      reasonOptions={reasonOptions}
      isSubmitting={busy}
      error={error}
      onClose={onClose}
      onConfirm={async (reason) => {
        setBusy(true); setError(null);
        const { error: e } = await visitSetStatus({ visitKey, status, reason });
        setBusy(false);
        if (e) { setError(friendlyError(e, 'Nothing was changed. Try again.')); return; }
        onDone();
      }}
    />
  );
};
