import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Icon from '../../../../components/AppIcon';
import FilterBar from '../../../../components/ui/FilterBar';
import { PERIOD_PRESETS, getPeriodRange, getTodayISO } from '../../../../utils/periodPresets';
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

const TherapistPerformancePanel = ({ branchId }) => {
  const today = getTodayISO();

  const [activePreset, setActivePreset] = useState('monthly');
  const [mode, setMode] = useState('preset'); // 'preset' | 'custom'
  const [customFrom, setCustomFrom] = useState('');   // live input value
  const [customTo, setCustomTo] = useState('');       // live input value
  const [appliedFrom, setAppliedFrom] = useState(''); // committed on Apply
  const [appliedTo, setAppliedTo] = useState('');     // committed on Apply
  const [searchQuery, setSearchQuery] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Range is driven by APPLIED dates so editing the pickers doesn't re-fetch
  // until the user clicks Apply.
  const range = useMemo(() => {
    if (mode === 'custom' && appliedFrom) {
      return { fromDate: appliedFrom, toDate: appliedTo || today };
    }
    const { startDate, endDate } = getPeriodRange(activePreset);
    return { fromDate: startDate, toDate: endDate };
  }, [mode, activePreset, appliedFrom, appliedTo, today]);

  // True when the inputs differ from what's currently applied (pending Apply).
  const customDirty = customFrom && (customFrom !== appliedFrom || customTo !== appliedTo);

  const loadData = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);

    const result = await getTherapistPerformance({ branchId, ...range });

    if (result.error) {
      setError(result.error.message || 'Failed to load performance data.');
      setLoading(false);
      return;
    }

    setData(result.data);
    setLoading(false);
  }, [branchId, range]);

  useEffect(() => { loadData(); }, [loadData]);

  const handlePreset = (id) => {
    setMode('preset');
    setActivePreset(id);
  };

  const handleCustomApply = () => {
    if (!customFrom) return;
    setAppliedFrom(customFrom);
    setAppliedTo(customTo);
    setMode('custom');
  };

  const visibleTherapists = useMemo(() => {
    const all = data?.therapists || [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter((t) => (t.therapistName || '').toLowerCase().includes(q));
  }, [data, searchQuery]);

  const handleExportCSV = () => {
    const rows = visibleTherapists;
    if (!rows.length) return;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Rank', 'Therapist', 'Score', 'Tier', 'Revenue', 'Completed', 'Total Assigned', 'Completion %', 'Attendance %', 'Utilization %', 'Avg/Booking'];
    let csv = header.join(',') + '\n';
    rows.forEach((t, idx) => {
      csv += [
        idx + 1,
        esc(t.therapistName),
        t.performanceScore,
        esc(getTier(t.performanceScore).label),
        t.paidRevenue,
        t.completedBookings,
        t.totalAssigned,
        t.completionRate,
        t.attendanceRate,
        t.utilizationRate,
        t.avgRevenuePerBooking,
      ].join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `performance-report-${data?.periodStart || ''}-to-${data?.periodEnd || ''}.csv`;
    link.click();
    URL.revokeObjectURL(url);
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

  const therapists = visibleTherapists;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading font-heading-semibold text-xl text-text-primary">Therapist Performance Index</h2>
          <p className="font-body text-sm text-text-secondary">
            Ranked by weighted performance score.
            {data && ` Period: ${data.periodStart} to ${data.periodEnd}`}
          </p>
        </div>
        {therapists.length > 0 && (
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-spa border border-border bg-surface font-body font-body-medium text-sm text-text-secondary hover:bg-background spa-transition-fast flex-shrink-0"
          >
            <Icon name="Download" size={16} />
            <span>Export CSV</span>
          </button>
        )}
      </div>

      {/* Filters */}
      <FilterBar
        count={{ value: therapists.length, label: therapists.length === 1 ? 'Therapist' : 'Therapists' }}
        search={{ value: searchQuery, onChange: setSearchQuery, placeholder: 'Search therapist by name…' }}
        presets={PERIOD_PRESETS.map((p) => ({
          label: p.label,
          active: mode === 'preset' && activePreset === p.id,
          onClick: () => handlePreset(p.id),
        }))}
        dateRange={{
          from: customFrom,
          onFromChange: setCustomFrom,
          to: customTo,
          onToChange: setCustomTo,
          max: today,
          onApply: handleCustomApply,
          applyDisabled: !customFrom || !customDirty,
          applyActive: mode === 'custom',
        }}
      />

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
          <div className={`overflow-x-auto ${therapists.length > 10 ? 'max-h-[640px] overflow-y-auto' : ''}`}>
            <table className="w-full min-w-[800px]">
              <thead className="sticky top-0 z-sticky-filter">
                <tr className="bg-background border-b border-border">
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
