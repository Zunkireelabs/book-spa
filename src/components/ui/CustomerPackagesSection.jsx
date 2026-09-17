import React from 'react';
import Icon from '../AppIcon';

const STATUS_STYLES = {
  unused:         'bg-success/10 text-success',
  partially_used: 'bg-amber-100 text-amber-800',
  fully_redeemed: 'bg-gray-100 text-gray-600',
  expired:        'bg-warning/10 text-warning',
};

const STATUS_LABELS = {
  unused: 'Not started',
  partially_used: 'In progress',
  fully_redeemed: 'Completed',
  expired: 'Expired',
};

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const CustomerPackagesSection = ({ packages = [], onClickPackage }) => {
  if (!packages.length) return null;

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-text-primary mb-4">Your annual packages</h2>
      <div className="space-y-2">
        {packages.map((p) => {
          const isExpired = p.expiry_date && new Date(p.expiry_date) < new Date() && p.status !== 'fully_redeemed';
          const status = isExpired ? 'expired' : (p.status || 'unused');
          const styles = STATUS_STYLES[status] || STATUS_STYLES.unused;
          const remaining = p.sessions_remaining != null ? p.sessions_remaining : p.sessions_total;
          return (
            <button
              type="button"
              onClick={() => onClickPackage?.(p.id)}
              key={p.id}
              className="w-full text-left rounded-spa border border-border px-4 py-3 bg-surface hover:shadow-spa-resting spa-transition-fast"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-spa bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Icon name="PackageCheck" size={16} className="text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-body font-body-medium text-sm text-text-primary truncate">
                    {p.package_type?.name || p.service?.name || 'Annual package'}
                  </p>
                  <p className="mt-0.5 font-caption text-[11px] text-text-secondary truncate">
                    Issued {formatDate(p.issued_date)} · Expires {formatDate(p.expiry_date)}
                    {p.package_code ? ` · ${p.package_code}` : ''}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-data font-data-semibold text-lg leading-tight text-primary">{remaining}</p>
                  <p className="font-caption text-[10px] text-text-tertiary uppercase tracking-wide">remaining</p>
                </div>
              </div>
              <span className={`mt-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-caption font-caption-medium ${styles}`}>
                {STATUS_LABELS[status] || status}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CustomerPackagesSection;
