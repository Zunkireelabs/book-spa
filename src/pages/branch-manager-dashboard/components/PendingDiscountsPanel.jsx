import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { fetchPendingDiscounts, approveDiscount, rejectDiscount } from '../../../services/api';

const PendingDiscountsPanel = ({ branchId }) => {
  const [discounts, setDiscounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [processingId, setProcessingId] = useState(null);

  const loadPending = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);

    const result = await fetchPendingDiscounts(branchId);
    if (result.error) {
      setError(result.error.message || 'Failed to load pending discounts.');
    } else {
      setDiscounts(result.data || []);
    }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { loadPending(); }, [loadPending]);

  const handleApprove = async (bookingId) => {
    setProcessingId(bookingId);
    const result = await approveDiscount(bookingId);
    setProcessingId(null);
    if (!result.error) {
      setDiscounts(prev => prev.filter(d => d.bookingId !== bookingId));
    }
  };

  const handleReject = async (bookingId) => {
    setProcessingId(bookingId);
    const result = await rejectDiscount(bookingId);
    setProcessingId(null);
    if (!result.error) {
      setDiscounts(prev => prev.filter(d => d.bookingId !== bookingId));
    }
  };

  if (loading) {
    return (
      <div className="bg-surface rounded-spa-lg border border-border p-6">
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
            <Icon name="Percent" size={16} className="text-amber-600" />
          </div>
          <h3 className="font-heading font-heading-semibold text-base text-text-primary">Pending Discounts</h3>
        </div>
        <div className="flex justify-center py-6">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      </div>
    );
  }

  if (discounts.length === 0) return null;

  return (
    <div className="bg-surface rounded-spa-lg border border-amber-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
            <Icon name="Percent" size={16} className="text-amber-600" />
          </div>
          <div>
            <h3 className="font-heading font-heading-semibold text-base text-text-primary">
              Pending Discounts
            </h3>
            <p className="font-caption text-xs text-text-secondary">
              {discounts.length} request{discounts.length !== 1 ? 's' : ''} awaiting approval
            </p>
          </div>
        </div>
        <button
          onClick={loadPending}
          className="p-2 rounded-spa hover:bg-background spa-transition-fast"
          title="Refresh"
        >
          <Icon name="RefreshCw" size={16} className="text-text-secondary" />
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-spa">
          <span className="font-body text-sm text-error">{error}</span>
        </div>
      )}

      <div className="space-y-3">
        {discounts.map(d => (
          <div
            key={d.bookingId}
            className="bg-background rounded-spa p-4 flex items-start justify-between gap-4"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center space-x-2 mb-1">
                <span className="font-body font-body-medium text-sm text-text-primary truncate">
                  {d.customerName}
                </span>
                <span className="font-caption text-xs text-text-tertiary">
                  {d.bookingNumber}
                </span>
              </div>
              <div className="flex items-center space-x-2 text-xs text-text-secondary mb-2">
                <span>{d.serviceName}</span>
                <span className="text-text-tertiary">·</span>
                <span>{new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
              </div>
              <div className="flex items-center space-x-3 text-xs">
                <span className="font-data font-data-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                  {d.discountPercent}% off (NPR {d.discountAmount.toLocaleString('en-IN')})
                </span>
                <span className="text-text-secondary">
                  Base: NPR {d.baseAmount.toLocaleString('en-IN')}
                </span>
              </div>
              {d.discountReason && (
                <p className="mt-2 font-body text-xs text-text-secondary italic">
                  &ldquo;{d.discountReason}&rdquo;
                </p>
              )}
            </div>

            <div className="flex items-center space-x-2 flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleReject(d.bookingId)}
                loading={processingId === d.bookingId}
                disabled={!!processingId}
                iconName="X"
                iconPosition="left"
              >
                Reject
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleApprove(d.bookingId)}
                loading={processingId === d.bookingId}
                disabled={!!processingId}
                iconName="Check"
                iconPosition="left"
              >
                Approve
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PendingDiscountsPanel;
