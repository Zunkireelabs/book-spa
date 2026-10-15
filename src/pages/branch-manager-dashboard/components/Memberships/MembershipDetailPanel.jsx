import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import CustomerContactQuickEdit from '../../../../components/ui/CustomerContactQuickEdit';
import { PanelShell, FormBody, InfoRows, TabBar, OverflowMenu } from '../../../../components/ui/PanelFormKit';
import { fetchMembership, fetchMembershipTransactions } from '../../../../services/api';
import { TopUpView, RenewView, ExtendView, AdjustView, BirthdayView } from './MembershipActionViews';

const STATUS_CONFIG = {
  active:   { label: 'Active',   pill: 'bg-success/10 text-success' },
  pending:  { label: 'Pending',  pill: 'bg-warning/10 text-warning' },
  lapsed:   { label: 'Lapsed',   pill: 'bg-warning/10 text-warning' },
  depleted: { label: 'Depleted', pill: 'bg-black/[0.05] text-text-secondary' },
};

const KIND_CONFIG = {
  deposit:       { label: 'Deposit',       color: 'text-success',        sign: '+' },
  deduction:     { label: 'Deduction',     color: 'text-error',          sign: '' },
  birthday_perk: { label: 'Birthday gift', color: 'text-accent',         sign: '' },
  adjustment:    { label: 'Adjustment',    color: 'text-text-secondary', sign: '' },
  extension:     { label: 'Extended',      color: 'text-primary',        sign: '' },
};

// Informational kinds (amount is always 0) show an em dash instead of "+0".
const ZERO_AMOUNT_KINDS = new Set(['birthday_perk', 'extension']);
const TABS = [{ id: 'details', label: 'Details' }, { id: 'ledger', label: 'Ledger' }];

const formatNPR = (amount) => `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
const formatDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const formatDateTime = (ts) => (ts ? new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const headerBtn = 'h-8 px-2.5 text-[13px] font-body font-body-medium rounded-spa spa-transition-fast whitespace-nowrap';

// Birthday perk is one per membership cycle: used if it falls between activation and expiry.
function perkUsedInCurrentCycle(m) {
  if (!m?.birthdayPerkUsedAt || !m.activationDate) return false;
  const used = new Date(m.birthdayPerkUsedAt);
  const start = new Date(`${m.activationDate}T00:00:00`);
  const end = m.expiryDate ? new Date(`${m.expiryDate}T23:59:59`) : null;
  if (used < start) return false;
  if (end && used > end) return false;
  return true;
}

// Membership detail in the right-hand panel. Header: the one primary action for the status (Top up / Renew / Extend) + a "⋯" menu
// (Apply birthday perk, Adjust for admin). Each action is a stacked sub-view with a back arrow; on success we land back here with the
// record refreshed in place. Same props and role gating as the modal this replaces.
const MembershipDetailPanel = ({ membershipId, isAdmin = false, readOnly = false, branchId, width, onClose, onChanged }) => {
  const { orgSlug } = useParams();
  const [m, setMembership] = useState(null);
  const [txns, setTxns] = useState([]);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('details');
  const [view, setView] = useState('detail'); // detail | topup | renew | extend | adjust | birthday
  const [notice, setNotice] = useState('');

  const reload = useCallback(async () => {
    if (!membershipId) return;
    setError(null);
    const [mRes, tRes] = await Promise.all([fetchMembership(membershipId), fetchMembershipTransactions(membershipId)]);
    if (mRes.error) { setError(mRes.error.message || 'Failed to load membership.'); return; }
    if (tRes.error) { setError(tRes.error.message || 'Failed to load transactions.'); return; }
    setMembership(mRes.data);
    setTxns(tRes.data || []);
  }, [membershipId]);

  useEffect(() => { setMembership(null); reload(); }, [reload]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const done = (message) => { setView('detail'); setNotice(message || ''); reload(); onChanged?.(); };
  const back = () => setView('detail');

  if (m && !readOnly) {
    const props = { membership: m, branchId, onBack: back, onClose, onDone: done, width };
    if (view === 'topup') return <TopUpView {...props} />;
    if (view === 'renew') return <RenewView {...props} />;
    if (view === 'extend') return <ExtendView {...props} />;
    if (view === 'adjust' && isAdmin) return <AdjustView {...props} />;
    if (view === 'birthday') return <BirthdayView {...props} />;
  }

  const cfg = m ? STATUS_CONFIG[m.status] || STATUS_CONFIG.pending : null;
  const perkUsed = m ? perkUsedInCurrentCycle(m) : false;
  const canBirthday = !!m && m.status === 'active' && !perkUsed;
  const primary = !m ? null : m.status === 'lapsed' ? { label: 'Extend', view: 'extend' } : m.status === 'depleted' ? { label: 'Renew', view: 'renew' } : { label: 'Top up', view: 'topup' };
  const menu = readOnly || !m ? [] : [
    { key: 'birthday', label: 'Apply birthday perk', icon: 'Gift', run: () => setView('birthday'), disabled: !canBirthday, reason: perkUsed ? 'Already used in this cycle' : 'Membership must be active' },
    ...(isAdmin ? [{ key: 'adjust', label: 'Adjust balance', icon: 'Pencil', run: () => setView('adjust') }] : []),
  ];

  return (
    <PanelShell
      width={width} variant="panel"
      title={m?.membershipNumber || 'Membership'}
      onClose={onClose}
      hideFooter
      headerExtra={m && !readOnly ? (
        <>
          <button type="button" onClick={() => setView(primary.view)} className={`${headerBtn} bg-primary text-white hover:bg-primary/90`}>{primary.label}</button>
          <OverflowMenu items={menu} />
        </>
      ) : null}
    >
      <FormBody>
        {!m && !error && (
          <div className="space-y-2" aria-busy="true" aria-label="Loading membership">
            {[0, 1, 2].map((i) => <div key={i} className="h-11 rounded-spa border border-border bg-background animate-pulse" />)}
          </div>
        )}
        {error && (
          <div role="alert" className="flex items-center gap-2 border border-error/30 bg-error/5 rounded-spa px-3 py-2">
            <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0" />
            <p className="flex-1 text-[13px] text-error">{error}</p>
            <button type="button" onClick={reload} className="text-[13px] font-body-medium text-error underline">Retry</button>
          </div>
        )}
        {notice && (
          <p role="status" className="flex items-start gap-2 border border-success/30 bg-success/5 rounded-spa px-3 py-2 text-[13px] text-success">
            <Icon name="CheckCircle2" size={14} className="mt-0.5 flex-shrink-0" /><span>{notice}</span>
          </p>
        )}

        {m && (
          <>
            <div>
              <div className="flex items-center gap-2">
                {m.customerId ? (
                  <Link to={`/${orgSlug}/customers/${m.customerId}`} className="font-heading font-heading-semibold text-[17px] text-text-primary hover:text-primary hover:underline">{m.customerName}</Link>
                ) : (
                  <h4 className="font-heading font-heading-semibold text-[17px] text-text-primary">{m.customerName}</h4>
                )}
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${cfg.pill}`}>{cfg.label}</span>
              </div>
              <p className="mt-1 text-[13px] text-text-secondary">
                {m.customerPhone || '—'}{m.customerGender && <span> · {m.customerGender}</span>}{m.customerEmail && <span> · {m.customerEmail}</span>}
              </p>
              {m.customerId && !readOnly && (
                <CustomerContactQuickEdit customerId={m.customerId} email={m.customerEmail} phone={m.customerPhone} onSaved={reload} />
              )}
            </div>

            <TabBar tabs={TABS} value={tab} onChange={setTab} />

            {tab === 'details' ? (
              <div className="space-y-4">
                <InfoRows rows={[
                  ['Balance', formatNPR(m.balance), 'total'],
                  ['Tier', m.tierName],
                  m.membershipNumber ? ['Card number', (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-data tracking-wide">{m.membershipNumber}</span>
                      <button
                        type="button"
                        aria-label="Copy card number"
                        title="Copy card number"
                        onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(m.membershipNumber).catch(() => {}); }}
                        className="p-1 rounded-spa text-text-tertiary hover:text-primary hover:bg-black/[0.05]"
                      >
                        <Icon name="Copy" size={12} />
                      </button>
                    </span>
                  )] : null,
                  ['Activated', formatDate(m.activationDate)],
                  ['Valid until', formatDate(m.expiryDate)],
                  ['Deposited (this cycle)', formatNPR(m.cycleDeposited)],
                  ['Tier threshold', formatNPR(m.tierAdvanceAmount)],
                ]} />
                {m.status === 'depleted' && (
                  <p className="text-[13px] text-text-secondary">This wallet is empty. Renewing starts a fresh validity cycle from today (and can switch tier) on this same card.</p>
                )}
                {m.status === 'lapsed' && (
                  <p className="text-[13px] text-text-secondary">This membership has lapsed, but the {formatNPR(m.balance)} balance is still available. Extend the validity to keep using it; no new payment needed.</p>
                )}
                {m.notes && (
                  <div>
                    <p className="mb-1.5 font-body font-body-medium text-[13px] text-text-primary">Notes</p>
                    <p className="text-[13px] text-text-secondary whitespace-pre-wrap">{m.notes}</p>
                  </div>
                )}
              </div>
            ) : txns.length === 0 ? (
              <div className="py-8 text-center">
                <Icon name="Receipt" size={24} className="text-text-tertiary mx-auto mb-2" />
                <p className="text-[13px] text-text-secondary">No transactions yet.</p>
              </div>
            ) : (
              <ul className="border border-border rounded-spa divide-y divide-border">
                {txns.map((t) => {
                  const kc = KIND_CONFIG[t.kind] || KIND_CONFIG.adjustment;
                  return (
                    <li key={t.id} className="px-3 py-2 text-[13px]">
                      <div className="flex items-center gap-3">
                        <span className="flex-1 min-w-0 text-text-primary truncate">{kc.label}{t.payment_mode ? <span className="text-text-tertiary"> · {t.payment_mode}</span> : null}</span>
                        <span className={`font-data tabular-nums ${kc.color}`}>{ZERO_AMOUNT_KINDS.has(t.kind) ? '—' : `${kc.sign}${formatNPR(Math.abs(Number(t.amount || 0)))}`}</span>
                      </div>
                      <p className="text-xs text-text-tertiary">{formatDateTime(t.created_at)}{t.notes ? ` · ${t.notes}` : ''}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </FormBody>
    </PanelShell>
  );
};

export default MembershipDetailPanel;
