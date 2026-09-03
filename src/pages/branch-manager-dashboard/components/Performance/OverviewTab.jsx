import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import { getTherapistOverview } from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function StatCard({ icon, iconBg, iconColor, label, value, highlight }) {
  return (
    <div className="bg-surface rounded-spa-lg border border-border p-4 flex items-center space-x-3">
      <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center flex-shrink-0`}>
        <Icon name={icon} size={18} className={iconColor} />
      </div>
      <div className="min-w-0">
        <p className={`font-heading font-heading-semibold text-lg truncate ${highlight || 'text-text-primary'}`}>
          {value}
        </p>
        <p className="font-caption font-caption-normal text-[11px] text-text-tertiary">{label}</p>
      </div>
    </div>
  );
}

const OverviewTab = ({ therapistId, branchId, range }) => {
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon="Sparkles" iconBg="bg-primary/10" iconColor="text-primary" label="Services completed" value={data.servicesCompleted} />
        <StatCard icon="Users" iconBg="bg-success/10" iconColor="text-success" label="Customers attended" value={data.customersAttended} />
        <StatCard icon="UserCheck" iconBg="bg-accent/10" iconColor="text-accent" label="Customers assigned" value={data.customersAssigned} />
        <StatCard icon="Wallet" iconBg="bg-success/10" iconColor="text-success" label="Revenue" value={formatNPR(data.paidRevenue)} />
        <StatCard icon="Clock" iconBg="bg-primary/10" iconColor="text-primary" label="Worked time" value={`${data.workedHours}h`} />
        <StatCard icon="CalendarCheck" iconBg="bg-primary/10" iconColor="text-primary" label="Occupied time" value={`${data.occupiedHours}h`} />
        <StatCard
          icon="Percent"
          iconBg="bg-warning/10"
          iconColor="text-warning"
          label="Utilization"
          value={`${data.utilizationRate}%`}
          highlight={data.utilizationRate >= 70 ? 'text-success' : data.utilizationRate >= 40 ? 'text-warning' : 'text-error'}
        />
        <StatCard icon="Timer" iconBg="bg-background" iconColor="text-text-secondary" label="Avg service duration" value={`${data.avgServiceDurationMinutes} min`} />
      </div>

      {/* Assigned vs attended breakdown, per spec's "Assigned: 29 · Attended: 26 · Not attended: 3" */}
      <div className="bg-background rounded-spa p-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-body">
        <span className="text-text-secondary">Assigned: <span className="font-body-medium text-text-primary">{data.customersAssigned}</span></span>
        <span className="text-text-secondary">Attended: <span className="font-body-medium text-success">{data.customersAttended}</span></span>
        <span className="text-text-secondary">Not attended: <span className="font-body-medium text-error">{data.notAttended}</span></span>
      </div>
    </div>
  );
};

export default OverviewTab;
