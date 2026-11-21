import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { fetchPackagesForCustomer } from '../../../services/api';

const formatShort = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');

function formatDate(d) {
  return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

const STATUS_CONFIG = {
  unused:         { label: 'Not started',  pill: 'bg-background text-text-secondary border border-border' },
  partially_used: { label: 'In progress',  pill: 'bg-warning/10 text-warning' },
  fully_redeemed: { label: 'Completed',    pill: 'bg-success/10 text-success' },
  expired:        { label: 'Expired',      pill: 'bg-error/10 text-error' },
};

const CustomerPackagesTab = ({ customerId }) => {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchPackagesForCustomer(customerId);
    if (result.error) {
      setError(result.error.message || 'Failed to load packages.');
    } else {
      setPackages(result.data || []);
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

  if (packages.length === 0) {
    return <p className="text-[13px] text-text-secondary">No packages for this customer.</p>;
  }

  return (
    <div className="space-y-3">
      {packages.map((p) => {
        const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.unused;
        return (
          <div key={p.id} className="border border-border rounded-spa-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <b className="text-sm font-semibold text-text-primary">{p.packageTypeName}</b>
              <span className={`h-[22px] px-2.5 rounded-full text-xs inline-flex items-center ${cfg.pill}`}>{cfg.label}</span>
            </div>
            <p className="text-[13px] text-text-secondary">
              {p.packageCode} · {p.sessionsRemaining} of {p.sessionsTotal} sessions left{p.issuedDate ? ` · bought ${formatShort(p.issuedDate)}` : ''}{p.expiryDate ? ` · until ${formatDate(p.expiryDate)}` : ''}
            </p>
          </div>
        );
      })}
    </div>
  );
};

export default CustomerPackagesTab;
