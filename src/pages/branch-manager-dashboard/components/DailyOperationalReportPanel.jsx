import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { getDailyOperationalReport, exportDailyReportCSV, closeDay } from '../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

const DailyOperationalReportPanel = ({ branchId }) => {
  const today = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const loadReport = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    const { data, error: fetchError } = await getDailyOperationalReport(branchId, selectedDate);

    if (fetchError) {
      setError(fetchError.message || 'Failed to load daily report.');
    } else {
      setReport(data);
    }
    setLoading(false);
  }, [branchId, selectedDate]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleCloseDay = async () => {
    setClosing(true);
    setError(null);
    setShowConfirmModal(false);

    const { error: closeError } = await closeDay(branchId, selectedDate);

    if (closeError) {
      setError(closeError.message || 'Failed to close the day.');
    } else {
      setSuccessMsg('Day closed successfully. All bookings are now locked.');
      await loadReport();
    }
    setClosing(false);
  };

  const handleCloseDayClick = () => {
    if (report?.unpaidBookings?.length > 0) {
      setShowConfirmModal(true);
    } else {
      handleCloseDay();
    }
  };

  const handleExportCSV = () => {
    if (!report) return;

    const csv = exportDailyReportCSV(report);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `daily-report-${selectedDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
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
      {/* Header with Date Selector + Actions */}
      <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 border border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <Icon name="FileText" size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="font-heading font-heading-semibold text-lg text-text-primary">
                Daily Operational Report
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
              onClick={loadReport}
              disabled={loading}
            >
              Refresh
            </Button>
            {report && (
              <Button
                variant="outline"
                size="sm"
                iconName="Download"
                iconPosition="left"
                onClick={handleExportCSV}
              >
                Export CSV
              </Button>
            )}
          </div>
        </div>

        {/* Closed Badge */}
        {report?.isClosed && (
          <div className="flex items-center space-x-2 px-4 py-2 bg-success/5 border border-success/20 rounded-spa">
            <Icon name="Lock" size={16} className="text-success" />
            <span className="font-body font-body-medium text-sm text-success">
              Day Closed
            </span>
            {report.closedAt && (
              <span className="font-caption font-caption-normal text-xs text-text-secondary ml-auto">
                at {new Date(report.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="bg-surface rounded-spa-lg spa-shadow-resting p-12 border border-border text-center">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
          <p className="font-body font-body-normal text-text-secondary">Loading report...</p>
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

      {/* Report Content */}
      {!loading && report && (
        <>
          {/* Revenue Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-surface rounded-spa-lg spa-shadow-resting p-5 border border-border">
              <div className="flex items-center space-x-2 mb-2">
                <Icon name="TrendingUp" size={16} className="text-text-secondary" />
                <span className="font-caption font-caption-medium text-xs text-text-secondary uppercase tracking-wider">Gross Revenue</span>
              </div>
              <p className="font-heading font-heading-semibold text-xl text-text-primary">
                {formatNPR(report.totals.grossRevenue)}
              </p>
            </div>

            <div className="bg-surface rounded-spa-lg spa-shadow-resting p-5 border border-border">
              <div className="flex items-center space-x-2 mb-2">
                <Icon name="Percent" size={16} className="text-text-secondary" />
                <span className="font-caption font-caption-medium text-xs text-text-secondary uppercase tracking-wider">Total Discounts</span>
              </div>
              <p className="font-heading font-heading-semibold text-xl text-error">
                - {formatNPR(report.totals.totalDiscount)}
              </p>
            </div>

            <div className="bg-surface rounded-spa-lg spa-shadow-resting p-5 border border-border border-l-4 border-l-success">
              <div className="flex items-center space-x-2 mb-2">
                <Icon name="IndianRupee" size={16} className="text-success" />
                <span className="font-caption font-caption-medium text-xs text-text-secondary uppercase tracking-wider">Net Revenue</span>
              </div>
              <p className="font-heading font-heading-semibold text-xl text-success">
                {formatNPR(report.totals.netRevenue)}
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
                  <span className="font-body font-body-semibold text-sm text-text-primary">{report.totals.totalBookings}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-body font-body-normal text-sm text-text-secondary">Completed</span>
                  <span className="font-body font-body-semibold text-sm text-success">{report.totals.completedBookings}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-body font-body-normal text-sm text-text-secondary">Cancelled</span>
                  <span className="font-body font-body-semibold text-sm text-error">{report.totals.cancelledBookings}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-body font-body-normal text-sm text-text-secondary">No Show</span>
                  <span className="font-body font-body-semibold text-sm text-warning">{report.totals.noShowBookings}</span>
                </div>
                <div className="border-t border-border pt-2 flex items-center justify-between">
                  <span className="font-body font-body-normal text-sm text-text-secondary">Unpaid (Confirmed/Completed)</span>
                  <span className={`font-body font-body-semibold text-sm ${report.unpaidBookings.length > 0 ? 'text-warning' : 'text-success'}`}>
                    {report.unpaidBookings.length}
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
                    {formatNPR(report.paymentBreakdown.cash)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Icon name="CreditCard" size={14} className="text-text-secondary" />
                    <span className="font-body font-body-normal text-sm text-text-secondary">Card (Nabil / GlobalIME / NIC Asia)</span>
                  </div>
                  <span className="font-body font-body-semibold text-sm text-text-primary">
                    {formatNPR(report.paymentBreakdown.card)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Icon name="Smartphone" size={14} className="text-text-secondary" />
                    <span className="font-body font-body-normal text-sm text-text-secondary">Fonepay</span>
                  </div>
                  <span className="font-body font-body-semibold text-sm text-text-primary">
                    {formatNPR(report.paymentBreakdown.fonepay)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Bookings Detail Table */}
          {report.bookings.length > 0 && (
            <div className="bg-surface rounded-spa-lg spa-shadow-resting border border-border overflow-hidden">
              <div className="p-5 border-b border-border">
                <h3 className="font-heading font-heading-medium text-base text-text-primary flex items-center space-x-2">
                  <Icon name="List" size={18} className="text-primary" />
                  <span>All Bookings</span>
                  <span className="font-caption font-caption-normal text-xs text-text-secondary ml-2">
                    ({report.bookings.length})
                  </span>
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-background">
                      <th className="text-left px-4 py-3 font-body font-body-medium text-text-secondary">Booking #</th>
                      <th className="text-left px-4 py-3 font-body font-body-medium text-text-secondary">Customer</th>
                      <th className="text-left px-4 py-3 font-body font-body-medium text-text-secondary">Service</th>
                      <th className="text-left px-4 py-3 font-body font-body-medium text-text-secondary">Therapist</th>
                      <th className="text-left px-4 py-3 font-body font-body-medium text-text-secondary">Room</th>
                      <th className="text-right px-4 py-3 font-body font-body-medium text-text-secondary">Amount</th>
                      <th className="text-center px-4 py-3 font-body font-body-medium text-text-secondary">Payment</th>
                      <th className="text-center px-4 py-3 font-body font-body-medium text-text-secondary">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.bookings.map((b) => (
                      <tr key={b.bookingId} className="hover:bg-background/50 spa-transition-fast">
                        <td className="px-4 py-3 font-body font-body-medium text-text-primary whitespace-nowrap">
                          {b.bookingNumber}
                        </td>
                        <td className="px-4 py-3 font-body font-body-normal text-text-primary">
                          {b.customerName}
                        </td>
                        <td className="px-4 py-3 font-body font-body-normal text-text-secondary">
                          {b.serviceName}
                        </td>
                        <td className="px-4 py-3 font-body font-body-normal text-text-secondary">
                          {b.therapistName}
                        </td>
                        <td className="px-4 py-3 font-body font-body-normal text-text-secondary">
                          {b.roomName}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="font-body font-body-semibold text-text-primary">
                            {formatNPR(b.finalAmount)}
                          </div>
                          {b.discountAmount > 0 && (
                            <div className="font-caption font-caption-normal text-xs text-error">
                              -{formatNPR(b.discountAmount)} disc.
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-body font-body-medium ${
                            b.paymentStatus === 'paid'
                              ? 'bg-success/10 text-success'
                              : 'bg-warning/10 text-warning'
                          }`}>
                            {b.paymentStatus === 'paid' ? b.paymentMode || 'Paid' : 'Unpaid'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <StatusBadge status={b.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Therapist Revenue Summary */}
          {report.therapistRevenueSummary.length > 0 && (
            <div className="bg-surface rounded-spa-lg spa-shadow-resting border border-border overflow-hidden">
              <div className="p-5 border-b border-border">
                <h3 className="font-heading font-heading-medium text-base text-text-primary flex items-center space-x-2">
                  <Icon name="User" size={18} className="text-primary" />
                  <span>Therapist Revenue Summary</span>
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-background">
                      <th className="text-left px-4 py-3 font-body font-body-medium text-text-secondary">Therapist</th>
                      <th className="text-center px-4 py-3 font-body font-body-medium text-text-secondary">Completed Bookings</th>
                      <th className="text-right px-4 py-3 font-body font-body-medium text-text-secondary">Total Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.therapistRevenueSummary.map((t, i) => (
                      <tr key={i} className="hover:bg-background/50 spa-transition-fast">
                        <td className="px-4 py-3 font-body font-body-medium text-text-primary">{t.therapistName}</td>
                        <td className="px-4 py-3 text-center font-body font-body-normal text-text-primary">{t.completedBookings}</td>
                        <td className="px-4 py-3 text-right font-body font-body-semibold text-success">{formatNPR(t.totalRevenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Staff Discount Summary */}
          {report.staffDiscountSummary.length > 0 && (
            <div className="bg-surface rounded-spa-lg spa-shadow-resting border border-border overflow-hidden">
              <div className="p-5 border-b border-border">
                <h3 className="font-heading font-heading-medium text-base text-text-primary flex items-center space-x-2">
                  <Icon name="Percent" size={18} className="text-primary" />
                  <span>Staff Discount Summary</span>
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-background">
                      <th className="text-left px-4 py-3 font-body font-body-medium text-text-secondary">Staff Name</th>
                      <th className="text-center px-4 py-3 font-body font-body-medium text-text-secondary">Discount Count</th>
                      <th className="text-right px-4 py-3 font-body font-body-medium text-text-secondary">Total Discount Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.staffDiscountSummary.map((s, i) => (
                      <tr key={i} className="hover:bg-background/50 spa-transition-fast">
                        <td className="px-4 py-3 font-body font-body-medium text-text-primary">{s.staffName}</td>
                        <td className="px-4 py-3 text-center font-body font-body-normal text-text-primary">{s.discountCount}</td>
                        <td className="px-4 py-3 text-right font-body font-body-semibold text-error">{formatNPR(s.totalDiscountAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Unpaid Bookings */}
          {report.unpaidBookings.length > 0 && (
            <div className="bg-surface rounded-spa-lg spa-shadow-resting border border-border border-l-4 border-l-warning overflow-hidden">
              <div className="p-5 border-b border-border">
                <h3 className="font-heading font-heading-medium text-base text-text-primary flex items-center space-x-2">
                  <Icon name="AlertTriangle" size={18} className="text-warning" />
                  <span>Unpaid Bookings</span>
                  <span className="font-caption font-caption-normal text-xs text-warning ml-2">
                    ({report.unpaidBookings.length})
                  </span>
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-background">
                      <th className="text-left px-4 py-3 font-body font-body-medium text-text-secondary">Booking #</th>
                      <th className="text-left px-4 py-3 font-body font-body-medium text-text-secondary">Customer</th>
                      <th className="text-left px-4 py-3 font-body font-body-medium text-text-secondary">Service</th>
                      <th className="text-right px-4 py-3 font-body font-body-medium text-text-secondary">Amount Due</th>
                      <th className="text-center px-4 py-3 font-body font-body-medium text-text-secondary">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.unpaidBookings.map((u, i) => (
                      <tr key={i} className="hover:bg-background/50 spa-transition-fast">
                        <td className="px-4 py-3 font-body font-body-medium text-text-primary">{u.bookingNumber}</td>
                        <td className="px-4 py-3 font-body font-body-normal text-text-primary">{u.customerName}</td>
                        <td className="px-4 py-3 font-body font-body-normal text-text-secondary">{u.serviceName}</td>
                        <td className="px-4 py-3 text-right font-body font-body-semibold text-warning">{formatNPR(u.finalAmount)}</td>
                        <td className="px-4 py-3 text-center">
                          <StatusBadge status={u.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Close Day Action */}
          {!report.isClosed && (
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
      {!loading && report && report.totals.totalBookings === 0 && (
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
                <strong className="text-warning">{report?.unpaidBookings?.length}</strong> booking{report?.unpaidBookings?.length !== 1 ? 's' : ''} still
                {report?.unpaidBookings?.length !== 1 ? ' have' : ' has'} unpaid status. Closing the day will lock all bookings,
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

// Status badge helper
function StatusBadge({ status }) {
  const styles = {
    'Pending': 'bg-blue-50 text-blue-700',
    'Confirmed': 'bg-indigo-50 text-indigo-700',
    'In-Progress': 'bg-amber-50 text-amber-700',
    'Completed': 'bg-success/10 text-success',
    'Cancelled': 'bg-error/10 text-error',
    'No Show': 'bg-gray-100 text-gray-600',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-body font-body-medium ${styles[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

export default DailyOperationalReportPanel;
