import React from 'react';
import Icon from '../AppIcon';

function formatNPR(amount) {
  return `NPR ${Number(amount).toLocaleString('en-IN')}`;
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// Voucher balance banner at checkout (migration-075) — same "balance → balance
// after this payment" pattern as MembershipWalletCard, for a gift voucher
// picked via the Voucher payment-method search. Vouchers have no customer_id
// link, so unlike Membership there's nothing to auto-load; this only ever
// shows vouchers staff have already searched for and attached to a tender.
const VoucherWalletCard = ({ vouchers }) => {
  const list = (vouchers || []).filter(v => v.voucherId);
  if (list.length === 0) return null;

  return (
    <div className="space-y-2">
      {list.map((v) => {
        const projectedBalance = Math.max(round2(v.balance) - round2(v.pendingDeduction), 0);
        return (
          <div key={v.voucherId} className="rounded-spa border bg-primary/5 border-primary/20 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 min-w-0">
                <Icon name="Ticket" size={14} className="text-primary flex-shrink-0" />
                <span className="font-data font-data-medium text-sm text-text-primary truncate">{v.code}</span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className={`font-data font-data-medium text-sm text-primary ${v.pendingDeduction > 0 ? 'line-through text-text-tertiary' : ''}`}>
                  {formatNPR(v.balance)}
                </span>
                {v.pendingDeduction > 0 && (
                  <>
                    <Icon name="ArrowRight" size={12} className="text-text-secondary" />
                    <span className="font-data font-data-medium text-sm text-primary">{formatNPR(projectedBalance)}</span>
                  </>
                )}
              </div>
            </div>
            {v.pendingDeduction > 0 && (
              <p className="mt-1.5 font-caption text-[11px] text-text-secondary">
                Left after this payment: {formatNPR(projectedBalance)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default VoucherWalletCard;
