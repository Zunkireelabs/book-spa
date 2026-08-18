import React from 'react';
import Icon from '../AppIcon';

function formatNPR(amount) {
  return `NPR ${Number(amount).toLocaleString('en-IN')}`;
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// Voucher balance banner at checkout (migration-075) — same "balance → balance
// after this payment" pattern as MembershipWalletCard. `vouchers` are ones
// already attached to a tender (via manual search or `available`'s Apply
// button); `available` are this booking's own customer's linked voucher(s)
// (migration-084) not yet applied — auto-surfaced the same way Membership/
// Referral Wallet are, one click to apply. A voucher only ever appears in
// `available` if it was linked to a customer at issuance; unlinked gift
// vouchers still rely on the manual Voucher payment-method search.
const VoucherWalletCard = ({ vouchers, available = [], onApply }) => {
  const list = (vouchers || []).filter(v => v.voucherId);
  if (list.length === 0 && available.length === 0) return null;

  return (
    <div className="space-y-2">
      {available.length > 0 && (
        <div className="rounded-spa border bg-primary/5 border-primary/20 px-3 py-2.5 space-y-1.5">
          {available.map((v) => (
            <div key={v.voucher_id} className="flex items-center justify-between gap-2">
              <span className="font-body font-body-normal text-xs text-text-secondary truncate">
                <span className="font-data font-data-medium text-text-primary">{v.voucher_code}</span>
                {' '}({formatNPR(v.remaining_balance)})
              </span>
              <button
                type="button"
                onClick={() => onApply(v)}
                className="flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-caption font-caption-medium bg-primary/10 text-primary hover:bg-primary/20 spa-transition-fast"
              >
                Apply
              </button>
            </div>
          ))}
        </div>
      )}
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
