import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import { fetchCustomerProfile } from '../../../../services/api';

const LOYALTY_CONFIG = {
  VIP:        { color: 'bg-amber-100 text-amber-800', icon: 'Crown' },
  Regular:    { color: 'bg-primary/10 text-primary', icon: 'Star' },
  Occasional: { color: 'bg-blue-100 text-blue-700', icon: 'UserCheck' },
  'At Risk':  { color: 'bg-error/10 text-error', icon: 'AlertTriangle' },
  New:        { color: 'bg-success/10 text-success', icon: 'UserPlus' },
  Standard:   { color: 'bg-background text-text-secondary', icon: 'User' },
};

const STATUS_COLORS = {
  Pending:       'bg-amber-100 text-amber-800',
  Confirmed:     'bg-blue-100 text-blue-700',
  'In-Progress': 'bg-primary/10 text-primary',
  Completed:     'bg-success/10 text-success',
  Cancelled:     'bg-error/10 text-error',
  'No Show':     'bg-gray-100 text-gray-600',
};

function formatNPR(amount) {
  return `NPR ${Number(amount).toLocaleString('en-IN')}`;
}

const CustomerProfileModal = ({ customerId, onClose }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadProfile = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);

    const result = await fetchCustomerProfile(customerId);

    if (result.error) {
      setError(result.error.message || 'Failed to load customer profile.');
      setLoading(false);
      return;
    }

    setData(result.data);
    setLoading(false);
  }, [customerId]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const loyaltyCfg = data ? (LOYALTY_CONFIG[data.stats.loyaltyTier] || LOYALTY_CONFIG.Standard) : LOYALTY_CONFIG.Standard;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/40 z-modal"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-surface border-l border-border z-modal-overlay shadow-xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-center justify-between z-header">
          <h2 className="font-heading font-heading-semibold text-lg text-text-primary">Customer Profile</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-spa hover:bg-background spa-transition-fast"
          >
            <Icon name="X" size={18} className="text-text-secondary" />
          </button>
        </div>

        <div className="px-6 py-5">
          {loading && (
            <div className="flex flex-col items-center py-16">
              <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mb-3" />
              <p className="font-body text-sm text-text-secondary">Loading profile...</p>
            </div>
          )}

          {error && (
            <div className="bg-error/5 border border-error/20 rounded-spa p-4 flex items-center space-x-3">
              <Icon name="AlertCircle" size={18} className="text-error flex-shrink-0" />
              <p className="font-body text-sm text-error">{error}</p>
              <button onClick={loadProfile} className="ml-auto font-body font-body-medium text-sm text-error underline">
                Retry
              </button>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-6">
              {/* Identity + Loyalty Badge */}
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Icon name="User" size={24} className="text-primary" />
                  </div>
                  <div>
                    <h3 className="font-heading font-heading-semibold text-base text-text-primary">
                      {data.customer.fullName}
                    </h3>
                    <p className="font-body text-sm text-text-secondary">{data.customer.phone}</p>
                    {data.customer.email && (
                      <p className="font-caption text-xs text-text-tertiary">{data.customer.email}</p>
                    )}
                  </div>
                </div>
                <span className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-caption font-caption-medium ${loyaltyCfg.color}`}>
                  <Icon name={loyaltyCfg.icon} size={12} />
                  <span>{data.stats.loyaltyTier}</span>
                </span>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-background rounded-spa p-3">
                  <p className="font-caption font-caption-normal text-[11px] text-text-tertiary mb-1">Total Revenue</p>
                  <p className="font-heading font-heading-semibold text-base text-text-primary">{formatNPR(data.stats.totalRevenue)}</p>
                </div>
                <div className="bg-background rounded-spa p-3">
                  <p className="font-caption font-caption-normal text-[11px] text-text-tertiary mb-1">Avg Spend</p>
                  <p className="font-heading font-heading-semibold text-base text-text-primary">{formatNPR(data.stats.avgSpend)}</p>
                </div>
                <div className="bg-background rounded-spa p-3">
                  <p className="font-caption font-caption-normal text-[11px] text-text-tertiary mb-1">Visits</p>
                  <p className="font-heading font-heading-semibold text-base text-text-primary">
                    {data.stats.completedVisits}
                    <span className="font-body font-body-normal text-xs text-text-secondary ml-1">
                      / {data.stats.totalVisits} total
                    </span>
                  </p>
                </div>
                <div className="bg-background rounded-spa p-3">
                  <p className="font-caption font-caption-normal text-[11px] text-text-tertiary mb-1">Last Visit</p>
                  <p className="font-heading font-heading-semibold text-base text-text-primary">
                    {data.stats.lastVisitDate
                      ? new Date(data.stats.lastVisitDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                      : '—'}
                  </p>
                </div>
              </div>

              {/* Extra stats row */}
              <div className="flex items-center space-x-4 px-1">
                {data.stats.mostBookedService && (
                  <span className="inline-flex items-center space-x-1 text-xs font-caption text-text-secondary">
                    <Icon name="Heart" size={12} className="text-primary" />
                    <span>Favourite: <span className="font-caption-medium text-text-primary">{data.stats.mostBookedService}</span></span>
                  </span>
                )}
                {data.stats.totalDiscount > 0 && (
                  <span className="inline-flex items-center space-x-1 text-xs font-caption text-text-secondary">
                    <Icon name="Tag" size={12} />
                    <span>Discounts: {formatNPR(data.stats.totalDiscount)}</span>
                  </span>
                )}
                {data.stats.unpaidCount > 0 && (
                  <span className="inline-flex items-center space-x-1 text-xs font-caption font-caption-medium text-error">
                    <Icon name="AlertCircle" size={12} />
                    <span>{data.stats.unpaidCount} unpaid</span>
                  </span>
                )}
              </div>

              {/* Notes */}
              {data.customer.notes && (
                <div className="bg-amber-50 border border-amber-200 rounded-spa p-3">
                  <p className="font-caption font-caption-medium text-xs text-amber-700 mb-1">Notes</p>
                  <p className="font-body text-sm text-amber-900">{data.customer.notes}</p>
                </div>
              )}

              {/* Booking History */}
              <div>
                <h4 className="font-body font-body-medium text-sm text-text-primary mb-3">
                  Booking History ({data.history.length})
                </h4>

                {data.history.length === 0 ? (
                  <div className="text-center py-8">
                    <Icon name="Calendar" size={24} className="text-text-tertiary mx-auto mb-2" />
                    <p className="font-body text-sm text-text-tertiary">No bookings yet</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {data.history.map((b, i) => (
                      <div
                        key={i}
                        className="bg-background rounded-spa p-3 flex items-center justify-between"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 mb-1">
                            <span className="font-body font-body-medium text-sm text-text-primary truncate">
                              {b.serviceName}
                            </span>
                            {b.isLocked && (
                              <Icon name="Lock" size={12} className="text-text-tertiary flex-shrink-0" />
                            )}
                          </div>
                          <div className="flex items-center space-x-2 text-xs text-text-secondary">
                            <span>{new Date(b.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                            <span className="text-text-tertiary">{'·'}</span>
                            <span>{b.therapistName}</span>
                            <span className="text-text-tertiary">{'·'}</span>
                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-caption font-caption-medium ${STATUS_COLORS[b.status] || 'bg-background text-text-secondary'}`}>
                              {b.status}
                            </span>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <p className="font-data font-data-medium text-sm text-text-primary">
                            {formatNPR(b.finalAmount)}
                          </p>
                          <span className={`text-[10px] font-caption font-caption-medium ${
                            b.paymentStatus === 'paid' ? 'text-success' : 'text-error'
                          }`}>
                            {b.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Member since */}
              <div className="text-center pt-2 border-t border-border">
                <p className="font-caption font-caption-normal text-[11px] text-text-tertiary">
                  Customer since {new Date(data.customer.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default CustomerProfileModal;
