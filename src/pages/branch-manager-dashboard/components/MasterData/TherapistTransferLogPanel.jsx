import React from 'react';
import Icon from '../../../../components/AppIcon';
import { PanelShell, FormBody } from '../../../../components/ui/PanelFormKit';

const formatDateTime = (ts) => new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const formatYmd = (ymd) => { if (!ymd) return '—'; const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };

// Read-only transfer history. `log` is null while loading. `inline` renders it as the page's Transfer log tab (V28); otherwise it is
// the right-hand panel it used to be.
const Wrap = ({ inline, title, onClose, children }) => (inline
  ? <div className="max-w-[720px] pt-4">{children}</div>
  : <PanelShell variant="panel" title={title} onClose={onClose} hideFooter><FormBody>{children}</FormBody></PanelShell>);

const TherapistTransferLogPanel = ({ log, staffLabel = 'Staff', onClose, inline = false }) => (
  <Wrap inline={inline} title={`${staffLabel} transfer log`} onClose={onClose}>
    <>
      {log === null ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading transfer history">
          {[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-spa border border-border bg-background animate-pulse" />)}
        </div>
      ) : log.length === 0 ? (
        <div className="py-10 text-center">
          <Icon name="ArrowRightLeft" size={26} className="text-text-tertiary mx-auto mb-2" />
          <p className="text-[13px] text-text-secondary">No transfers recorded yet.</p>
        </div>
      ) : (
        <ul className="border border-border rounded-spa divide-y divide-border">
          {log.map((t) => (
            <li key={t.id} className="px-3 py-2.5 text-[13px]">
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 font-body-medium text-text-primary truncate">{t.therapistName}</span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${t.applied ? 'bg-success/10 text-success' : 'bg-accent/10 text-accent'}`}>
                  <Icon name={t.applied ? 'CheckCircle' : 'Clock'} size={12} />
                  {t.applied ? 'Applied' : 'Scheduled'}
                </span>
              </div>
              <p className="text-text-secondary">{t.fromBranch} <span className="text-text-tertiary">→</span> {t.toBranch} · effective {formatYmd(t.effectiveDate)}</p>
              <p className="text-xs text-text-tertiary">Recorded {formatDateTime(t.transferredAt)}{t.transferredBy ? ` by ${t.transferredBy}` : ''}{t.note ? ` · ${t.note}` : ''}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  </Wrap>
);

export default TherapistTransferLogPanel;
