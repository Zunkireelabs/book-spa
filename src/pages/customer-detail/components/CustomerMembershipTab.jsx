import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { fetchMembershipTransactions } from '../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

const formatShort = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kathmandu' }) : '—');

function formatDate(d) {
  return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

// Human words for the stored status, never the raw value. A lapsed membership shows no balance.
const STATUS = {
  active: { label: 'Active', pill: 'bg-success/10 text-success' },
  pending: { label: 'Not started', pill: 'bg-warning/10 text-warning' },
  depleted: { label: 'Used up', pill: 'bg-background text-text-secondary border border-border' },
  lapsed: { label: 'Lapsed', pill: 'bg-error/10 text-error' },
};
const KIND = { deposit: 'Money added', deduction: 'Used', refund: 'Refunded', adjustment: 'Adjusted' };
const kindLabel = (k) => KIND[k] || String(k || '').replace(/[_-]/g, ' ').replace(/^./, (c) => c.toUpperCase());

// Our closest real equivalent to Timely's "Credit" tab — our actual feature
// is Membership (tier/balance/transactions), labeled honestly rather than
// renamed to match Timely's term for a concept we don't have.
const CustomerMembershipTab = ({ membership }) => {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(!!membership);

  const load = useCallback(async () => {
    if (!membership) return;
    setLoading(true);
    const result = await fetchMembershipTransactions(membership.id);
    if (!result.error) setTransactions(result.data || []);
    setLoading(false);
  }, [membership]);

  useEffect(() => { load(); }, [load]);

  if (!membership) {
    return (
      <div className="text-center py-8">
        <Icon name="CreditCard" size={24} className="text-text-tertiary mx-auto mb-2" />
        <p className="font-body text-sm text-text-tertiary">No active membership</p>
      </div>
    );
  }

  const st = STATUS[membership.status] || { label: String(membership.status || '').replace(/^./, (c) => c.toUpperCase()), pill: 'bg-background text-text-secondary' };
  const showBalance = membership.status !== 'lapsed';
  const Cell = ({ k, v }) => <div className="min-w-0"><span className="block text-xs text-text-secondary">{k}</span><span className="block text-[13px] font-medium text-text-primary tabular-nums truncate">{v}</span></div>;

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-spa-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <b className="text-sm font-semibold text-text-primary">{membership.tierName} membership</b>
          <span className={`h-[22px] px-2.5 rounded-full text-xs inline-flex items-center ${st.pill}`}>{st.label}</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Cell k="Number" v={membership.membershipNumber || '—'} />
          <Cell k="Until" v={formatDate(membership.expiryDate)} />
          {showBalance && <Cell k="Balance" v={formatNPR(membership.balance)} />}
        </div>
      </div>

      <div className="border border-border rounded-spa-lg">
        <h4 className="text-sm font-semibold text-text-primary px-4 py-3 border-b border-border">Transactions</h4>
        {loading ? (
          <div className="py-6 text-center">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto" />
          </div>
        ) : transactions.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-text-secondary">No transactions yet</p>
        ) : transactions.map((t) => (
          <div key={t.id} className="grid grid-cols-[72px_minmax(0,1fr)_auto] gap-3 items-center px-4 py-3 border-b border-border last:border-b-0 text-[13px] text-text-secondary">
            <span className="tabular-nums text-text-primary font-semibold">{formatShort(t.created_at)}</span>
            <span className="min-w-0 truncate">{kindLabel(t.kind)} · by {t.performer?.full_name || 'System'}</span>
            <span className={`tabular-nums font-medium ${Number(t.amount) < 0 ? 'text-error' : 'text-success'}`}>{Number(t.amount) < 0 ? '−' : '+'}{formatNPR(Math.abs(t.amount))}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CustomerMembershipTab;
