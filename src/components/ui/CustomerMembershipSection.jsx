import React from 'react';
import MembershipWalletCard from './MembershipWalletCard';

const KIND_LABEL = {
  deposit: 'Deposit',
  deduction: 'Deduction',
  birthday_perk: 'Birthday Gift',
  adjustment: 'Adjustment',
  extension: 'Extended',
};

const ZERO_AMOUNT_KINDS = new Set(['birthday_perk', 'extension']);

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const CustomerMembershipSection = ({ membership, transactions = [] }) => {
  if (!membership) return null;

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-text-primary mb-4">Your membership</h2>
      <MembershipWalletCard membership={membership} />

      {transactions.length > 0 && (
        <div className="mt-3 divide-y divide-border border border-border rounded-spa overflow-hidden">
          {transactions.map((t) => (
            <div key={t.id} className="px-4 py-2.5 flex items-center justify-between gap-4 bg-surface">
              <div>
                <p className="text-sm text-text-primary">{KIND_LABEL[t.kind] || 'Adjustment'}</p>
                <p className="text-xs text-text-secondary">{formatDateTime(t.created_at)}</p>
              </div>
              <span className="font-data text-sm text-text-primary">
                {ZERO_AMOUNT_KINDS.has(t.kind) ? '—' : formatNPR(Math.abs(Number(t.amount || 0)))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CustomerMembershipSection;
