import React from 'react';
import Icon from '../AppIcon';

const STATUS_STYLES = {
  unused:         'bg-success/10 text-success',
  partially_used: 'bg-amber-100 text-amber-800',
  fully_redeemed: 'bg-gray-100 text-gray-600',
  expired:        'bg-warning/10 text-warning',
};

const STATUS_LABELS = {
  unused: 'Unused',
  partially_used: 'Partially used',
  fully_redeemed: 'Redeemed',
  expired: 'Expired',
};

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const CustomerVouchersSection = ({ vouchers = [] }) => {
  if (!vouchers.length) return null;

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-text-primary mb-4">Your vouchers</h2>
      <div className="space-y-2">
        {vouchers.map((v) => {
          const isExpired = v.expiry_date && new Date(v.expiry_date) < new Date() && v.status !== 'fully_redeemed';
          const status = isExpired ? 'expired' : (v.status || 'unused');
          const styles = STATUS_STYLES[status] || STATUS_STYLES.unused;
          return (
            <div key={v.id} className="rounded-spa border border-border px-4 py-3 bg-surface">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center space-x-2">
                  <Icon name="Ticket" size={14} className="text-primary flex-shrink-0" />
                  <span className="font-body font-body-medium text-sm text-text-primary truncate">
                    {v.voucher_type?.name || 'Voucher'}
                  </span>
                  <span className="font-data text-xs tracking-widest text-text-secondary">{v.voucher_code}</span>
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-caption font-caption-medium ${styles}`}>
                    {STATUS_LABELS[status] || status}
                  </span>
                </div>
                <span className="font-data font-data-medium text-sm text-primary flex-shrink-0">
                  {formatNPR(v.remaining_balance ?? v.total_amount_issued)}
                  {v.voucher_type?.is_wallet && v.remaining_balance != null && (
                    <span className="text-text-tertiary"> / {formatNPR(v.total_amount_issued)}</span>
                  )}
                </span>
              </div>
              <p className="mt-1.5 font-caption text-[11px] text-text-secondary">
                Issued {formatDate(v.issued_date)} · Expires {formatDate(v.expiry_date)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CustomerVouchersSection;
