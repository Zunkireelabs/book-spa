import { friendlyError } from '../../../utils/friendlyError';
import React, { useState, useEffect, useCallback } from 'react';
import { dayMoneyView } from '../../../lib/dayMoney';
import DayMoneyRows from '../../../components/ui/DayMoneyRows';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import { getDailySummary, closeDay, getDayUnfinishedBookings } from '../../../services/api';
import { closeDayBlock, unpaidCloseWarning } from '../../../lib/closeDay';
import { wordBranch } from '../../../utils/industryTerms';

function formatNPR(amount) {
  // Whole rupees show without decimals; paise show both digits (25,600 vs 1,234.50), never ".00" and never hidden.
  const n = Number(amount);
  const paise = Math.abs(n - Math.round(n)) > 0.0049;
  return `NPR ${n.toLocaleString('en-IN', { minimumFractionDigits: paise ? 2 : 0, maximumFractionDigits: paise ? 2 : 0 })}`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

const DailyClosingPanel = ({ branchId, onOpenBooking }) => {
  const today = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const [summary, setSummary] = useState(null);
  const [unfinished, setUnfinished] = useState([]);   // ZNLY-234: bookings that block the close
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
    const { data: openRows } = await getDayUnfinishedBookings(branchId, selectedDate);
    setUnfinished(openRows || []);

    if (fetchError) {
      setError(friendlyError(fetchError, 'Failed to load daily summary.'));
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
      setError(friendlyError(closeError, 'Failed to close the day.'));
    } else {
      setSuccessMsg('Day closed successfully. All bookings are now locked.');
      await loadSummary();
    }
    setClosing(false);
  };

  const block = closeDayBlock(unfinished);
  // ZNLY-234: open day = one set of figures; closed day = at close / after close / now, never mixed
  const view = dayMoneyView(summary);
  const headline = view.headline;
  const openLink = (id) => (onOpenBooking
    ? <button type="button" onClick={() => onOpenBooking(id)} className="text-primary underline text-sm max-md:min-h-11 max-md:min-w-11 max-md:inline-flex max-md:items-center max-md:justify-center">Open</button>
    : <a href={`${window.location.pathname.split('/').slice(0, 2).join('/')}/bookings/${id}`} target="_blank" rel="noreferrer" className="text-primary underline text-sm max-md:min-h-11 max-md:min-w-11 max-md:inline-flex max-md:items-center max-md:justify-center">Open</a>);

  const handleCloseDayClick = () => {
    if (block.blocked) return;
    if (summary?.unpaidCount > 0) {
      setShowConfirmModal(true);
    } else {
      handleCloseDay();
    }
  };

  if (!branchId) {
    return (
      <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 border border-border text-center">
        <p className="font-body font-body-normal text-text-secondary">No {wordBranch()} selected.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Date Selector */}
      <div>
        <div className="flex items-center justify-between max-sm:flex-col max-sm:items-stretch max-sm:gap-3 mb-1">
          <div className="flex items-center space-x-3 min-w-0">
                        <div>
              <h2 className="font-heading font-heading-semibold text-lg text-text-primary tracking-[-0.3px]">
                Daily Reconciliation
              </h2>
              <p className="font-caption font-caption-normal text-sm text-text-secondary">
                {formatDate(selectedDate)}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3 max-sm:space-x-0 max-sm:gap-3">
            <input
              type="date"
              value={selectedDate}
              max={today}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 max-sm:min-h-11 max-sm:flex-1 max-sm:min-w-0 border border-border rounded-spa bg-surface text-text-primary text-sm focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast"
            />
            <Button
              variant="outline"
              size="sm"
              iconName="RefreshCw"
              iconPosition="left"
              className="max-sm:min-h-11"
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
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-surface rounded-spa-lg spa-shadow-resting p-3.5 border border-border min-w-0">
              <div className="flex items-center space-x-2 mb-2">
                <Icon name="TrendingUp" size={16} className="text-text-secondary" />
                <span className="font-caption font-caption-medium text-[11px] text-text-secondary uppercase tracking-wide">Money in</span>
              </div>
              <p className="font-heading font-heading-semibold text-[clamp(1rem,1.35vw,1.25rem)] max-sm:text-xl whitespace-nowrap tabular-nums text-text-primary">
                {formatNPR(headline.moneyIn)}
              </p>
            </div>

            <div className="bg-surface rounded-spa-lg spa-shadow-resting p-3.5 border border-border min-w-0">
              <div className="flex items-center space-x-2 mb-2">
                <Icon name="Percent" size={16} className="text-text-secondary" />
                <span className="font-caption font-caption-medium text-[11px] text-text-secondary uppercase tracking-wide">Refunds</span>
              </div>
              <p className="font-heading font-heading-semibold text-[clamp(1rem,1.35vw,1.25rem)] max-sm:text-xl whitespace-nowrap tabular-nums text-error">
                − {formatNPR(headline.refunds)}
              </p>
            </div>

            <div className="bg-surface rounded-spa-lg spa-shadow-resting p-3.5 border border-border border-l-4 border-l-primary min-w-0 max-sm:col-span-2">
              <div className="flex items-center space-x-2 mb-2">
                <Icon name="IndianRupee" size={16} className="text-success" />
                <span className="font-caption font-caption-medium text-[11px] text-text-secondary uppercase tracking-wide">{view.closed ? 'Taken at close' : 'Taken today'}</span>
              </div>
              <p className="font-heading font-heading-semibold text-[clamp(1rem,1.35vw,1.25rem)] max-sm:text-xl whitespace-nowrap tabular-nums text-primary">
                {formatNPR(headline.taken)}
              </p>
            </div>
          </div>

          {/* Booking Breakdown + Payment Mode */}
          <div className="grid grid-cols-1 gap-4">
            {/* Booking Breakdown */}
            <div className="bg-surface rounded-spa-lg spa-shadow-resting p-5 border border-border">
              <h3 className="font-heading font-heading-medium text-base text-text-primary mb-4 flex items-center space-x-2">
                <Icon name="Calendar" size={18} className="text-primary" />
                <span>Booking Breakdown</span>
              </h3>
              <div className="divide-y divide-border">
                <div className="flex items-baseline justify-between gap-3 py-2.5 max-md:min-h-11">
                  <span className="font-body font-body-normal text-sm text-text-secondary">Total Bookings</span>
                  <span className="font-body font-body-semibold text-sm whitespace-nowrap tabular-nums text-text-primary">{summary.totalBookings}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3 py-2.5 max-md:min-h-11">
                  <span className="font-body font-body-normal text-sm text-text-secondary">Completed</span>
                  <span className="font-body font-body-semibold text-sm whitespace-nowrap tabular-nums text-success">{summary.completedBookings}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3 py-2.5 max-md:min-h-11">
                  <span className="font-body font-body-normal text-sm text-text-secondary">Cancelled</span>
                  <span className="font-body font-body-semibold text-sm whitespace-nowrap tabular-nums text-error">{summary.cancelledBookings}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3 py-2.5 max-md:min-h-11">
                  <span className="font-body font-body-normal text-sm text-text-secondary">No Show</span>
                  <span className="font-body font-body-semibold text-sm whitespace-nowrap tabular-nums text-warning">{summary.noShowBookings}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3 py-2.5 max-md:min-h-11">
                  <span className="font-body font-body-normal text-sm text-text-secondary">Not finished<span className="block text-xs text-text-tertiary">Pending / Confirmed / In-Progress</span></span>
                  <span className="font-body font-body-semibold text-sm whitespace-nowrap tabular-nums text-text-primary">{summary.notFinishedBookings}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3 py-2.5 max-md:min-h-11">
                  <span className="font-body font-body-normal text-sm text-text-secondary">Discounts given<span className="block text-xs text-text-tertiary">Today's bookings</span></span>
                  <span className="font-body font-body-semibold text-sm whitespace-nowrap tabular-nums text-text-primary">− {formatNPR(summary.totalDiscounts)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3 py-2.5 max-md:min-h-11">
                  <span className="font-body font-body-normal text-sm text-text-secondary">Not fully paid</span>
                  <span className={`font-body font-body-semibold text-sm whitespace-nowrap tabular-nums ${summary.unpaidCount > 0 ? 'text-warning' : 'text-success'}`}>
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
              <div>
                <DayMoneyRows data={summary} fmt={formatNPR} lab="font-body font-body-normal text-sm text-text-secondary" val="font-body font-body-semibold text-sm text-text-primary" />
              </div>
            </div>
          </div>

          {/* Close Day Action */}
          {!summary.isClosed && (
            <div className="bg-surface rounded-spa-lg spa-shadow-resting p-5 border border-border">
              <div className="flex flex-col items-stretch gap-4">
                <div className="max-md:min-w-0">
                  <h3 className="font-heading font-heading-medium text-base text-text-primary">
                    Close Day
                  </h3>
                  <p className="font-caption font-caption-normal text-sm text-text-secondary mt-1">
                    Locks all bookings and product sales for {formatDate(selectedDate)}. This action cannot be undone.
                  </p>
                  {block.blocked && (
                    <div className="mt-3 p-3 rounded-spa border border-error/30 bg-error/5" data-close-blocked>
                      <p className="text-sm text-error font-medium">Can't close the day yet</p>
                      <p className="text-sm text-text-secondary mt-1">{block.message}</p>
                      <ul className="mt-2 space-y-1">
                        {block.rows.map((r) => (
                          <li key={r.bookingId} className="flex items-center gap-2 text-sm text-text-primary max-md:min-h-11">
                            <span className="font-medium max-md:whitespace-nowrap max-md:text-[13px]">{r.bookingNumber}</span><span className="text-text-secondary max-md:min-w-0 max-md:flex-1 max-md:break-words max-md:leading-tight">{r.customerName} · {r.status}</span>{openLink(r.bookingId)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <Button
                  variant="primary"
                  iconName="Lock"
                  iconPosition="left"
                  onClick={handleCloseDayClick}
                  loading={closing}
                  disabled={block.blocked}
                  className="max-md:w-full max-md:h-12 md:self-end md:min-w-[180px] whitespace-nowrap"
                >
                  Close Day
                </Button>
                {block.blocked && (
                  <p className="text-xs text-warning text-right max-md:text-center -mt-2" data-close-reason>
                    Finish the {block.rows.length} {block.rows.length === 1 ? 'booking' : 'bookings'} above first
                  </p>
                )}
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

      {showConfirmModal && (
        <ConfirmDialog
          title="Not fully paid bookings"
          message={unpaidCloseWarning(summary?.unpaidCount)}
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

export default DailyClosingPanel;
