import React from 'react';
import Icon from '../AppIcon';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

const CustomerVouchersSection = ({ vouchers = [], onClickVoucher }) => {
  if (!vouchers.length) return null;

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-text-primary mb-4">Your vouchers</h2>
      <div className="space-y-2">
        {vouchers.map((v) => (
          <button
            type="button"
            onClick={() => onClickVoucher(v.id)}
            key={v.id}
            className="w-full text-left rounded-spa border border-border px-4 py-3 bg-surface hover:shadow-spa-resting spa-transition-fast"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-spa bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Icon name="Ticket" size={15} className="text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-body font-body-medium text-sm text-text-primary truncate">
                  {v.voucher_type?.name || 'Voucher'}
                </p>
                <p className="font-data text-[11px] tracking-widest text-text-secondary truncate">{v.voucher_code}</p>
              </div>
              <span className="font-data font-data-medium text-sm text-primary flex-shrink-0">
                {formatNPR(v.remaining_balance ?? v.total_amount_issued)}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default CustomerVouchersSection;
