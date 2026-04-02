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
      <div className="bg-white rounded-lg p-6 border border-gray-200 text-center">
        <p className="text-sm text-gray-500">No branch selected.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header with Date Selector + Actions */}
      <div className="bg-white rounded-lg p-6 border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <Icon name="FileText" size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Daily Operational Report
              </h2>
              <p className="text-sm text-gray-500">
                {formatDate(selectedDate)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="date"
              value={selectedDate}
              max={today}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="h-9 px-3 border border-gray-200 rounded-md bg-white text-gray-900 text-sm focus:ring-1 focus:ring-primary focus:border-primary"
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
          <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
            <Icon name="Lock" size={16} className="text-emerald-600" />
            <span className="text-sm font-medium text-emerald-600">
              Day Closed
            </span>
            {report.closedAt && (
              <span className="text-xs text-gray-500 ml-auto">
                at {new Date(report.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="bg-white rounded-lg p-12 border border-gray-200 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-gray-500">Loading report...</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-4 bg-red-50 border border-red-200 rounded-lg">
          <Icon name="AlertCircle" size={16} className="text-red-600 mt-0.5 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Success */}
      {successMsg && (
        <div className="flex items-start gap-2 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
          <Icon name="CheckCircle" size={16} className="text-emerald-600 mt-0.5 shrink-0" />
          <p className="text-sm text-emerald-600">{successMsg}</p>
        </div>
      )}

      {/* Report Content */}
      {!loading && report && (
        <>
          {/* Revenue Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-white rounded-lg p-5 border border-gray-200">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="TrendingUp" size={16} className="text-gray-400" />
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Gross Revenue</span>
              </div>
              <p className="text-xl font-semibold text-gray-900">
                {formatNPR(report.totals.grossRevenue)}
              </p>
            </div>

            <div className="bg-white rounded-lg p-5 border border-gray-200">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="Percent" size={16} className="text-gray-400" />
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Discounts</span>
              </div>
              <p className="text-xl font-semibold text-red-600">
                - {formatNPR(report.totals.totalDiscount)}
              </p>
            </div>

            <div className="bg-white rounded-lg p-5 border border-gray-200 border-l-4 border-l-emerald-500">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="IndianRupee" size={16} className="text-emerald-600" />
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Net Revenue</span>
              </div>
              <p className="text-xl font-semibold text-emerald-600">
                {formatNPR(report.totals.netRevenue)}
              </p>
            </div>
          </div>

          {/* Booking Breakdown + Payment Mode */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Booking Breakdown */}
            <div className="bg-white rounded-lg p-5 border border-gray-200">
              <h3 className="text-base font-medium text-gray-900 mb-4 flex items-center gap-2">
                <Icon name="Calendar" size={18} className="text-primary" />
                <span>Booking Breakdown</span>
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Total Bookings</span>
                  <span className="text-sm font-semibold text-gray-900">{report.totals.totalBookings}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Completed</span>
                  <span className="text-sm font-semibold text-emerald-600">{report.totals.completedBookings}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Cancelled</span>
                  <span className="text-sm font-semibold text-red-600">{report.totals.cancelledBookings}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">No Show</span>
                  <span className="text-sm font-semibold text-amber-600">{report.totals.noShowBookings}</span>
                </div>
                <div className="border-t border-gray-200 pt-2 flex items-center justify-between">
                  <span className="text-sm text-gray-500">Unpaid (Confirmed/Completed)</span>
                  <span className={`text-sm font-semibold ${report.unpaidBookings.length > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {report.unpaidBookings.length}
                  </span>
                </div>
              </div>
            </div>

            {/* Payment Mode Breakdown */}
            <div className="bg-white rounded-lg p-5 border border-gray-200">
              <h3 className="text-base font-medium text-gray-900 mb-4 flex items-center gap-2">
                <Icon name="CreditCard" size={18} className="text-primary" />
                <span>Payment Breakdown</span>
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon name="Banknote" size={14} className="text-gray-400" />
                    <span className="text-sm text-gray-500">Cash</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">
                    {formatNPR(report.paymentBreakdown.cash)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon name="CreditCard" size={14} className="text-gray-400" />
                    <span className="text-sm text-gray-500">Card (Nabil / GlobalIME / NIC Asia)</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">
                    {formatNPR(report.paymentBreakdown.card)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon name="Smartphone" size={14} className="text-gray-400" />
                    <span className="text-sm text-gray-500">Fonepay</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">
                    {formatNPR(report.paymentBreakdown.fonepay)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Bookings Detail Table */}
          {report.bookings.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="p-4 border-b border-gray-200">
                <h3 className="text-base font-medium text-gray-900 flex items-center gap-2">
                  <Icon name="List" size={18} className="text-primary" />
                  <span>All Bookings</span>
                  <span className="text-xs text-gray-500 ml-2">
                    ({report.bookings.length})
                  </span>
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Booking #</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Customer</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Service</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Therapist</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Room</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">Amount</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-500">Payment</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-500">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {report.bookings.map((b) => (
                      <tr key={b.bookingId} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                          {b.bookingNumber}
                        </td>
                        <td className="px-4 py-3 text-gray-900">
                          {b.customerName}
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {b.serviceName}
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {b.therapistName}
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {b.roomName}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="font-semibold text-gray-900">
                            {formatNPR(b.finalAmount)}
                          </div>
                          {b.discountAmount > 0 && (
                            <div className="text-xs text-red-600">
                              -{formatNPR(b.discountAmount)} disc.
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            b.paymentStatus === 'paid'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-700'
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
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="p-4 border-b border-gray-200">
                <h3 className="text-base font-medium text-gray-900 flex items-center gap-2">
                  <Icon name="User" size={18} className="text-primary" />
                  <span>Therapist Revenue Summary</span>
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Therapist</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-500">Completed Bookings</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">Total Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {report.therapistRevenueSummary.map((t, i) => (
                      <tr key={i} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-900">{t.therapistName}</td>
                        <td className="px-4 py-3 text-center text-gray-900">{t.completedBookings}</td>
                        <td className="px-4 py-3 text-right font-semibold text-emerald-600">{formatNPR(t.totalRevenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Staff Discount Summary */}
          {report.staffDiscountSummary.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="p-4 border-b border-gray-200">
                <h3 className="text-base font-medium text-gray-900 flex items-center gap-2">
                  <Icon name="Percent" size={18} className="text-primary" />
                  <span>Staff Discount Summary</span>
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Staff Name</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-500">Discount Count</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">Total Discount Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {report.staffDiscountSummary.map((s, i) => (
                      <tr key={i} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-900">{s.staffName}</td>
                        <td className="px-4 py-3 text-center text-gray-900">{s.discountCount}</td>
                        <td className="px-4 py-3 text-right font-semibold text-red-600">{formatNPR(s.totalDiscountAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Unpaid Bookings */}
          {report.unpaidBookings.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 border-l-4 border-l-amber-500 overflow-hidden">
              <div className="p-4 border-b border-gray-200">
                <h3 className="text-base font-medium text-gray-900 flex items-center gap-2">
                  <Icon name="AlertTriangle" size={18} className="text-amber-600" />
                  <span>Unpaid Bookings</span>
                  <span className="text-xs text-amber-600 ml-2">
                    ({report.unpaidBookings.length})
                  </span>
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Booking #</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Customer</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Service</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">Amount Due</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-500">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {report.unpaidBookings.map((u, i) => (
                      <tr key={i} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-900">{u.bookingNumber}</td>
                        <td className="px-4 py-3 text-gray-900">{u.customerName}</td>
                        <td className="px-4 py-3 text-gray-500">{u.serviceName}</td>
                        <td className="px-4 py-3 text-right font-semibold text-amber-600">{formatNPR(u.finalAmount)}</td>
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
            <div className="bg-white rounded-lg p-5 border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-medium text-gray-900">
                    Close Day
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
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
        <div className="bg-white rounded-lg p-8 border border-gray-200 text-center">
          <Icon name="Calendar" size={48} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">
            No bookings found for {formatDate(selectedDate)}.
          </p>
        </div>
      )}

      {/* Unpaid Warning Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-modal-overlay flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md animate-fade-in">
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                  <Icon name="AlertTriangle" size={20} className="text-amber-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Unpaid Bookings Warning
                </h3>
              </div>

              <p className="text-sm text-gray-500">
                <strong className="text-amber-600">{report?.unpaidBookings?.length}</strong> booking{report?.unpaidBookings?.length !== 1 ? 's' : ''} still
                {report?.unpaidBookings?.length !== 1 ? ' have' : ' has'} unpaid status. Closing the day will lock all bookings,
                preventing further payment recording for these bookings.
              </p>
              <p className="text-sm text-gray-500">
                Do you still want to close the day?
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
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
    'Pending': 'bg-blue-100 text-blue-700',
    'Confirmed': 'bg-indigo-100 text-indigo-700',
    'In-Progress': 'bg-amber-100 text-amber-700',
    'Completed': 'bg-emerald-100 text-emerald-700',
    'Cancelled': 'bg-red-100 text-red-700',
    'No Show': 'bg-gray-100 text-gray-600',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

export default DailyOperationalReportPanel;
