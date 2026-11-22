import { nepalToday } from '../../../utils/nepalTime';
import { friendlyError } from '../../../utils/friendlyError';
import React, { useState, useEffect, useCallback } from 'react';
import { dayMoneyView } from '../../../lib/dayMoney';
import DayMoneyRows from '../../../components/ui/DayMoneyRows';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import { getDailyOperationalReport, exportDailyReportCSV, closeDay, fetchAttendance, fetchAttendanceSummary } from '../../../services/api';
import { useIndustry } from '../../../hooks/useIndustry';
import { paymentStatusLabel } from '../../../utils/paymentStatusLabel';
import { wordBranch } from '../../../utils/industryTerms';
import { formatNPR } from '../../../services/bookingTransformers';

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTime(timeStr) {
  if (!timeStr) return '—';
  const [h, m] = timeStr.split(':');
  const d = new Date();
  d.setHours(Number(h), Number(m), 0, 0);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const DailyOperationalReportPanel = ({ branchId }) => {
  const { staffLabel } = useIndustry();
  const today = nepalToday();
  const [selectedDate, setSelectedDate] = useState(today);
  const [report, setReport] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [attendanceSummary, setAttendanceSummary] = useState(null);
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

    const [reportRes, attendanceRes, summaryRes] = await Promise.all([
      getDailyOperationalReport(branchId, selectedDate),
      fetchAttendance({ branchId, date: selectedDate }),
      fetchAttendanceSummary({ branchId, date: selectedDate }),
    ]);

    if (reportRes.error) {
      setError(friendlyError(reportRes.error, 'Failed to load daily report.'));
    } else {
      setReport(reportRes.data);
    }
    setAttendance(attendanceRes.error ? null : attendanceRes.data);
    setAttendanceSummary(summaryRes.error ? null : summaryRes.data);
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
      setError(friendlyError(closeError, 'Failed to close the day.'));
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

    let csv = exportDailyReportCSV(report);

    if (report.therapistRevenueSummary?.length) {
      const top = report.therapistRevenueSummary.reduce((t, x) => (x.totalRevenue > t.totalRevenue ? x : t));
      csv += '\n\nTop Performer\n';
      csv += `Staff,${top.therapistName}\n`;
      csv += `Completed Bookings,${top.completedBookings}\n`;
      csv += `Revenue,${top.totalRevenue}\n`;
    }

    if (attendanceSummary && attendanceSummary.totalTherapists > 0) {
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      csv += '\n\nStaff Attendance\n';
      csv += `Total Staff,${attendanceSummary.totalTherapists}\n`;
      csv += `Present,${attendanceSummary.presentCount}\n`;
      csv += `Absent,${attendanceSummary.absentCount}\n`;
      csv += `Leave,${attendanceSummary.leaveCount}\n`;
      csv += `Half Day,${attendanceSummary.halfDayCount}\n`;
      csv += `Attendance Rate,${attendanceSummary.attendanceRate}%\n`;
      if (attendance && attendance.length > 0) {
        csv += '\nStaff,Status,Check In,Check Out,Notes\n';
        for (const a of attendance) {
          csv += [
            esc(a.therapistName),
            esc(a.status || 'Not Marked'),
            esc(a.checkInTime || ''),
            esc(a.checkOutTime || ''),
            esc(a.notes || ''),
          ].join(',') + '\n';
        }
      }
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `daily-report-${selectedDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // ZNLY-234: open day = one set of figures; closed day = at close / after close / now, never mixed
  const view = dayMoneyView(report);
  const headline = view.headline;

  if (!branchId) {
    return (
      <div className="bg-surface rounded-spa p-6 border border-border text-center">
        <p className="text-sm text-text-secondary">No {wordBranch()} selected.</p>
      </div>
    );
  }

  const topPerformer = report?.therapistRevenueSummary?.length
    ? report.therapistRevenueSummary.reduce((top, t) => (t.totalRevenue > top.totalRevenue ? t : top))
    : null;

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {/* Header with Date Selector + Actions */}
      <div className="bg-surface rounded-spa p-4 sm:p-6 border border-border">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-primary/10 rounded-spa flex items-center justify-center flex-shrink-0">
              <Icon name="FileText" size={20} className="text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="font-heading font-heading-semibold text-base sm:text-lg text-text-primary truncate">
                Daily Operational Report
              </h2>
              <p className="text-xs sm:text-sm text-text-secondary truncate">
                {formatDate(selectedDate)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <input
              type="date"
              value={selectedDate}
              max={today}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="h-9 px-3 border border-border rounded-spa bg-surface text-text-primary text-sm focus:ring-1 focus:ring-primary focus:border-primary"
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
          <div className="flex items-center gap-2 px-4 py-2 bg-success/10 border border-success/20 rounded-spa">
            <Icon name="Lock" size={16} className="text-success" />
            <span className="text-sm font-medium text-success">
              Day Closed
            </span>
            {report.closedAt && (
              <span className="text-xs text-text-secondary ml-auto">
                at {new Date(report.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="bg-surface rounded-spa p-12 border border-border text-center">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-text-secondary">Loading report...</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-4 bg-error/10 border border-error/20 rounded-spa">
          <Icon name="AlertCircle" size={16} className="text-error mt-0.5 shrink-0" />
          <p className="text-sm text-error">{error}</p>
        </div>
      )}

      {/* Success */}
      {successMsg && (
        <div className="flex items-start gap-2 p-4 bg-success/10 border border-success/20 rounded-spa">
          <Icon name="CheckCircle" size={16} className="text-success mt-0.5 shrink-0" />
          <p className="text-sm text-success">{successMsg}</p>
        </div>
      )}

      {/* Report Content */}
      {!loading && report && (
        <>
          {/* Revenue Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-surface rounded-spa p-5 border border-border">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="TrendingUp" size={16} className="text-text-secondary" />
                <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">Money in</span>
              </div>
              <p className="text-xl font-semibold text-text-primary">
                {formatNPR(headline.moneyIn)}
              </p>
            </div>

            <div className="bg-surface rounded-spa p-5 border border-border">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="Percent" size={16} className="text-text-secondary" />
                <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">Refunds</span>
              </div>
              <p className="text-xl font-semibold text-error">
                − {formatNPR(headline.refunds)}
              </p>
            </div>

            <div className="bg-surface rounded-spa p-5 border border-border border-l-4 border-l-success">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="IndianRupee" size={16} className="text-success" />
                <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">{view.closed ? 'Taken at close' : 'Taken today'}</span>
              </div>
              <p className="text-xl font-semibold text-success">
                {formatNPR(headline.taken)}
              </p>
            </div>
          </div>

          {/* Tips — NOT revenue, deliberately kept outside the Revenue Summary Cards
              and Payment Breakdown above (migration-240-add-booking-tips.sql). */}
          {report.tipsTotal > 0 && (
            <div className="bg-surface rounded-spa p-3 border border-border border-dashed flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon name="Banknote" size={14} className="text-text-secondary" />
                <span className="text-xs text-text-secondary">Tips Collected (not revenue — passed to staff)</span>
              </div>
              <span className="text-sm font-semibold text-text-secondary">{formatNPR(report.tipsTotal)}</span>
            </div>
          )}

          {/* Booking Breakdown + Payment Mode */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Booking Breakdown */}
            <div className="bg-surface rounded-spa p-5 border border-border">
              <h3 className="font-heading font-heading-medium text-base text-text-primary mb-4 flex items-center gap-2">
                <Icon name="Calendar" size={18} className="text-primary" />
                <span>Booking Breakdown</span>
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">Total Bookings</span>
                  <span className="text-sm font-semibold text-text-primary">{report.totals.totalBookings}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">Completed</span>
                  <span className="text-sm font-semibold text-success">{report.totals.completedBookings}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">Cancelled</span>
                  <span className="text-sm font-semibold text-error">{report.totals.cancelledBookings}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">No Show</span>
                  <span className="text-sm font-semibold text-warning">{report.totals.noShowBookings}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">Not finished (Pending / Confirmed / In-Progress)</span>
                  <span className="text-sm font-semibold text-text-primary">{report.totals.notFinishedBookings}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">Discounts given (today's bookings)</span>
                  <span className="text-sm font-semibold text-text-primary">− {formatNPR(report.totals.totalDiscount)}</span>
                </div>
                <div className="border-t border-border pt-2 flex items-center justify-between">
                  <span className="text-sm text-text-secondary">Not fully paid</span>
                  <span className={`text-sm font-semibold ${report.unpaidBookings.length > 0 ? 'text-warning' : 'text-success'}`}>
                    {report.unpaidBookings.length}
                  </span>
                </div>
              </div>
            </div>

            {/* Payment Mode Breakdown */}
            <div className="bg-surface rounded-spa p-5 border border-border">
              <h3 className="font-heading font-heading-medium text-base text-text-primary mb-4 flex items-center gap-2">
                <Icon name="CreditCard" size={18} className="text-primary" />
                <span>Payment Breakdown</span>
              </h3>
              <div>
                <DayMoneyRows data={report} fmt={formatNPR} lab="text-sm text-text-secondary" val="text-sm font-semibold text-text-primary" />
              </div>
            </div>
          </div>

          {/* Bookings Detail Table */}
          {report.bookings.length > 0 && (
            <div className="bg-surface rounded-spa border border-border overflow-hidden">
              <div className="p-4 border-b border-border">
                <h3 className="font-heading font-heading-medium text-base text-text-primary flex items-center gap-2">
                  <Icon name="List" size={18} className="text-primary" />
                  <span>All Bookings</span>
                  <span className="text-xs text-text-secondary ml-2">
                    ({report.bookings.length})
                  </span>
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-background">
                      <th className="text-left px-4 py-3 font-medium text-text-secondary">Booking #</th>
                      <th className="text-left px-4 py-3 font-medium text-text-secondary">Customer</th>
                      <th className="text-left px-4 py-3 font-medium text-text-secondary">Service</th>
                      <th className="text-left px-4 py-3 font-medium text-text-secondary">{staffLabel}</th>
                      {report.bookings.some((b) => b.roomName) && <th className="text-left px-4 py-3 font-medium text-text-secondary">Room</th>}
                      <th className="text-right px-4 py-3 font-medium text-text-secondary">Amount</th>
                      <th className="text-center px-4 py-3 font-medium text-text-secondary">Payment</th>
                      <th className="text-center px-4 py-3 font-medium text-text-secondary">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.bookings.map((b) => (
                      <tr key={b.bookingId} className="hover:bg-background/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-text-primary whitespace-nowrap">
                          {b.bookingNumber}
                        </td>
                        <td className="px-4 py-3 text-text-primary">
                          {b.customerName}
                        </td>
                        <td className="px-4 py-3 text-text-secondary">
                          {b.serviceName}
                        </td>
                        <td className="px-4 py-3 text-text-secondary">
                          {b.therapistName}
                        </td>
                        {report.bookings.some((x) => x.roomName) && (
                          <td className="px-4 py-3 text-text-secondary">
                            {b.roomName}
                          </td>
                        )}
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="font-semibold text-text-primary">
                            {formatNPR(b.finalAmount)}
                          </div>
                          {b.discountAmount > 0 && (
                            <div className="text-xs text-error">
                              -{formatNPR(b.discountAmount)} disc.
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {(() => {
                            const payState = paymentStatusLabel(b);
                            const tone = { success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning', neutral: 'bg-gray-100 text-text-secondary' }[payState.tone];
                            return (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${tone}`}>
                                {b.paymentStatus === 'paid' ? b.paymentMode || 'Paid' : payState.label}
                              </span>
                            );
                          })()}
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

          {/* Top Performer (service staff) */}
          {topPerformer && (
            <div className="bg-surface rounded-spa p-5 border border-border border-l-4 border-l-accent">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-accent/10 rounded-spa flex items-center justify-center shrink-0">
                    <Icon name="Award" size={20} className="text-accent" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-text-secondary uppercase tracking-wider">Top Performer</p>
                    <p className="font-heading font-heading-semibold text-lg text-text-primary">{topPerformer.therapistName}</p>
                    <p className="text-xs text-text-secondary">
                      {topPerformer.completedBookings} completed booking{topPerformer.completedBookings !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-text-secondary uppercase tracking-wider">Revenue</p>
                  <p className="text-xl font-semibold text-success">{formatNPR(topPerformer.totalRevenue)}</p>
                </div>
              </div>
            </div>
          )}

          {/* Therapist Revenue Summary */}
          {report.therapistRevenueSummary.length > 0 && (
            <div className="bg-surface rounded-spa border border-border overflow-hidden">
              <div className="p-4 border-b border-border">
                <h3 className="font-heading font-heading-medium text-base text-text-primary flex items-center gap-2">
                  <Icon name="User" size={18} className="text-primary" />
                  <span>{staffLabel} Revenue Summary</span>
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-background">
                      <th className="text-left px-4 py-3 font-medium text-text-secondary">{staffLabel}</th>
                      <th className="text-center px-4 py-3 font-medium text-text-secondary">Completed Bookings</th>
                      <th className="text-right px-4 py-3 font-medium text-text-secondary">Total Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.therapistRevenueSummary.map((t, i) => (
                      <tr key={i} className="hover:bg-background/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-text-primary">{t.therapistName}</td>
                        <td className="px-4 py-3 text-center text-text-primary">{t.completedBookings}</td>
                        <td className="px-4 py-3 text-right font-semibold text-success">{formatNPR(t.totalRevenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Attendance Report */}
          {attendanceSummary && attendanceSummary.totalTherapists > 0 && (
            <div className="bg-surface rounded-spa border border-border overflow-hidden">
              <div className="p-4 border-b border-border">
                <h3 className="font-heading font-heading-medium text-base text-text-primary flex items-center gap-2">
                  <Icon name="Users" size={18} className="text-primary" />
                  <span>Staff Attendance</span>
                  <span className="text-xs text-text-secondary ml-2">
                    ({attendanceSummary.attendanceRate}% present)
                  </span>
                </h3>
              </div>

              {/* Summary chips */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 p-4 border-b border-border">
                <div className="rounded-spa border border-border p-3">
                  <p className="text-xs font-medium text-text-secondary uppercase tracking-wider">Total Staff</p>
                  <p className="font-heading font-heading-semibold text-lg text-text-primary">{attendanceSummary.totalTherapists}</p>
                </div>
                <div className="rounded-spa border border-border p-3">
                  <p className="text-xs font-medium text-text-secondary uppercase tracking-wider">Present</p>
                  <p className="text-lg font-semibold text-success">{attendanceSummary.presentCount}</p>
                </div>
                <div className="rounded-spa border border-border p-3">
                  <p className="text-xs font-medium text-text-secondary uppercase tracking-wider">Absent</p>
                  <p className="text-lg font-semibold text-error">{attendanceSummary.absentCount}</p>
                </div>
                <div className="rounded-spa border border-border p-3">
                  <p className="text-xs font-medium text-text-secondary uppercase tracking-wider">Leave</p>
                  <p className="text-lg font-semibold text-warning">{attendanceSummary.leaveCount}</p>
                </div>
                <div className="rounded-spa border border-border p-3">
                  <p className="text-xs font-medium text-text-secondary uppercase tracking-wider">Half Day</p>
                  <p className="text-lg font-semibold text-indigo-600">{attendanceSummary.halfDayCount}</p>
                </div>
              </div>

              {/* Per-staff table */}
              {attendance && attendance.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-background">
                        <th className="text-left px-4 py-3 font-medium text-text-secondary">Staff</th>
                        <th className="text-center px-4 py-3 font-medium text-text-secondary">Status</th>
                        <th className="text-center px-4 py-3 font-medium text-text-secondary">Check In</th>
                        <th className="text-center px-4 py-3 font-medium text-text-secondary">Check Out</th>
                        <th className="text-left px-4 py-3 font-medium text-text-secondary">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {attendance.map((a) => (
                        <tr key={a.therapistId} className="hover:bg-background/50 transition-colors">
                          <td className="px-4 py-3 font-medium text-text-primary">{a.therapistName}</td>
                          <td className="px-4 py-3 text-center">
                            <AttendanceBadge status={a.status} />
                          </td>
                          <td className="px-4 py-3 text-center text-text-secondary">{formatTime(a.checkInTime)}</td>
                          <td className="px-4 py-3 text-center text-text-secondary">{formatTime(a.checkOutTime)}</td>
                          <td className="px-4 py-3 text-text-secondary">{a.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Staff Discount Summary */}
          {report.staffDiscountSummary.length > 0 && (
            <div className="bg-surface rounded-spa border border-border overflow-hidden">
              <div className="p-4 border-b border-border">
                <h3 className="font-heading font-heading-medium text-base text-text-primary flex items-center gap-2">
                  <Icon name="Percent" size={18} className="text-primary" />
                  <span>Staff Discount Summary</span>
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-background">
                      <th className="text-left px-4 py-3 font-medium text-text-secondary">Staff Name</th>
                      <th className="text-center px-4 py-3 font-medium text-text-secondary">Discount Count</th>
                      <th className="text-right px-4 py-3 font-medium text-text-secondary">Total Discount Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.staffDiscountSummary.map((s, i) => (
                      <tr key={i} className="hover:bg-background/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-text-primary">{s.staffName}</td>
                        <td className="px-4 py-3 text-center text-text-primary">{s.discountCount}</td>
                        <td className="px-4 py-3 text-right font-semibold text-error">{formatNPR(s.totalDiscountAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Unpaid Bookings */}
          {report.unpaidBookings.length > 0 && (
            <div className="bg-surface rounded-spa border border-border border-l-4 border-l-warning overflow-hidden">
              <div className="p-4 border-b border-border">
                <h3 className="font-heading font-heading-medium text-base text-text-primary flex items-center gap-2">
                  <Icon name="AlertTriangle" size={18} className="text-warning" />
                  <span>Unpaid Bookings</span>
                  <span className="text-xs text-warning ml-2">
                    ({report.unpaidBookings.length})
                  </span>
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-background">
                      <th className="text-left px-4 py-3 font-medium text-text-secondary">Booking #</th>
                      <th className="text-left px-4 py-3 font-medium text-text-secondary">Customer</th>
                      <th className="text-left px-4 py-3 font-medium text-text-secondary">Service</th>
                      <th className="text-right px-4 py-3 font-medium text-text-secondary">Amount Due</th>
                      <th className="text-center px-4 py-3 font-medium text-text-secondary">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.unpaidBookings.map((u, i) => (
                      <tr key={i} className="hover:bg-background/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-text-primary">{u.bookingNumber}</td>
                        <td className="px-4 py-3 text-text-primary">{u.customerName}</td>
                        <td className="px-4 py-3 text-text-secondary">{u.serviceName}</td>
                        <td className="px-4 py-3 text-right font-semibold text-warning">{formatNPR(u.finalAmount)}</td>
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
            <div className="bg-surface rounded-spa p-5 border border-border">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-heading font-heading-medium text-base text-text-primary">
                    Close Day
                  </h3>
                  <p className="text-sm text-text-secondary mt-1">
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
        <div className="bg-surface rounded-spa p-8 border border-border text-center">
          <Icon name="Calendar" size={48} className="text-text-tertiary mx-auto mb-3" />
          <p className="text-sm text-text-secondary">
            No bookings found for {formatDate(selectedDate)}.
          </p>
        </div>
      )}

      {showConfirmModal && (
        <ConfirmDialog
          title="Unpaid bookings warning"
          message={`${report?.unpaidBookings?.length} booking${report?.unpaidBookings?.length !== 1 ? 's' : ''} still ${report?.unpaidBookings?.length !== 1 ? 'have' : 'has'} unpaid status. Closing the day will lock all bookings, preventing further payment recording for these bookings. Do you still want to close the day?`}
          confirmLabel="Close anyway"
          requireReason={false}
          isSubmitting={closing}
          onConfirm={handleCloseDay}
          onClose={() => setShowConfirmModal(false)}
        />
      )}
    </div>
  );
};

// Status badge helper
function StatusBadge({ status }) {
  const styles = {
    'Pending': 'bg-blue-100 text-blue-700',
    'Confirmed': 'bg-indigo-100 text-indigo-700',
    'In-Progress': 'bg-warning/10 text-warning',
    'Completed': 'bg-success/10 text-success',
    'Cancelled': 'bg-error/10 text-error',
    'No Show': 'bg-gray-100 text-text-secondary',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-text-secondary'}`}>
      {status}
    </span>
  );
}

// Attendance status badge helper
function AttendanceBadge({ status }) {
  if (!status) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-text-secondary">
        Not Marked
      </span>
    );
  }

  const styles = {
    'Present': 'bg-success/10 text-success',
    'Absent': 'bg-error/10 text-error',
    'Leave': 'bg-warning/10 text-warning',
    'Annual Leave': 'bg-warning/10 text-warning',
    'Sick Leave': 'bg-warning/10 text-warning',
    'Day Off': 'bg-primary/10 text-primary',
    '1st-Half Day': 'bg-indigo-100 text-indigo-700',
    '2nd-Half Day': 'bg-indigo-100 text-indigo-700',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-text-secondary'}`}>
      {status}
    </span>
  );
}

export default DailyOperationalReportPanel;
