import React from 'react';
import Icon from '../AppIcon';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

const CustomerReferralStats = ({ stats }) => {
  if (!stats || stats.totalReferred === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-text-primary mb-4">Your referrals</h2>
      <div className="rounded-spa border border-border bg-surface px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center space-x-2">
          <Icon name="Users" size={14} className="text-primary flex-shrink-0" />
          <span className="font-body text-sm text-text-primary">
            {stats.totalReferred} friend{stats.totalReferred === 1 ? '' : 's'} referred
          </span>
          {stats.pendingCount > 0 && (
            <span className="font-caption text-[11px] text-text-secondary">
              ({stats.pendingCount} pending)
            </span>
          )}
        </div>
        <span className="font-data font-data-medium text-sm text-primary">
          {formatNPR(stats.totalCredited)} earned
        </span>
      </div>
    </div>
  );
};

export default CustomerReferralStats;
