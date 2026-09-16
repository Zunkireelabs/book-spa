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

const CustomerPackagesSection = ({ packages = [] }) => {
  if (!packages.length) return null;

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-text-primary mb-4">Your packages</h2>
      <div className="space-y-2">
        {packages.map((p) => {
          const isExpired = p.expiry_date && new Date(p.expiry_date) < new Date() && p.status !== 'fully_redeemed';
          const status = isExpired ? 'expired' : (p.status || 'unused');
          const styles = STATUS_STYLES[status] || STATUS_STYLES.unused;
          const remaining = p.sessions_remaining != null ? p.sessions_remaining : p.sessions_total;
          return (
            <div key={p.id} className="rounded-spa border border-border px-4 py-3 bg-surface">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center space-x-2">
                  <Icon name="PackageCheck" size={14} className="text-primary flex-shrink-0" />
                  <span className="font-body font-body-medium text-sm text-text-primary truncate">
                    {p.service?.name || p.package_type?.name || 'Package'}
                  </span>
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-caption font-caption-medium ${styles}`}>
                    {STATUS_LABELS[status] || status}
                  </span>
                </div>
                <span className="font-data font-data-medium text-sm text-primary flex-shrink-0">
                  {remaining} <span className="text-text-tertiary">/ {p.sessions_total} sessions</span>
                </span>
              </div>
              <p className="mt-1.5 font-caption text-[11px] text-text-secondary">
                Issued {formatDate(p.issued_date)} · Expires {formatDate(p.expiry_date)}
                {p.package_code ? ` · ${p.package_code}` : ''}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CustomerPackagesSection;
