import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { fetchVouchersForCustomer } from '../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatDate(d) {
  return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

// Human words for the stored status, never the raw value.
const STATUS_CONFIG = {
  unused:   { label: 'Not used', pill: 'bg-background text-text-secondary border border-border' },
  partially_used: { label: 'Partly used', pill: 'bg-warning/10 text-warning' },
  fully_redeemed: { label: 'Fully used', pill: 'bg-success/10 text-success' },
  expired:  { label: 'Expired', pill: 'bg-error/10 text-error' },
};
const statusOf = (s) => STATUS_CONFIG[s] || { label: String(s || '').replace(/[_-]/g, ' ').replace(/^./, (c) => c.toUpperCase()), pill: 'bg-background text-text-secondary' };

const CustomerVouchersTab = ({ customerId }) => {
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchVouchersForCustomer(customerId);
    if (result.error) {
      setError(result.error.message || 'Failed to load gift vouchers.');
    } else {
      setVouchers(result.data || []);
    }
    setLoading(false);
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="py-6 text-center">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
        <Icon name="AlertCircle" size={16} />
        <span>{error}</span>
      </div>
    );
  }

  if (vouchers.length === 0) {
    return <p className="text-[13px] text-text-secondary">No gift vouchers for this customer.</p>;
  }

  return (
    <div className="space-y-3">
      {vouchers.map((v) => {
        const st = statusOf(v.status);
        return (
          <div key={v.id} className="border border-border rounded-spa-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <b className="text-sm font-semibold text-text-primary">{v.voucherTypeName}</b>
              <span className={`h-[22px] px-2.5 rounded-full text-xs inline-flex items-center ${st.pill}`}>{st.label}</span>
            </div>
            <p className="text-[13px] text-text-secondary">
              {v.voucherCode} · <span className="tabular-nums">{formatNPR(v.remainingBalance)} remaining of {formatNPR(v.totalAmountIssued)}</span>{v.expiryDate ? ` · until ${formatDate(v.expiryDate)}` : ''}
            </p>
          </div>
        );
      })}
    </div>
  );
};

export default CustomerVouchersTab;
