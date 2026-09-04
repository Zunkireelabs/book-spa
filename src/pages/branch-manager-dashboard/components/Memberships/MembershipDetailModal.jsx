import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import { fetchMembership, fetchMembershipTransactions } from '../../../../services/api';
import TopUpModal from './TopUpModal';
import RenewModal from './RenewModal';
import ExtendMembershipModal from './ExtendMembershipModal';
import BirthdayPerkModal from './BirthdayPerkModal';
import AdjustmentModal from './AdjustmentModal';

const STATUS_CONFIG = {
  active:   { label: 'Active',   pill: 'bg-success/10 text-success',   icon: 'CheckCircle2' },
  pending:  { label: 'Pending',  pill: 'bg-amber-100 text-amber-800',  icon: 'Clock' },
  lapsed:   { label: 'Lapsed',   pill: 'bg-warning/10 text-warning',   icon: 'AlertTriangle' },
  depleted: { label: 'Depleted', pill: 'bg-gray-100 text-gray-600',    icon: 'CircleSlash' },
};

const KIND_CONFIG = {
  deposit:       { label: 'Deposit',      color: 'text-success',    sign: '+' },
  deduction:     { label: 'Deduction',    color: 'text-error',      sign: '' },
  birthday_perk: { label: 'Birthday Gift', color: 'text-accent',     sign: '' },
  adjustment:    { label: 'Adjustment',   color: 'text-text-secondary', sign: '' },
  extension:     { label: 'Extended',     color: 'text-primary',    sign: '' },
};

// Kinds that are informational-only (amount is always 0) -- shown as an em
// dash in the transaction table instead of "+0"/"0".
const ZERO_AMOUNT_KINDS = new Set(['birthday_perk', 'extension']);

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Birthday perk is one per membership cycle. Returns true if a perk has already
// been used between the activation_date and expiry_date.
function perkUsedInCurrentCycle(m) {
  if (!m?.birthdayPerkUsedAt || !m.activationDate) return false;
  const used = new Date(m.birthdayPerkUsedAt);
  const start = new Date(m.activationDate + 'T00:00:00');
  const end = m.expiryDate ? new Date(m.expiryDate + 'T23:59:59') : null;
  if (used < start) return false;
  if (end && used > end) return false;
  return true;
}

const MembershipDetailModal = ({ membershipId, isAdmin = false, branchId, onClose, onChanged }) => {
  const [m, setMembership] = useState(null);
  const [txns, setTxns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showTopUp, setShowTopUp] = useState(false);
  const [showRenew, setShowRenew] = useState(false);
  const [showExtend, setShowExtend] = useState(false);
  const [showBirthday, setShowBirthday] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);

  const reload = useCallback(async () => {
    if (!membershipId) return;
    setLoading(true);
    setError(null);
    const [mRes, tRes] = await Promise.all([
      fetchMembership(membershipId),
      fetchMembershipTransactions(membershipId),
    ]);
    if (mRes.error) { setError(mRes.error.message || 'Failed to load membership.'); setLoading(false); return; }
    if (tRes.error) { setError(tRes.error.message || 'Failed to load transactions.'); setLoading(false); return; }
    setMembership(mRes.data);
    setTxns(tRes.data || []);
    setLoading(false);
  }, [membershipId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const cfg = m ? STATUS_CONFIG[m.status] : STATUS_CONFIG.pending;
  const perkUsed = m ? perkUsedInCurrentCycle(m) : false;
  const canBirthday = m && m.status === 'active' && !perkUsed;
  const isDepleted = m && m.status === 'depleted';
  const isLapsed = m && m.status === 'lapsed';
  const needsRenewal = isDepleted || isLapsed;

  const handleAnyChange = () => {
    reload();
    if (onChanged) onChanged();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-modal" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed inset-y-0 right-0 w-full max-w-lg bg-surface border-l border-border z-modal-overlay shadow-xl overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="membership-detail-title"
      >
        {/* Header */}
        <div className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-center justify-between z-header">
          <h2 id="membership-detail-title" className="font-heading font-heading-semibold text-lg text-text-primary">Membership detail</h2>
          <button onClick={onClose} className="p-2 rounded-spa hover:bg-background spa-transition-fast">
            <Icon name="X" size={18} className="text-text-secondary" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {loading && (
            <div className="flex flex-col items-center py-16">
              <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mb-3" />
              <p className="font-body text-sm text-text-secondary">Loading membership...</p>
            </div>
          )}

          {error && (
            <div className="bg-error/5 border border-error/20 rounded-spa p-4 flex items-center space-x-3">
              <Icon name="AlertCircle" size={18} className="text-error flex-shrink-0" />
              <p className="font-body text-sm text-error">{error}</p>
              <button onClick={reload} className="ml-auto font-body font-body-medium text-sm text-error underline">Retry</button>
            </div>
          )}

          {m && !loading && (
            <>
              {/* Card number + customer + tier + status */}
              <div className="space-y-2">
                {m.membershipNumber && (
                  <div className="flex items-center space-x-2">
                    <Icon name="CreditCard" size={14} className="text-primary" />
                    <span className="font-data font-data-medium text-sm tracking-widest text-primary">{m.membershipNumber}</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (navigator.clipboard) navigator.clipboard.writeText(m.membershipNumber).catch(() => {});
                      }}
                      title="Copy card number"
                      className="p-1 rounded-spa text-text-tertiary hover:text-primary hover:bg-primary/5 spa-transition-fast"
                    >
                      <Icon name="Copy" size={12} />
                    </button>
                  </div>
                )}
                <p className="font-heading font-heading-semibold text-base text-text-primary">{m.customerName}</p>
                <p className="font-caption text-xs text-text-tertiary">
                  {m.customerPhone || '—'}
                  {m.customerGender && <span> · {m.customerGender}</span>}
                </p>
                <div className="flex items-center space-x-2 pt-1">
                  <span className="font-body font-body-medium text-sm text-text-primary">{m.tierName}</span>
                  <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-caption font-caption-medium ${cfg.pill}`}>
                    <Icon name={cfg.icon} size={10} />
                    <span>{cfg.label}</span>
                  </span>
                </div>
              </div>

              {/* Balance card */}
              <div className="bg-primary/5 border border-primary/20 rounded-spa-lg p-4">
                <p className="font-caption text-[11px] uppercase tracking-wide text-primary/70 mb-1">Wallet balance</p>
                <p className="font-data font-data-medium text-2xl text-primary">{formatNPR(m.balance)}</p>
                <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-primary/10">
                  <div>
                    <p className="font-caption text-[10px] uppercase tracking-wide text-text-tertiary">Deposited (this cycle)</p>
                    <p className="font-data font-data-medium text-sm text-text-primary">{formatNPR(m.cycleDeposited)}</p>
                  </div>
                  <div>
                    <p className="font-caption text-[10px] uppercase tracking-wide text-text-tertiary">Tier threshold</p>
                    <p className="font-data font-data-medium text-sm text-text-primary">{formatNPR(m.tierAdvanceAmount)}</p>
                  </div>
                </div>
              </div>

              {/* Lifecycle dates */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface border border-border rounded-spa px-3 py-2">
                  <p className="font-caption text-[10px] uppercase tracking-wide text-text-tertiary">Activated</p>
                  <p className="font-body font-body-medium text-sm text-text-primary">{formatDate(m.activationDate)}</p>
                </div>
                <div className="bg-surface border border-border rounded-spa px-3 py-2">
                  <p className="font-caption text-[10px] uppercase tracking-wide text-text-tertiary">Expires</p>
                  <p className="font-body font-body-medium text-sm text-text-primary">{formatDate(m.expiryDate)}</p>
                </div>
              </div>

              {isDepleted && (
                <div className="bg-amber-50 border border-amber-200 rounded-spa px-3 py-2 flex items-start space-x-2">
                  <Icon name="RefreshCw" size={14} className="text-amber-700 flex-shrink-0 mt-0.5" />
                  <p className="font-body text-xs text-amber-900">
                    This wallet is empty. Renewing starts a fresh validity cycle from today (and can switch tier) on this
                    same card.
                  </p>
                </div>
              )}

              {isLapsed && (
                <div className="bg-amber-50 border border-amber-200 rounded-spa px-3 py-2 flex items-start space-x-2">
                  <Icon name="AlertTriangle" size={14} className="text-amber-700 flex-shrink-0 mt-0.5" />
                  <p className="font-body text-xs text-amber-900">
                    This membership has lapsed, but the {formatNPR(m.balance)} balance is still available. Extend the
                    validity to keep using it — no new payment needed.
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                {isLapsed ? (
                  <button
                    type="button"
                    onClick={() => setShowExtend(true)}
                    className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-spa bg-primary text-white text-sm font-body font-body-medium hover:bg-primary/90 spa-transition-fast"
                  >
                    <Icon name="CalendarClock" size={14} />
                    <span>Extend membership</span>
                  </button>
                ) : isDepleted ? (
                  <button
                    type="button"
                    onClick={() => setShowRenew(true)}
                    className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-spa bg-primary text-white text-sm font-body font-body-medium hover:bg-primary/90 spa-transition-fast"
                  >
                    <Icon name="RefreshCw" size={14} />
                    <span>Renew</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowTopUp(true)}
                    className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-spa bg-primary text-white text-sm font-body font-body-medium hover:bg-primary/90 spa-transition-fast"
                  >
                    <Icon name="Plus" size={14} />
                    <span>Top up</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowBirthday(true)}
                  disabled={!canBirthday}
                  title={!canBirthday ? (perkUsed ? 'Already used in this cycle' : 'Membership must be active') : undefined}
                  className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-spa border border-accent/40 text-accent text-sm font-body font-body-medium hover:bg-accent/5 disabled:opacity-40 disabled:cursor-not-allowed spa-transition-fast"
                >
                  <Icon name="Gift" size={14} />
                  <span>Apply birthday perk</span>
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setShowAdjust(true)}
                    className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-spa border border-border text-text-secondary text-sm font-body font-body-medium hover:bg-background spa-transition-fast"
                  >
                    <Icon name="Pencil" size={14} />
                    <span>Adjust</span>
                  </button>
                )}
              </div>

              {/* Notes */}
              {m.notes && (
                <div className="bg-background border border-border rounded-spa px-3 py-2">
                  <p className="font-caption text-[10px] uppercase tracking-wide text-text-tertiary mb-1">Notes</p>
                  <p className="font-body text-sm text-text-secondary whitespace-pre-wrap">{m.notes}</p>
                </div>
              )}

              {/* Transaction log */}
              <div>
                <h3 className="font-heading font-heading-semibold text-sm text-text-primary mb-2">Transaction history</h3>
                {txns.length === 0 ? (
                  <p className="font-body text-sm text-text-tertiary">No transactions yet.</p>
                ) : (
                  <div className="bg-surface border border-border rounded-spa overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-background border-b border-border">
                          <th className="text-left px-3 py-2 font-body font-body-medium text-[11px] text-text-secondary">When</th>
                          <th className="text-left px-3 py-2 font-body font-body-medium text-[11px] text-text-secondary">Kind</th>
                          <th className="text-right px-3 py-2 font-body font-body-medium text-[11px] text-text-secondary">Amount</th>
                          <th className="text-left px-3 py-2 font-body font-body-medium text-[11px] text-text-secondary hidden sm:table-cell">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {txns.map((t) => {
                          const kc = KIND_CONFIG[t.kind] || KIND_CONFIG.adjustment;
                          const amountValue = Number(t.amount || 0);
                          return (
                            <tr key={t.id} className="border-b border-border last:border-0">
                              <td className="px-3 py-2 font-caption text-[11px] text-text-secondary">{formatDateTime(t.created_at)}</td>
                              <td className="px-3 py-2 font-body text-xs text-text-primary">
                                {kc.label}
                                {t.payment_mode ? <span className="text-text-tertiary"> · {t.payment_mode}</span> : null}
                              </td>
                              <td className={`px-3 py-2 text-right font-data font-data-medium text-xs ${kc.color}`}>
                                {ZERO_AMOUNT_KINDS.has(t.kind) ? '—' : `${kc.sign}${formatNPR(Math.abs(amountValue))}`}
                              </td>
                              <td className="px-3 py-2 font-caption text-[11px] text-text-tertiary hidden sm:table-cell">{t.notes || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {showTopUp && m && (
        <TopUpModal
          membership={m}
          branchId={branchId}
          onClose={() => setShowTopUp(false)}
          onSuccess={() => { setShowTopUp(false); handleAnyChange(); }}
        />
      )}

      {showRenew && m && (
        <RenewModal
          membership={m}
          branchId={branchId}
          onClose={() => setShowRenew(false)}
          onSuccess={() => { setShowRenew(false); handleAnyChange(); }}
        />
      )}

      {showExtend && m && (
        <ExtendMembershipModal
          membership={m}
          branchId={branchId}
          onClose={() => setShowExtend(false)}
          onSuccess={() => { setShowExtend(false); handleAnyChange(); }}
        />
      )}

      {showBirthday && m && (
        <BirthdayPerkModal
          membership={m}
          branchId={branchId}
          onClose={() => setShowBirthday(false)}
          onSuccess={() => { setShowBirthday(false); handleAnyChange(); }}
        />
      )}

      {showAdjust && m && isAdmin && (
        <AdjustmentModal
          membership={m}
          branchId={branchId}
          onClose={() => setShowAdjust(false)}
          onSuccess={() => { setShowAdjust(false); handleAnyChange(); }}
        />
      )}
    </>
  );
};

export default MembershipDetailModal;
