import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { getDailySummary, closeDay } from '../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

const DailyClosingPanel = ({ branchId }) => {
  const today = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const loadSummary = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    const { data, error: fetchError } = await getDailySummary(branchId, selectedDate);

    if (fetchError) {
      setError(fetchError.message || 'Failed to load daily summary.');
    } else {
      setSummary(data);
    }
    setLoading(false);
  }, [branchId, selectedDate]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const handleCloseDay = async () => {
    setClosing(true);
    setError(null);
    setShowConfirmModal(false);

    const { data, error: closeError } = await closeDay(branchId, selectedDate);

    if (closeError) {
      setError(closeError.message || 'Failed to close the day.');
    } else {
      setSuccessMsg('Day closed successfully. All bookings are now locked.');
      await loadSummary();
    }
    setClosing(false);
  };

  const handleCloseDayClick = () => {
    if (summary?.unpaidCount > 0) {
      setShowConfirmModal(true);
    } else {
      handleCloseDay();
    }
  };

  if (!branchId) {
    return (
      <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 border border-border text-center">
        <p className="font-body font-body-normal text-text-secondary">No branch selected.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Date Selector */}
      <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 border border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <Icon name="FileText" size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="font-heading font-heading-semibold text-lg text-text-primary">
                Daily Reconciliation
              </h2>
              <p className="font-caption font-caption-normal text-sm text-text-secondary">
                {formatDate(selectedDate)}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <input
              type="date"
              value={selectedDate}
              max={today}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 border border-border rounded-spa bg-surface text-text-primary text-sm focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast"
            />
            <Button
              variant="outline"
              size="sm"
              iconName="RefreshCw"
              iconPosition="left"
              onClick={loadSummary}
              disabled={loading}
            >
              Refresh
            </Button>
          </div>
        </div>

        {/* Closed Badge */}
        {summary?.isClosed && (
          <div className="flex items-center space-x-2 px-4 py-2 bg-success/5 border border-success/20 rounded-spa">
            <Icon name="Lock" size={16} className="text-success" />
            <span className="font-body font-body-medium text-sm text-success">
              Day Closed
            </span>
            {summary.closedAt && (
              <span className="font-caption font-caption-normal text-xs text-text-secondary ml-auto">
                at {new Date(summary.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="bg-surface rounded-spa-lg spa-shadow-resting p-12 border border-border text-center">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
          <p className="font-body font-body-normal text-text-secondary">Loading summary...</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start space-x-2 p-4 bg-error/5 border border-error/20 rounded-spa-lg">
          <Icon name="AlertCircle" size={16} className="text-error mt-0.5 shrink-0" />
          <p className="font-body font-body-normal text-sm text-error">{error}</p>
        </div>
      )}

      {/* Success */}
      {successMsg && (
        <div className="flex items-start space-x-2 p-4 bg-success/5 border border-success/20 rounded-spa-lg">
          <Icon name="CheckCircle" size={16} className="text-success mt-0.5 shrink-0" />
          <p className="font-body font-body-normal text-sm text-success">{successMsg}</p>
        </div>
      )}

      {/* Summary Cards */}
      {!loading && summary && (
        <>
          {/* Revenue Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-surface rounded-spa-lg spa-shadow-resting p-5 border border-border">
              <div className="flex items-center space-x-2 mb-2">
                <Icon name="TrendingUp" size={16} className="text-text-secondary" />
                <span className="font-caption font-caption-medium text-xs text-text-secondary uppercase tracking-wider">Gross Revenue</span>
              </div>
              <p className="font-heading font-heading-semibold text-xl text-text-primary">
                {formatNPR(summary.grossRevenue)}
              </p>
            </div>

            <div className="bg-surface rounded-spa-lg spa-shadow-resting p-5 border border-border">
              <div className="flex items-center space-x-2 mb-2">
                <Icon name="Percent" size={16} className="text-text-secondary" />
                <span className="font-caption font-caption-medium text-xs text-text-secondary uppercase tracking-wider">Total Discounts</span>
              </div>
              <p className="font-heading font-heading-semibold text-xl text-error">
                - {formatNPR(summary.totalDiscounts)}
              </p>
            </div>

            <div className="bg-surface rounded-spa-lg spa-shadow-resting p-5 border border-border border-l-4 border-l-success">
              <div className="flex items-center space-x-2 mb-2">
                <Icon name="IndianRupee" size={16} className="text-success" />
                <span className="font-caption font-caption-medium text-xs text-text-secondary uppercase tracking-wider">Net Revenue</span>
              </div>
              <p className="font-heading font-heading-semibold text-xl text-success">
                {formatNPR(summary.netRevenue)}
              </p>
            </div>
          </div>

          {/* Booking Breakdown + Payment Mode */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Booking Breakdown */}
            <div className="bg-surface rounded-spa-lg spa-shadow-resting p-5 border border-border">
              <h3 className="font-heading font-heading-medium text-base text-text-primary mb-4 flex items-center space-x-2">
                <Icon name="Calendar" size={18} className="text-primary" />
                <span>Booking Breakdown</span>
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-body font-body-normal text-sm text-text-secondary">Total Bookings</span>
                  <span className="font-body font-body-semibold text-sm text-text-primary">{summary.totalBookings}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-body font-body-normal text-sm text-text-secondary">Completed</span>
                  <span className="font-body font-body-semibold text-sm text-success">{summary.completedBookings}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-body font-body-normal text-sm text-text-secondary">Cancelled</span>
                  <span className="font-body font-body-semibold text-sm text-error">{summary.cancelledBookings}</span>
                </div>
                <div className="border-t border-border pt-2 flex items-center justify-between">
                  <span className="font-body font-body-normal text-sm text-text-secondary">Unpaid (Confirmed/Completed)</span>
                  <span className={`font-body font-body-semibold text-sm ${summary.unpaidCount > 0 ? 'text-warning' : 'text-success'}`}>
                    {summary.unpaidCount}
                  </span>
                </div>
              </div>
            </div>

            {/* Payment Mode Breakdown */}
            <div className="bg-surface rounded-spa-lg spa-shadow-resting p-5 border border-border">
              <h3 className="font-heading font-heading-medium text-base text-text-primary mb-4 flex items-center space-x-2">
                <Icon name="CreditCard" size={18} className="text-primary" />
                <span>Payment Breakdown</span>
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Icon name="Banknote" size={14} className="text-text-secondary" />
                    <span className="font-body font-body-normal text-sm text-text-secondary">Cash</span>
                  </div>
                  <span className="font-body font-body-semibold text-sm text-text-primary">
                    {formatNPR(summary.paymentBreakdown.cash)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Icon name="CreditCard" size={14} className="text-text-secondary" />
                    <span className="font-body font-body-normal text-sm text-text-secondary">Card (Nabil / GlobalIME / NIC Asia)</span>
                  </div>
                  <span className="font-body font-body-semibold text-sm text-text-primary">
                    {formatNPR(summary.paymentBreakdown.card)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Icon name="Smartphone" size={14} className="text-text-secondary" />
                    <span className="font-body font-body-normal text-sm text-text-secondary">Fonepay</span>
                  </div>
                  <span className="font-body font-body-semibold text-sm text-text-primary">
                    {formatNPR(summary.paymentBreakdown.fonepay)}
                  </span>
                </div>
                {summary.voucherSalesTotal > 0 && (
                  <div className="border-t border-border pt-2 flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Icon name="Ticket" size={14} className="text-text-secondary" />
                      <span className="font-body font-body-normal text-sm text-text-secondary">of which: Voucher Sales</span>
                    </div>
                    <span className="font-body font-body-semibold text-sm text-text-primary">
                      {formatNPR(summary.voucherSalesTotal)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Close Day Action */}
          {!summary.isClosed && (
            <div className="bg-surface rounded-spa-lg spa-shadow-resting p-5 border border-border">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-heading font-heading-medium text-base text-text-primary">
                    Close Day
                  </h3>
                  <p className="font-caption font-caption-normal text-sm text-text-secondary mt-1">
                    Locks all bookings for {formatDate(selectedDate)}. This action cannot be undone.
                  </p>
                </div>
                <Button
                  variant="primary"
                  iconName="Lock"
                  iconPosition="left"
                  onClick={handleCloseDayClick}
                  loading={closing}
                >
                  Close Day
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Empty State */}
      {!loading && summary && summary.totalBookings === 0 && (
        <div className="bg-surface rounded-spa-lg spa-shadow-resting p-8 border border-border text-center">
          <Icon name="Calendar" size={48} className="text-text-secondary mx-auto mb-3" />
          <p className="font-body font-body-normal text-text-secondary">
            No bookings found for {formatDate(selectedDate)}.
          </p>
        </div>
      )}

      {/* Unpaid Warning Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal-overlay flex items-center justify-center p-4">
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-md animate-fade-in">
            <div className="p-6 space-y-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-warning/10 rounded-lg flex items-center justify-center">
                  <Icon name="AlertTriangle" size={20} className="text-warning" />
                </div>
                <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
                  Unpaid Bookings Warning
                </h3>
              </div>

              <p className="font-body font-body-normal text-sm text-text-secondary">
                <strong className="text-warning">{summary?.unpaidCount}</strong> booking{summary?.unpaidCount !== 1 ? 's' : ''} still
                {summary?.unpaidCount !== 1 ? ' have' : ' has'} unpaid status. Closing the day will lock all bookings,
                preventing further payment recording for these bookings.
              </p>
              <p className="font-body font-body-normal text-sm text-text-secondary">
                Do you still want to close the day?
              </p>
            </div>

            <div className="flex items-center justify-end space-x-3 p-6 border-t border-border">
              <Button
                variant="outline"
                onClick={() => setShowConfirmModal(false)}
              >
                Cancel
              </Button>
              <Button
                variant="warning"
                iconName="Lock"
                iconPosition="left"
                onClick={handleCloseDay}
                loading={closing}
              >
                Close Anyway
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DailyClosingPanel;
