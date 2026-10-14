import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { fetchPackagesForCustomer } from '../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatDate(d) {
  return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

const STATUS_CONFIG = {
  unused:         { label: 'Not Started',  pill: 'bg-gray-100 text-gray-600' },
  partially_used: { label: 'In Progress',  pill: 'bg-warning/10 text-warning' },
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
    return (
      <div className="text-center py-8">
        <Icon name="Package" size={24} className="text-text-tertiary mx-auto mb-2" />
        <p className="font-body text-sm text-text-tertiary">No packages yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {packages.map((p) => {
        const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.unused;
        return (
          <div key={p.id} className="bg-background rounded-spa p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="font-body font-body-medium text-sm text-text-primary">{p.packageTypeName}</span>
              <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-caption font-caption-medium ${cfg.pill}`}>{cfg.label}</span>
            </div>
            <p className="font-caption text-xs text-text-secondary mb-2">
              {p.serviceName} · {p.packageCode}
            </p>
            <div className="flex items-center justify-between text-xs text-text-secondary">
              <span>{p.sessionsRemaining} / {p.sessionsTotal} sessions remaining</span>
              <span>Expires {formatDate(p.expiryDate)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-text-tertiary mt-1">
              <span>Issued {formatDate(p.issuedDate)}</span>
              <span className="font-data">{formatNPR(p.finalAmount ?? p.paidAmount)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default CustomerPackagesTab;
