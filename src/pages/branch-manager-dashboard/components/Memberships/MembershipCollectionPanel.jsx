import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { fetchMemberships, fetchMembershipLedgerReport } from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

// Membership Collection: how much wallet value has been collected, broken down
// by tier. "Total Deposited" is the CURRENT CYCLE deposit per membership (e.g.
// 100,000 for a renewed Premium Club card, not 200,000 across both cycles) —
// see fetchMembershipLedgerReport's cycleDeposited in services/api.js.
// Remaining Balance still reuses the exact `balance` field the existing
// Memberships page renders, so it reconciles exactly with that page. Lapsed/
// Depleted memberships are included: their historical deposited amount and
// real remaining balance must stay visible in collection totals.
const MembershipCollectionPanel = () => {
  const [rows, setRows] = useState([]);
  const [cycleDeposited, setCycleDeposited] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [membershipsRes, ledgerRes] = await Promise.all([
      fetchMemberships(),
      fetchMembershipLedgerReport(),
    ]);
    if (membershipsRes.error || ledgerRes.error) {
      setError((membershipsRes.error || ledgerRes.error)?.message || 'Failed to load memberships.');
      setLoading(false);
      return;
    }
    setRows(membershipsRes.data || []);
    setCycleDeposited(ledgerRes.data?.cycleDeposited || new Map());
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const { tiers, grandTotal } = useMemo(() => {
    const map = new Map();
    rows.forEach((m) => {
      const key = m.tierName || 'Unassigned';
      if (!map.has(key)) {
        map.set(key, { tier: key, advanceAmount: m.tierAdvanceAmount ?? 0, members: 0, deposited: 0, balance: 0 });
      }
      const entry = map.get(key);
      entry.members += 1;
      entry.deposited += cycleDeposited.get(m.id) ?? Number(m.totalDeposited || 0);
      entry.balance += Number(m.balance || 0);
    });

    const tiers = Array.from(map.values())
      .map((t) => ({ ...t, used: t.deposited - t.balance }))
      .sort((a, b) => (a.advanceAmount || 0) - (b.advanceAmount || 0));

    const grandTotal = tiers.reduce(
      (acc, t) => ({
        members: acc.members + t.members,
        deposited: acc.deposited + t.deposited,
        used: acc.used + t.used,
        balance: acc.balance + t.balance,
      }),
      { members: 0, deposited: 0, used: 0, balance: 0 }
    );

    return { tiers, grandTotal };
  }, [rows, cycleDeposited]);

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
        <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Collection</h3>
        <p className="font-body text-sm text-text-secondary">
          Total value collected across {grandTotal.members} membership{grandTotal.members !== 1 ? 's' : ''}, by tier
        </p>
      </div>

      {/* Summary cards: one per tier + grand total */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {tiers.map((t) => (
          <div key={t.tier} className="bg-surface rounded-spa-lg border border-border p-4">
            <div className="flex items-center space-x-2 mb-2">
              <div className="w-6 h-6 rounded flex items-center justify-center bg-primary/10">
                <Icon name="CreditCard" size={14} className="text-primary" />
              </div>
              <span className="font-caption font-caption-normal text-[11px] text-text-tertiary uppercase tracking-wide">
                {t.tier}
              </span>
            </div>
            <p className="font-heading font-heading-semibold text-xl text-text-primary">{formatNPR(t.deposited)}</p>
            <p className="font-caption text-xs text-text-tertiary mt-1">{t.members} member{t.members !== 1 ? 's' : ''}</p>
          </div>
        ))}
        <div className="bg-primary/5 rounded-spa-lg border border-primary/20 p-4">
          <div className="flex items-center space-x-2 mb-2">
            <div className="w-6 h-6 rounded flex items-center justify-center bg-primary/15">
              <Icon name="PiggyBank" size={14} className="text-primary" />
            </div>
            <span className="font-caption font-caption-normal text-[11px] text-primary uppercase tracking-wide">
              Grand Total
            </span>
          </div>
          <p className="font-heading font-heading-semibold text-xl text-primary">{formatNPR(grandTotal.deposited)}</p>
          <p className="font-caption text-xs text-text-tertiary mt-1">{grandTotal.members} member{grandTotal.members !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Breakdown table */}
      <div className="bg-surface rounded-spa-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-background border-b border-border">
                <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Membership Tier</th>
                <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Members</th>
                <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Total Deposited</th>
                <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Total Used</th>
                <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Remaining Balance</th>
              </tr>
            </thead>
            <tbody>
              {tiers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12">
                    <Icon name="CreditCard" size={32} className="text-text-tertiary mx-auto mb-3" />
                    <p className="font-body font-body-medium text-sm text-text-secondary">No members yet</p>
                  </td>
                </tr>
              ) : (
                tiers.map((t) => (
                  <tr key={t.tier} className="border-b border-border last:border-0 hover:bg-background/50 spa-transition-fast">
                    <td className="px-4 py-3">
                      <span className="font-body font-body-medium text-sm text-text-primary">{t.tier}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-data font-data-normal text-sm text-text-secondary">{t.members}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-data font-data-medium text-sm text-text-primary">{formatNPR(t.deposited)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-data font-data-normal text-sm text-text-secondary">{formatNPR(t.used)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-data font-data-medium text-sm text-primary">{formatNPR(t.balance)}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {tiers.length > 0 && (
              <tfoot>
                <tr className="bg-background border-t-2 border-border">
                  <td className="px-4 py-3 font-body font-body-semibold text-sm text-text-primary">Grand Total</td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-text-primary">{grandTotal.members}</td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-text-primary">{formatNPR(grandTotal.deposited)}</td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-text-primary">{formatNPR(grandTotal.used)}</td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-primary">{formatNPR(grandTotal.balance)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};

export default MembershipCollectionPanel;
