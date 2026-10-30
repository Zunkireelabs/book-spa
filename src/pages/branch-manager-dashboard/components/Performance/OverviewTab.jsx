import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import { getTherapistOverview } from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function StatCard({ icon, iconBg, iconColor, label, value, highlight, sub, small }) {
  return (
    <div className="bg-surface rounded-spa-lg border border-border p-4 flex items-center space-x-3">
      <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center flex-shrink-0`}>
        <Icon name={icon} size={18} className={iconColor} />
      </div>
      <div className="min-w-0">
        <p className={`font-heading font-heading-semibold ${small ? 'text-sm leading-tight' : 'text-lg truncate'} ${highlight || 'text-text-primary'}`}>
          {value}
        </p>
        <p className="font-caption font-caption-normal text-[11px] text-text-tertiary">{label}</p>
        {sub && <p className="font-caption text-[10.5px] text-text-tertiary truncate">{sub}</p>}
      </div>
    </div>
  );
}

const pctOf = (v) => (v == null ? '—' : `${Math.round(Number(v) * 100)}%`);
const hrs = (min) => `${Math.round(Number(min) / 60).toLocaleString('en-IN')} h`;
const KV = ({ k, children }) => <div className="flex justify-between gap-3 text-[12.5px] py-0.5"><span className="text-text-secondary">{k}</span><b className="font-data tabular-nums font-medium text-right">{children}</b></div>;

// The report row for this person and period (score, its four parts, busy, rebook, no-show, top services), shown first so the
// numbers here are the ones the Performance report listed. reportRow comes from the report; absent when opened from the old table.
const ReportSummary = ({ r }) => (
  <div className="bg-surface rounded-spa-lg border border-border p-4 grid gap-x-8 gap-y-3 md:grid-cols-2">
    <div>
      <KV k="Score"><span>{r.score} · {r.tier.label}</span></KV>
      <div className="text-[11px] text-text-tertiary pb-1.5">{r.formula}</div>
      <KV k="Busy">{r.busy == null ? 'No hours set' : `${pctOf(r.busy)} · ${hrs(r.booked_min)} of ${hrs(r.working_min)}`}</KV>
      <KV k="Rebook">{r.rebook_rate == null ? `— · ${r.customers} customer${r.customers === 1 ? '' : 's'} (needs 5)` : `${pctOf(r.rebook_rate)} · ${r.rebooked} of ${r.customers} customers`}</KV>
      <KV k="No-show">{r.bookings > 0 ? `${Math.round(r.no_show / r.bookings * 1000) / 10}% · ${r.no_show} of ${r.bookings}` : '—'}</KV>
    </div>
    {r.top_services?.length > 0 && (
      <div>
        <h4 className="text-[11px] text-text-tertiary font-medium uppercase tracking-wide mb-1.5">Top services</h4>
        {r.top_services.map((sv) => <KV key={sv.name} k={sv.name}>{sv.n}</KV>)}
      </div>
    )}
  </div>
);

const OverviewTab = ({ therapistId, branchId, range, reportRow = null, onNeedsClosing = null }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    if (!branchId || !therapistId) return;
    setLoading(true);
    setError(null);

    const result = await getTherapistOverview({ branchId, therapistId, ...range });

    if (result.error) {
      setError(result.error.message || 'Failed to load overview.');
      setLoading(false);
      return;
    }

    setData(result.data);
    setLoading(false);
  }, [branchId, therapistId, range]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
          <div key={i} className="h-20 bg-background rounded-spa-lg animate-pulse" />
        ))}
      </div>
    );
  }

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

  if (!data || (data.totalAssigned === 0 && data.servicesCompleted === 0)) {
    return (
      <div className="p-12 text-center bg-surface rounded-spa-lg border border-border">
        <Icon name="LayoutGrid" size={32} className="text-text-tertiary mx-auto mb-3" />
        <p className="font-body text-sm text-text-tertiary">No data for this period.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {reportRow && <ReportSummary r={reportRow} />}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon="Sparkles" iconBg="bg-primary/10" iconColor="text-primary" label="Services completed" value={data.servicesCompleted} />
        <StatCard icon="Users" iconBg="bg-success/10" iconColor="text-success" label="Customers attended" value={data.customersAttended} />
        <StatCard icon="UserCheck" iconBg="bg-accent/10" iconColor="text-accent" label="Customers assigned" value={data.customersAssigned} />
        <StatCard icon="Wallet" iconBg="bg-success/10" iconColor="text-success" label="Service sales" value={formatNPR(data.serviceSales)} sub={`paid ${Number(data.paidRevenue).toLocaleString('en-IN')} · owed ${Number(data.owed).toLocaleString('en-IN')}`} />
        <StatCard icon="Clock" iconBg="bg-primary/10" iconColor="text-primary" label="Worked time" value={data.workedHours == null ? 'No attendance recorded' : `${data.workedHours}h`} small={data.workedHours == null} />
        <StatCard icon="CalendarCheck" iconBg="bg-primary/10" iconColor="text-primary" label="Occupied time" value={`${data.occupiedHours}h`} />
        <StatCard
          icon="Percent"
          iconBg="bg-warning/10"
          iconColor="text-warning"
          label="Busy while clocked in"
          value={data.utilizationRate == null ? '—' : `${data.utilizationRate}%`}
          highlight={data.utilizationRate != null && data.utilizationRate < 40 ? 'text-warning' : 'text-text-primary'}
        />
        <StatCard icon="Timer" iconBg="bg-background" iconColor="text-text-secondary" label="Avg service duration" value={`${data.avgServiceDurationMinutes} min`} />
      </div>

      {/* Assigned bookings by how they ended; the counts add up to the bookings in the period. Nothing here is red: Not closed yet is a to-do. */}
      <div className="bg-background rounded-spa p-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-body">
        <span className="text-text-secondary">Completed: <span className="font-body-medium text-success">{data.statusSplit.completed}</span></span>
        <span className="text-text-secondary">No-show: <span className="font-body-medium text-text-primary">{data.statusSplit.noShow}</span></span>
        <span className="text-text-secondary">Cancelled: <span className="font-body-medium text-text-primary">{data.statusSplit.cancelled}</span></span>
        <span className="text-text-secondary">Not closed yet: <span className="font-body-medium text-text-secondary">{data.statusSplit.notClosed}</span>
          {data.statusSplit.notClosed > 0 && onNeedsClosing && <button type="button" onClick={onNeedsClosing} className="ml-1.5 text-primary hover:underline text-xs">Needs closing</button>}
        </span>
      </div>
    </div>
  );
};

export default OverviewTab;
