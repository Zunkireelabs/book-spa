import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { fetchMembershipTransactions } from '../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatDate(d) {
  return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

const STATUS_COLORS = {
  active: 'bg-success/10 text-success',
  depleted: 'bg-amber-100 text-amber-800',
  pending: 'bg-amber-100 text-amber-800',
  lapsed: 'bg-error/10 text-error',
};

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

  return (
    <div className="space-y-4">
      <div className="bg-background rounded-spa p-3 flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <span className="font-body font-body-medium text-sm text-text-primary">{membership.tierName}</span>
            <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-caption font-caption-medium ${STATUS_COLORS[membership.status] || 'bg-background text-text-secondary'}`}>
              {membership.status}
            </span>
          </div>
          <p className="font-caption text-xs text-text-tertiary">
            {membership.membershipNumber} · Expires {formatDate(membership.expiryDate)}
          </p>
        </div>
        <p className="font-data font-data-medium text-base text-text-primary">{formatNPR(membership.balance)}</p>
      </div>

      <div>
        <h4 className="font-body font-body-medium text-sm text-text-primary mb-2">Transaction History</h4>
        {loading ? (
          <div className="py-6 text-center">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto" />
          </div>
        ) : transactions.length === 0 ? (
          <p className="font-body text-sm text-text-tertiary">No transactions yet</p>
        ) : (
          <div className="space-y-2">
            {transactions.map((t) => (
              <div key={t.id} className="bg-background rounded-spa p-3 flex items-center justify-between">
                <div>
                  <span className="font-body text-sm text-text-primary capitalize">{t.kind}</span>
                  <p className="font-caption text-xs text-text-tertiary">
                    {formatDate(t.created_at)} · {t.performer?.full_name || 'System'}
                  </p>
                </div>
                <span className={`font-data font-data-medium text-sm ${Number(t.amount) < 0 ? 'text-error' : 'text-success'}`}>
                  {Number(t.amount) < 0 ? '' : '+'}{formatNPR(t.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomerMembershipTab;
