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
  return `NPR ${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
    ? <button type="button" onClick={() => onOpenBooking(id)} className="text-primary underline text-sm">Open</button>
    : <a href={`${window.location.pathname.split('/').slice(0, 2).join('/')}/bookings/${id}`} target="_blank" rel="noreferrer" className="text-primary underline text-sm">Open</a>);

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
                <span className="font-caption font-caption-medium text-xs text-text-secondary uppercase tracking-wider">Money in</span>
              </div>
              <p className="font-heading font-heading-semibold text-xl text-text-primary">
                {formatNPR(headline.moneyIn)}
              </p>
            </div>

            <div className="bg-surface rounded-spa-lg spa-shadow-resting p-5 border border-border">
              <div className="flex items-center space-x-2 mb-2">
                <Icon name="Percent" size={16} className="text-text-secondary" />
                <span className="font-caption font-caption-medium text-xs text-text-secondary uppercase tracking-wider">Refunds</span>
              </div>
              <p className="font-heading font-heading-semibold text-xl text-error">
                − {formatNPR(headline.refunds)}
              </p>
            </div>

            <div className="bg-surface rounded-spa-lg spa-shadow-resting p-5 border border-border border-l-4 border-l-success">
              <div className="flex items-center space-x-2 mb-2">
                <Icon name="IndianRupee" size={16} className="text-success" />
                <span className="font-caption font-caption-medium text-xs text-text-secondary uppercase tracking-wider">{view.closed ? 'Taken at close' : 'Taken today'}</span>
              </div>
              <p className="font-heading font-heading-semibold text-xl text-success">
                {formatNPR(headline.taken)}
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
                <div className="flex items-center justify-between">
                  <span className="font-body font-body-normal text-sm text-text-secondary">No Show</span>
                  <span className="font-body font-body-semibold text-sm text-warning">{summary.noShowBookings}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-body font-body-normal text-sm text-text-secondary">Not finished (Pending / Confirmed / In-Progress)</span>
                  <span className="font-body font-body-semibold text-sm text-text-primary">{summary.notFinishedBookings}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-body font-body-normal text-sm text-text-secondary">Discounts given (today's bookings)</span>
                  <span className="font-body font-body-semibold text-sm text-text-primary">− {formatNPR(summary.totalDiscounts)}</span>
                </div>
                <div className="border-t border-border pt-2 flex items-center justify-between">
                  <span className="font-body font-body-normal text-sm text-text-secondary">Not fully paid</span>
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
                <DayMoneyRows data={summary} fmt={formatNPR} lab="font-body font-body-normal text-sm text-text-secondary" val="font-body font-body-semibold text-sm text-text-primary" head="font-heading font-heading-medium text-sm text-text-primary" />
                {[['product', 'Products', 'Package'], ['voucher', 'Voucher sales', 'Ticket'], ['membership', 'Membership deposits', 'Wallet'], ['package', 'Package sales', 'Gift']].filter(([k]) => Number(summary.sources?.[k]) > 0).map(([k, label, icon]) => (
                  <div key={k} className="border-t border-border pt-2 flex items-center justify-between" data-source-line={k}>
                    <div className="flex items-center gap-2">
                      <Icon name={icon} size={14} className="text-text-secondary" />
                      <span className="font-body font-body-normal text-sm text-text-secondary">of which: {label}</span>
                    </div>
                    <span className="font-body font-body-semibold text-sm text-text-primary">{formatNPR(summary.sources[k])}</span>
                  </div>
                ))}
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
                    Locks all bookings and product sales for {formatDate(selectedDate)}. This action cannot be undone.
                  </p>
                  {block.blocked && (
                    <div className="mt-3 p-3 rounded-spa border border-error/30 bg-error/5" data-close-blocked>
                      <p className="text-sm text-error font-medium">Can't close the day yet</p>
                      <p className="text-sm text-text-secondary mt-1">{block.message}</p>
                      <ul className="mt-2 space-y-1">
                        {block.rows.map((r) => (
                          <li key={r.bookingId} className="flex items-center gap-2 text-sm text-text-primary">
                            <span className="font-medium">{r.bookingNumber}</span><span className="text-text-secondary">{r.customerName} · {r.status}</span>{openLink(r.bookingId)}
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
