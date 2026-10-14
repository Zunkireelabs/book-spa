import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { fetchVouchersForCustomer } from '../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatDate(d) {
  return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

const STATUS_CONFIG = {
  unused:    'bg-gray-100 text-gray-600',
  partial:   'bg-warning/10 text-warning',
  depleted:  'bg-success/10 text-success',
  expired:   'bg-error/10 text-error',
};

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
    return (
      <div className="text-center py-8">
        <Icon name="Ticket" size={24} className="text-text-tertiary mx-auto mb-2" />
        <p className="font-body text-sm text-text-tertiary">No gift vouchers yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {vouchers.map((v) => (
        <div key={v.id} className="bg-background rounded-spa p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="font-body font-body-medium text-sm text-text-primary">{v.voucherTypeName}</span>
            <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-caption font-caption-medium ${STATUS_CONFIG[v.status] || STATUS_CONFIG.unused}`}>
              {v.status}
            </span>
          </div>
          <p className="font-data text-[11px] tracking-widest text-text-secondary mb-2">{v.voucherCode}</p>
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>{formatNPR(v.remainingBalance)} remaining of {formatNPR(v.totalAmountIssued)}</span>
            <span>Expires {formatDate(v.expiryDate)}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

export default CustomerVouchersTab;
