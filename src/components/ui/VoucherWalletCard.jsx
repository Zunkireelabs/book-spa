import React from 'react';
import Icon from '../AppIcon';

function formatNPR(amount) {
  return `NPR ${Number(amount).toLocaleString('en-IN')}`;
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// Voucher balance banner at checkout — same "balance → balance after this
// payment" pattern as MembershipWalletCard. This booking's own customer's
// linked, non-expired vouchers (migration-084) are pooled into ONE combined
// balance (`poolBalance`), exactly like Membership/Referral Wallet — staff
// picks "Voucher" as the payment method and types an amount, no picking a
// specific voucher code (migration-090's record_voucher_wallet_payment_pooled
// draws it from those vouchers server-side, soonest-expiring first).
// `vouchers` are separate, individually-attached tenders for a specific
// voucher code found via the manual Voucher (search) payment method — e.g. a
// walk-in gift voucher not linked to this customer's account — shown below
// the pooled balance since they're a distinct redemption, not part of the pool.
const VoucherWalletCard = ({ vouchers, poolBalance = 0, poolPendingDeduction = 0 }) => {
  const list = (vouchers || []).filter(v => v.voucherId);
  if (list.length === 0 && poolBalance <= 0) return null;

  const poolProjected = Math.max(round2(poolBalance) - round2(poolPendingDeduction), 0);

  return (
    <div className="space-y-2">
      {poolBalance > 0 && (
        <div className="rounded-spa border bg-primary/5 border-primary/20 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 min-w-0">
              <Icon name="Ticket" size={14} className="text-primary flex-shrink-0" />
              <span className="font-body font-body-medium text-sm text-text-primary truncate">Voucher</span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className={`font-data font-data-medium text-sm text-primary ${poolPendingDeduction > 0 ? 'line-through text-text-tertiary' : ''}`}>
                {formatNPR(poolBalance)}
              </span>
              {poolPendingDeduction > 0 && (
                <>
                  <Icon name="ArrowRight" size={12} className="text-text-secondary" />
                  <span className="font-data font-data-medium text-sm text-primary">{formatNPR(poolProjected)}</span>
                </>
              )}
            </div>
          </div>
          {poolPendingDeduction > 0 && (
            <p className="mt-1.5 font-caption text-[11px] text-text-secondary">
              Left after this payment: {formatNPR(poolProjected)}
            </p>
          )}
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
