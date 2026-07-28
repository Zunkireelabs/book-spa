import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { fetchMemberships, fetchMembershipLedgerReport } from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Wallet Usage: per-member view of "how much wallet value they had, how much
// they've used, and how much is left" — plus, per member, the individual
// service-usage transactions behind that number. "Wallet Amount" is the
// CURRENT CYCLE deposit only (e.g. 100,000 for a Premium Club member, not
// 200,000 after a renewal) — see fetchMembershipLedgerReport's cycleDeposited
// in services/api.js for why total_deposited can't be used as-is here. Balance
// still reuses the exact `balance` field the existing Memberships page shows,
// so Remaining always reconciles with it. The per-transaction rows come from
// the real `membership_transactions` ledger (kind='deduction') joined to the
// booking that was paid for. No fabricated data.
const WalletUsagePanel = () => {
  const [memberships, setMemberships] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [cycleDeposited, setCycleDeposited] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [membershipsRes, ledgerRes] = await Promise.all([
      fetchMemberships(),
      fetchMembershipLedgerReport(),
    ]);
    if (membershipsRes.error || ledgerRes.error) {
      setError((membershipsRes.error || ledgerRes.error)?.message || 'Failed to load wallet usage.');
      setLoading(false);
      return;
    }
    setMemberships(membershipsRes.data || []);
    setTransactions(ledgerRes.data?.usage || []);
    setCycleDeposited(ledgerRes.data?.cycleDeposited || new Map());
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const totals = useMemo(() => {
    const deposited = memberships.reduce((sum, m) => sum + (cycleDeposited.get(m.id) ?? Number(m.totalDeposited || 0)), 0);
    const balance = memberships.reduce((sum, m) => sum + Number(m.balance || 0), 0);
    return { deposited, balance, used: deposited - balance };
  }, [memberships, cycleDeposited]);

  // One row per member: their wallet totals, plus their own usage transactions nested underneath.
  const memberRows = useMemo(() => {
    const txByMembership = new Map();
    transactions.forEach((t) => {
      if (!txByMembership.has(t.membershipId)) txByMembership.set(t.membershipId, []);
      txByMembership.get(t.membershipId).push(t);
    });
    return memberships
      .map((m) => {
        const deposited = cycleDeposited.get(m.id) ?? Number(m.totalDeposited || 0);
        const balance = Number(m.balance || 0);
        return {
          membershipId: m.id,
          memberName: m.customerName || '—',
          cardNo: m.membershipNumber || '—',
          tierName: m.tierName || '—',
          deposited,
          used: deposited - balance,
          balance,
          transactions: txByMembership.get(m.id) || [],
        };
      })
      .sort((a, b) => a.memberName.localeCompare(b.memberName));
  }, [memberships, transactions, cycleDeposited]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return memberRows;
    return memberRows.filter((r) =>
      r.memberName.toLowerCase().includes(q) || r.cardNo.toLowerCase().includes(q)
    );
  }, [memberRows, search]);

  const serviceBreakdown = useMemo(() => {
    const map = new Map();
    transactions.forEach((t) => {
      const key = t.service || 'Other';
      map.set(key, (map.get(key) || 0) + Number(t.amountUsed || 0));
    });
    const list = Array.from(map.entries())
      .map(([service, amount]) => ({ service, amount }))
      .sort((a, b) => b.amount - a.amount);
    const total = list.reduce((sum, s) => sum + s.amount, 0);
    return { list, total };
  }, [transactions]);

  const toggleExpand = (membershipId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(membershipId) ? next.delete(membershipId) : next.add(membershipId);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-surface rounded-spa-lg border border-border p-4 animate-pulse">
              <div className="h-3 bg-background rounded w-20 mb-2" />
              <div className="h-6 bg-background rounded w-24" />
            </div>
          ))}
        </div>
        <div className="bg-surface rounded-spa-lg border border-border p-8 animate-pulse">
          <div className="h-4 bg-background rounded w-48 mb-4" />
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-10 bg-background rounded" />)}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-error/5 border border-error/20 rounded-spa p-4 flex items-center space-x-3">
        <Icon name="AlertCircle" size={18} className="text-error flex-shrink-0" />
        <p className="font-body text-sm text-error">{error}</p>
        <button onClick={loadData} className="ml-auto font-body font-body-medium text-sm text-error underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Wallet Usage</h3>
        <p className="font-body text-sm text-text-secondary">
          {memberRows.length} member{memberRows.length !== 1 ? 's' : ''} · {transactions.length} service-usage transaction{transactions.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-surface rounded-spa-lg border border-border p-4">
          <div className="flex items-center space-x-2 mb-2">
            <div className="w-6 h-6 rounded flex items-center justify-center bg-primary/10">
              <Icon name="ArrowDownToLine" size={14} className="text-primary" />
            </div>
            <span className="font-caption font-caption-normal text-[11px] text-text-tertiary uppercase tracking-wide">Total Deposited</span>
          </div>
          <p className="font-heading font-heading-semibold text-xl text-text-primary">{formatNPR(totals.deposited)}</p>
        </div>
        <div className="bg-surface rounded-spa-lg border border-border p-4">
          <div className="flex items-center space-x-2 mb-2">
            <div className="w-6 h-6 rounded flex items-center justify-center bg-warning/10">
              <Icon name="ArrowUpFromLine" size={14} className="text-warning" />
            </div>
            <span className="font-caption font-caption-normal text-[11px] text-text-tertiary uppercase tracking-wide">Total Used</span>
          </div>
          <p className="font-heading font-heading-semibold text-xl text-warning">{formatNPR(totals.used)}</p>
        </div>
        <div className="bg-primary/5 rounded-spa-lg border border-primary/20 p-4">
          <div className="flex items-center space-x-2 mb-2">
            <div className="w-6 h-6 rounded flex items-center justify-center bg-primary/15">
              <Icon name="Wallet" size={14} className="text-primary" />
            </div>
            <span className="font-caption font-caption-normal text-[11px] text-primary uppercase tracking-wide">Remaining</span>
          </div>
          <p className="font-heading font-heading-semibold text-xl text-primary">{formatNPR(totals.balance)}</p>
        </div>
      </div>

      {/* Search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Icon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            placeholder="Search by member or card no..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-spa text-sm font-body text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
        <span className="font-caption font-caption-normal text-xs text-text-tertiary">
          {filtered.length} member{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Per-member table — click a row to see the services behind the numbers */}
      <div className="bg-surface rounded-spa-lg border border-border overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <Icon name="Wallet" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body font-body-medium text-sm text-text-secondary">
              {memberRows.length === 0 ? 'No members yet' : 'No members match your search'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-background border-b border-border">
                  <th className="w-8 px-2 py-2.5" />
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Member</th>
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Card No.</th>
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Tier</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Wallet Amount</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Used</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const isOpen = expanded.has(m.membershipId);
                  const hasUsage = m.transactions.length > 0;
                  return (
                    <React.Fragment key={m.membershipId}>
                      <tr
                        onClick={() => hasUsage && toggleExpand(m.membershipId)}
                        className={`border-b border-border last:border-0 spa-transition-fast ${
                          hasUsage ? 'cursor-pointer hover:bg-background/50' : ''
                        }`}
                      >
                        <td className="px-2 py-3 text-text-tertiary">
                          {hasUsage && <Icon name={isOpen ? 'ChevronUp' : 'ChevronDown'} size={16} />}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-body font-body-medium text-sm text-text-primary">{m.memberName}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-data font-data-normal text-xs text-text-secondary tracking-wide">{m.cardNo}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-body font-body-normal text-sm text-text-secondary">{m.tierName}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-data font-data-normal text-sm text-text-secondary">{formatNPR(m.deposited)}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-data font-data-medium text-sm text-warning">{formatNPR(m.used)}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-data font-data-medium text-sm text-primary">{formatNPR(m.balance)}</span>
                        </td>
                      </tr>

                      {isOpen && m.transactions.map((t) => (
                        <tr key={t.id} className="border-b border-border last:border-0 bg-background/30">
                          <td />
                          <td colSpan={6} className="px-4 py-2.5">
                            <div className="flex items-center justify-between gap-3 flex-wrap pl-4">
                              <div className="flex items-center gap-2 min-w-0">
                                <Icon name="Sparkles" size={13} className="text-text-tertiary flex-shrink-0" />
                                <span className="font-body font-body-medium text-sm text-text-primary">{t.service}</span>
                                <span className="font-caption text-xs text-text-tertiary">{formatDate(t.date)}</span>
                              </div>
                              <div className="flex items-center gap-4 flex-shrink-0">
                                <span className="font-data text-sm text-warning">-{formatNPR(t.amountUsed)}</span>
                                <span className="font-data text-xs text-text-secondary w-28 text-right">
                                  Balance after: {formatNPR(t.remainingBalance)}
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-background border-t-2 border-border">
                  <td />
                  <td colSpan={3} className="px-4 py-3 font-body font-body-semibold text-sm text-text-primary">Total</td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-text-primary">{formatNPR(totals.deposited)}</td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-warning">{formatNPR(totals.used)}</td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-primary">{formatNPR(totals.balance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Service-wise breakdown */}
      {serviceBreakdown.list.length > 0 && (
        <div className="bg-surface rounded-spa-lg border border-border overflow-hidden">
          <div className="px-4 py-2.5 bg-background border-b border-border">
            <span className="font-body font-body-medium text-xs text-text-secondary">Service-wise Usage Breakdown</span>
          </div>
          <table className="w-full">
            <tbody>
              {serviceBreakdown.list.map((s) => (
                <tr key={s.service} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="font-body font-body-normal text-sm text-text-primary">{s.service}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="font-data font-data-medium text-sm text-text-secondary">{formatNPR(s.amount)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-background border-t-2 border-border">
                <td className="px-4 py-3 font-body font-body-semibold text-sm text-text-primary">Total</td>
                <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-text-primary">{formatNPR(serviceBreakdown.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
};

export default WalletUsagePanel;
