import React from 'react';
import Icon from '../AppIcon';

// Session-package info card at checkout — same visual/structural pattern as
// VoucherWalletCard (rounded-spa border, bg-primary/5, icon + name left,
// value right), but purely informational: redemption itself happens by
// picking "Package — <name>" straight from the Payment Method dropdown
// (PaymentModal's packageLeaves), same as Membership/Voucher are picked —
// this card exists only so staff can see sessions-remaining/expiry without
// having to open the dropdown first. `packages` is the list returned by
// getActivePackagesForCustomer (already filtered to unused/partially_used —
// no fully_redeemed/expired rows reach here). `selectedPackageId` marks
// whichever package is currently the active SessionPackage tender, so its
// row can show "Selected" (removing it is the tender row's own trash icon,
// not this card).
const PackageWalletCard = ({ packages, selectedPackageId = null }) => {
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
              {isSelected && (
                <span className="text-[11px] font-caption text-primary flex-shrink-0">Selected</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PackageWalletCard;
