import React from 'react';
import Icon from '../AppIcon';

function formatNPR(amount) {
  return `NPR ${Number(amount).toLocaleString('en-IN')}`;
}

// Referral reward banner at checkout (migration-065) — shown when the booking's
// customer is a referrer with an unspent wallet credit and/or an unredeemed
// voucher. Purely optional: staff apply what they want via the tender rows
// (wallet) or the "Apply" buttons below (vouchers); anything left untouched
// simply stays available for a future visit.
const ReferralRewardCard = ({ referralReward, pendingWalletDeduction = 0, onApplyVoucher }) => {
  if (!referralReward) return null;
  const { walletBalance, vouchers } = referralReward;
  const hasWallet = walletBalance > 0;
  const hasVouchers = (vouchers || []).length > 0;
  if (!hasWallet && !hasVouchers) return null;

  const projectedBalance = Math.max(round2(walletBalance) - round2(pendingWalletDeduction), 0);

  return (
    <div className="rounded-spa border bg-accent/5 border-accent/20 px-3 py-2.5 space-y-2">
      <div className="flex items-center space-x-2">
        <Icon name="Gift" size={14} className="text-accent flex-shrink-0" />
        <span className="font-body font-body-medium text-sm text-text-primary">Referral reward</span>
      </div>

      {hasWallet && (
        <div className="flex items-center justify-between">
          <span className="font-body font-body-normal text-xs text-text-secondary">Wallet credit</span>
          <div className="flex items-center gap-1.5">
            <span className={`font-data font-data-medium text-sm text-accent ${pendingWalletDeduction > 0 ? 'line-through text-text-tertiary' : ''}`}>
              {formatNPR(walletBalance)}
            </span>
            {pendingWalletDeduction > 0 && (
              <>
                <Icon name="ArrowRight" size={12} className="text-text-secondary" />
                <span className="font-data font-data-medium text-sm text-accent">{formatNPR(projectedBalance)}</span>
              </>
            )}
          </div>
        </div>
      )}

      {hasVouchers && (
        <div className="space-y-1.5">
          {vouchers.map((v) => (
            <div key={v.referralId} className="flex items-center justify-between gap-2">
              <span className="font-body font-body-normal text-xs text-text-secondary truncate">
                {v.label} ({formatNPR(v.value)})
              </span>
              <button
                type="button"
                onClick={() => onApplyVoucher(v)}
                className="flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-caption font-caption-medium bg-accent/10 text-accent hover:bg-accent/20 spa-transition-fast"
              >
                Apply
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export default ReferralRewardCard;
