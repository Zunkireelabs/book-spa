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
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center">
            <Icon name="Percent" size={16} className="text-amber-600" />
          </div>
          <h3 className="text-base font-semibold text-gray-900">Pending Discounts</h3>
        </div>
        <div className="flex justify-center py-6">
          <div className="animate-spin w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full" />
        </div>
      </div>
    );
  }

  if (discounts.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-amber-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center">
            <Icon name="Percent" size={16} className="text-amber-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              Pending Discounts
            </h3>
            <p className="text-xs text-gray-500">
              {discounts.length} request{discounts.length !== 1 ? 's' : ''} awaiting approval
            </p>
          </div>
        </div>
        <button
          onClick={loadPending}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          title="Refresh"
        >
          <Icon name="RefreshCw" size={16} className="text-gray-500" />
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <span className="text-sm text-red-600">{error}</span>
        </div>
      )}

      <div className="space-y-3">
        {discounts.map(d => (
          <div
            key={d.bookingId}
            className="bg-gray-50 rounded-lg p-4 flex items-start justify-between gap-4"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center space-x-2 mb-1">
                <span className="text-sm font-medium text-gray-900 truncate">
                  {d.customerName}
                </span>
                <span className="text-xs text-gray-400">
                  {d.bookingNumber}
                </span>
              </div>
              <div className="flex items-center space-x-2 text-xs text-gray-500 mb-2">
                <span>{d.serviceName}</span>
                <span className="text-gray-400">·</span>
                <span>{new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
              </div>
              <div className="flex items-center space-x-3 text-xs">
                <span className="font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                  {d.discountPercent}% off (NPR {d.discountAmount.toLocaleString('en-IN')})
                </span>
                <span className="text-gray-500">
                  Base: NPR {d.baseAmount.toLocaleString('en-IN')}
                </span>
              </div>
              {d.discountReason && (
                <p className="mt-2 text-xs text-gray-500 italic">
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
