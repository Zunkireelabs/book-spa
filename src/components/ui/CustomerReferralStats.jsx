import React from 'react';
import Icon from '../AppIcon';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

// Page-level summary only — count + amount earned. Full per-referral history
// (which service the friend booked, per-referral status/dates) lives one tap
// away, in the /account "Referral earnings" detail popup (StatDetailModal in
// customer-account), not duplicated here.
const CustomerReferralStats = ({ stats, onClick }) => {
  if (!stats || stats.totalReferred === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-text-primary mb-4">Your referrals</h2>
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left rounded-spa border border-border bg-surface px-4 py-3 flex items-center gap-3 hover:shadow-spa-resting spa-transition-fast"
      >
        <div className="w-8 h-8 rounded-spa bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Icon name="Users" size={15} className="text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-body font-body-medium text-sm text-text-primary truncate">
            {stats.totalReferred} friend{stats.totalReferred === 1 ? '' : 's'} referred
          </p>
          {stats.pendingCount > 0 && (
            <p className="font-caption text-[11px] text-text-secondary truncate">
              {stats.pendingCount} pending
            </p>
          )}
        </div>
        <span className="font-data font-data-medium text-sm text-primary flex-shrink-0">
          {formatNPR(stats.totalCredited)}
        </span>
      </button>
    </div>
  );
};

export default CustomerReferralStats;
