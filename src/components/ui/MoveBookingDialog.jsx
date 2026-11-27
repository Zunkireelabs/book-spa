import React, { useEffect, useState } from 'react';
import Icon from '../AppIcon';
import Button from './Button';
import ModalShell from './ModalShell';
import { visitReschedule } from '../../services/visitApi';
import { friendlyError } from '../../utils/friendlyError';
import { time12 } from '../../utils/visitPreview';

// ZNLY-402 piece 5 (screen E2/E3): "Move this booking?". visit_reschedule dry run gives each service its verdict at the picked time:
//   'change' = free, 'warn' = overridable (a manager books anyway with a reason), 'block' = a hard no, 'keep' = already started, stays.
// `lines` = { [booking_id]: { name, price, minutes, staff } } from the "This booking" block (the dry run does not carry prices).
const money = (n) => `NPR ${Number(n || 0).toLocaleString('en-IN')}`;
const addMin = (t, m) => { const [h, mm] = String(t).split(':').map(Number); const x = h * 60 + (mm || 0) + (m || 0); return `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
const dayLabel = (d) => { try { return new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', ''); } catch { return d; } };

const MoveBookingDialog = ({ visitKey, date, startTime, lines, canOverride, onClose, onDone }) => {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => {
    let off = false;
    visitReschedule({ visitKey, date, startTime, dryRun: true }).then(({ data, error: e }) => {
      if (off) return;
      if (e) {
        // A refusal of the whole move (e.g. the studio is closed that day) comes back as one blocked line.
        setPreview({ rows: e.rows?.length ? e.rows : [{ booking_id: 'all', verdict: 'block', reason: friendlyError(e, 'This booking can\'t be moved to that time.') }] });
        return;
      }
      setPreview({ rows: data?.rows || [] });
    });
    return () => { off = true; };
  }, [visitKey, date, startTime]);
  if (!preview) return null;

  const rows = preview.rows;
  const moving = rows.filter((r) => r.verdict !== 'keep');
  const blocked = rows.some((r) => r.verdict === 'block');
  const warned = rows.some((r) => r.verdict === 'warn');
  const needReason = warned && !blocked;
  const reasonMissing = needReason && canOverride && !reason.trim();
  const cannotOverride = needReason && !canOverride;
  const tone = blocked ? 'error' : warned ? 'warning' : 'success';

  const go = async () => {
    setBusy(true); setError(null);
    const { error: e } = await visitReschedule({ visitKey, date, startTime, overrideReason: needReason ? reason.trim() : null });
    setBusy(false);
    if (e) { setError(friendlyError(e, 'Nothing was moved. Try again.')); return; }
    onDone();
  };

  return (
    <ModalShell onClose={busy ? undefined : onClose} data-move-booking-dialog>
      <div>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center space-x-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${tone === 'error' ? 'bg-error/10' : 'bg-warning/10'}`}>
              <Icon name="AlertTriangle" size={20} className={tone === 'error' ? 'text-error' : 'text-warning'} />
            </div>
            <h2 className="font-heading font-heading-semibold text-lg text-text-primary">Move this booking?</h2>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="p-2 rounded-spa hover:bg-background spa-transition-fast spa-touch-target"><Icon name="X" size={20} className="text-text-secondary" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-text-secondary">{dayLabel(date)} · from {time12(startTime)}</p>
          <div className="border border-border rounded-spa">
            {moving.map((r) => {
              // booking_id is the ORIGINAL row (what the screen shows); the replacement is new_booking_id. r.start is the NEW start time.
              const l = lines?.[r.booking_id] || {};
              const start = r.start || startTime;
              const range = l.minutes ? `${time12(start)}–${time12(addMin(String(start).slice(0, 5), l.minutes))}` : time12(start);
              const v = r.verdict;
              return (
                <div key={r.booking_id} className="flex items-start gap-2.5 px-3 py-2 border-b border-border last:border-b-0">
                  <span className="mt-0.5 flex-shrink-0">
                    {v === 'block' ? <Icon name="Ban" size={15} className="text-error" /> : v === 'warn' ? <Icon name="AlertTriangle" size={15} className="text-warning" /> : <Icon name="Check" size={15} className="text-success" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-3">
                      <p className="text-sm font-medium text-text-primary truncate">{r.service || l.name || 'Booking'}</p>
                      {l.price != null && <span className="font-data text-sm tabular-nums flex-shrink-0">{money(l.price)}</span>}
                    </div>
                    {r.booking_id !== 'all' && <p className="text-xs text-text-secondary">{range}{(r.staff || l.staff) ? ` · ${r.staff || l.staff}` : ''}{v === 'change' ? ' · free' : ''}</p>}
                    {v !== 'change' && r.reason && <p className={`text-xs mt-0.5 ${v === 'block' ? 'text-error' : 'text-[#92400E]'}`}>{r.reason}</p>}
                  </div>
                </div>
              );
            })}
          </div>
          {needReason && canOverride && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Reason to book anyway <span className="text-error">*</span></label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Why is this ok?" disabled={busy}
                className="w-full px-3 py-2 border border-border rounded-spa text-sm text-text-primary bg-surface focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </div>
          )}
          {cannotOverride && <p className="text-sm text-warning">Ask a manager to book this anyway.</p>}
          {rows.some((r) => r.verdict === 'keep') && <p className="text-xs text-text-secondary">Started services stay where they are.</p>}
          {error && (
            <div role="alert" className="flex items-start gap-2 bg-error/5 border border-error/20 rounded-spa p-3">
              <Icon name="AlertCircle" size={16} className="text-error flex-shrink-0 mt-0.5" /><p className="text-sm text-error">{error}</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end space-x-3 p-5 border-t border-border">
          <Button variant="outline" onClick={onClose} disabled={busy}>Back</Button>
          <Button variant="primary" onClick={go} disabled={busy || blocked || cannotOverride || reasonMissing || moving.length === 0}>Move booking</Button>
        </div>
      </div>
    </ModalShell>
  );
};

export default MoveBookingDialog;
