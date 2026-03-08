import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import { getTherapistPerformance } from '../../../../services/api';

function getTier(score) {
  if (score >= 85) return { label: 'Top Performer', color: 'bg-success/10 text-success' };
  if (score >= 70) return { label: 'Strong', color: 'bg-primary/10 text-primary' };
  if (score >= 55) return { label: 'Average', color: 'bg-warning/10 text-warning' };
  return { label: 'Needs Attention', color: 'bg-error/10 text-error' };
}

function ScoreBadge({ score }) {
  const tier = getTier(score);
  return (
    <div className="flex items-center space-x-2">
      <span className="font-data font-data-medium text-sm text-text-primary">{score}</span>
      <span className={`inline-flex items-center px-2 py-0.5 rounded font-caption font-caption-medium text-[11px] ${tier.color}`}>
        {tier.label}
      </span>
    </div>
  );
}

const QUICK_FILTERS = [
  { label: 'Last 7 Days', days: 7 },
  { label: 'Last 30 Days', days: 30 },
  { label: 'This Month', days: 'month' },
];

function getDateRange(filter) {
  const today = new Date();
  const endDate = today.toISOString().split('T')[0];

  if (filter === 'month') {
    const startDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    return { fromDate: startDate, toDate: endDate };
  }

  const startDate = new Date(today.getTime() - filter * 86400000).toISOString().split('T')[0];
  return { fromDate: startDate, toDate: endDate };
}

const TherapistPerformancePanel = ({ branchId }) => {
  const today = new Date().toISOString().split('T')[0];

  const [activeFilter, setActiveFilter] = useState(30);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);

    let range;
    if (activeFilter === 'custom') {
      range = { fromDate: customFrom, toDate: customTo || today };
    } else {
      range = getDateRange(activeFilter);
    }

    const result = await getTherapistPerformance({ branchId, ...range });

    if (result.error) {
      setError(result.error.message || 'Failed to load performance data.');
      setLoading(false);
      return;
    }

    setData(result.data);
    setLoading(false);
  }, [branchId, activeFilter, customFrom, customTo, today]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleQuickFilter = (days) => {
    setActiveFilter(days);
  };

  const handleCustomApply = () => {
    if (customFrom) {
      setActiveFilter('custom');
    }
  };

  // ── Loading ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="bg-surface rounded-spa-lg border border-border p-6 animate-pulse">
          <div className="h-5 bg-background rounded w-48 mb-4" />
          <div className="space-y-3">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-12 bg-background rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────
  if (error) {
    return (
      <div className="bg-error/5 border border-error/20 rounded-spa p-4 flex items-center space-x-3">
        <Icon name="AlertCircle" size={18} className="text-error flex-shrink-0" />
        <p className="font-body text-sm text-error">{error}</p>
        <button onClick={loadData} className="ml-auto font-body font-body-medium text-sm text-error underline">
          Retry
        </button>
      </div>
    );
  }

  const therapists = data?.therapists || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-heading font-heading-semibold text-xl text-text-primary">Therapist Performance Index</h2>
        <p className="font-body text-sm text-text-secondary">
          Ranked by weighted performance score.
          {data && ` Period: ${data.periodStart} to ${data.periodEnd}`}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center space-x-2">
          {QUICK_FILTERS.map(f => (
            <button
              key={f.days}
              onClick={() => handleQuickFilter(f.days)}
              className={`px-3 py-1.5 rounded-spa font-body font-body-medium text-sm spa-transition-fast ${
                activeFilter === f.days
                  ? 'bg-primary text-white'
                  : 'bg-background text-text-secondary hover:bg-border/50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center space-x-2">
          <input
            type="date"
            value={customFrom}
            max={today}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="px-2 py-1.5 rounded-spa border border-border bg-surface font-body text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <span className="font-body text-xs text-text-tertiary">to</span>
          <input
            type="date"
            value={customTo}
            max={today}
            onChange={(e) => setCustomTo(e.target.value)}
            className="px-2 py-1.5 rounded-spa border border-border bg-surface font-body text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            onClick={handleCustomApply}
            disabled={!customFrom}
            className="px-3 py-1.5 rounded-spa font-body font-body-medium text-sm bg-background text-text-secondary hover:bg-border/50 disabled:opacity-50 disabled:cursor-not-allowed spa-transition-fast"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Tier Legend */}
      <div className="flex flex-wrap items-center gap-3">
        {[
          { label: 'Top Performer (85+)', color: 'bg-success' },
          { label: 'Strong (70–84)', color: 'bg-primary' },
          { label: 'Average (55–69)', color: 'bg-warning' },
          { label: 'Needs Attention (<55)', color: 'bg-error' },
        ].map(t => (
          <div key={t.label} className="flex items-center space-x-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${t.color}`} />
            <span className="font-caption font-caption-normal text-[11px] text-text-tertiary">{t.label}</span>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-surface rounded-spa-lg border border-border overflow-hidden">
        {therapists.length === 0 ? (
          <div className="p-12 text-center">
            <Icon name="Users" size={40} className="text-text-tertiary mx-auto mb-3" />
            <h3 className="font-body font-body-medium text-sm text-text-primary mb-1">No Performance Data</h3>
            <p className="font-body text-xs text-text-tertiary">No active therapists or bookings found for this period.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="bg-background/50 border-b border-border">
                  <th className="px-4 py-3 text-left font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide w-12">#</th>
                  <th className="px-4 py-3 text-left font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Therapist</th>
                  <th className="px-4 py-3 text-left font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Score</th>
                  <th className="px-4 py-3 text-right font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Revenue</th>
                  <th className="px-4 py-3 text-center font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Completed</th>
                  <th className="px-4 py-3 text-center font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Completion</th>
                  <th className="px-4 py-3 text-center font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Attendance</th>
                  <th className="px-4 py-3 text-center font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Utilization</th>
                  <th className="px-4 py-3 text-right font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Avg/Booking</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {therapists.map((t, idx) => {
                  const tier = getTier(t.performanceScore);
                  const rank = idx + 1;
                  return (
                    <tr key={t.therapistId} className="hover:bg-background/30 spa-transition-fast">
                      {/* Rank */}
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full font-data font-data-medium text-xs ${
                          rank <= 3 ? 'bg-accent/10 text-accent' : 'bg-background text-text-tertiary'
                        }`}>
                          {rank}
                        </span>
                      </td>

                      {/* Therapist */}
                      <td className="px-4 py-3">
                        <div className="flex items-center space-x-2">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <Icon name="User" size={14} className="text-primary" />
                          </div>
                          <span className="font-body font-body-medium text-sm text-text-primary">{t.therapistName}</span>
                        </div>
                      </td>

                      {/* Score */}
                      <td className="px-4 py-3">
                        <ScoreBadge score={t.performanceScore} />
                      </td>

                      {/* Revenue */}
                      <td className="px-4 py-3 text-right">
                        <span className="font-data font-data-normal text-sm text-text-primary">
                          NPR {t.paidRevenue.toLocaleString('en-IN')}
                        </span>
                      </td>

                      {/* Completed */}
                      <td className="px-4 py-3 text-center">
                        <span className="font-data font-data-normal text-sm text-text-primary">
                          {t.completedBookings}
                          <span className="text-text-tertiary text-xs"> / {t.totalAssigned}</span>
                        </span>
                      </td>

                      {/* Completion Rate */}
                      <td className="px-4 py-3 text-center">
                        <span className={`font-data font-data-normal text-sm ${
                          t.completionRate >= 80 ? 'text-success' : t.completionRate >= 60 ? 'text-warning' : 'text-error'
                        }`}>
                          {t.completionRate}%
                        </span>
                      </td>

                      {/* Attendance */}
                      <td className="px-4 py-3 text-center">
                        <span className={`font-data font-data-normal text-sm ${
                          t.attendanceRate >= 80 ? 'text-success' : t.attendanceRate >= 60 ? 'text-warning' : 'text-error'
                        }`}>
                          {t.attendanceRate}%
                        </span>
                      </td>

                      {/* Utilization */}
                      <td className="px-4 py-3 text-center">
                        <span className={`font-data font-data-normal text-sm ${
                          t.utilizationRate >= 70 ? 'text-success' : t.utilizationRate >= 40 ? 'text-warning' : 'text-error'
                        }`}>
                          {t.utilizationRate}%
                        </span>
                      </td>

                      {/* Avg Revenue Per Booking */}
                      <td className="px-4 py-3 text-right">
                        <span className="font-data font-data-normal text-sm text-text-primary">
                          NPR {t.avgRevenuePerBooking.toLocaleString('en-IN')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default TherapistPerformancePanel;
