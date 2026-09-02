import React from 'react';
import Icon from '../AppIcon';

// Session-package redemption card at checkout — same visual/structural
// pattern as VoucherWalletCard (rounded-spa border, bg-primary/5, icon + name
// left, value + "after this payment" preview right), but packages are
// session-counted rather than NPR-balanced: "sessions remaining / total"
// stands in for the NPR balance, and "Redeem 1 Session" is a discrete action
// (pick a package, it becomes this tender) rather than a typed amount, since
// a session redemption is always worth exactly one visit, never a partial.
// `packages` is the list returned by getActivePackagesForCustomer (already
// filtered to unused/partially_used — no fully_redeemed/expired rows reach
// here). `selectedPackageId` marks whichever package is currently the active
// SessionPackage tender (only one at a time, since one booking = one session
// redeemed), so its row can show "Selected" instead of the redeem action.
const PackageWalletCard = ({ packages, selectedPackageId = null, onRedeem, onUndo }) => {
  const list = packages || [];
  if (list.length === 0) return null;

  return (
    <div className="space-y-2">
      {list.map((p) => {
        const isSelected = p.packageId === selectedPackageId;
        const expiryLabel = p.expiryDate
          ? new Date(p.expiryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
          : null;
        return (
          <div key={p.packageId} className="rounded-spa border bg-primary/5 border-primary/20 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 min-w-0">
                <Icon name="PackageCheck" size={14} className="text-primary flex-shrink-0" />
                <span className="font-body font-body-medium text-sm text-text-primary truncate">{p.packageName}</span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="font-data font-data-medium text-sm text-primary">
                  {p.sessionsRemaining} / {p.sessionsTotal} sessions
                </span>
              </div>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <p className="font-caption text-[11px] text-text-secondary">
                {expiryLabel ? `Expires ${expiryLabel}` : 'No expiry'}
                {p.packageCode ? ` · ${p.packageCode}` : ''}
              </p>
              {isSelected ? (
                <button
                  type="button"
                  onClick={() => onUndo && onUndo(p)}
                  className="text-[11px] font-caption text-primary hover:underline flex-shrink-0"
                >
                  Selected — undo
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onRedeem && onRedeem(p)}
                  className="text-[11px] font-caption text-primary hover:underline flex-shrink-0"
                >
                  Redeem 1 Session
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PackageWalletCard;
