import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import { getTherapistServiceBreakdown } from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

const ServicesTab = ({ therapistId, branchId, range }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    if (!branchId || !therapistId) return;
    setLoading(true);
    setError(null);

    const result = await getTherapistServiceBreakdown({ branchId, therapistId, ...range });

    if (result.error) {
      setError(result.error.message || 'Failed to load service breakdown.');
      setLoading(false);
      return;
    }

    setData(result.data);
    setLoading(false);
  }, [branchId, therapistId, range]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="bg-surface rounded-spa-lg border border-border p-6 space-y-3 animate-pulse">
        {[0, 1, 2].map(i => <div key={i} className="h-10 bg-background rounded" />)}
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

  const services = data?.services || [];

  if (services.length === 0) {
    return (
      <div className="p-12 text-center bg-surface rounded-spa-lg border border-border">
        <Icon name="Sparkles" size={32} className="text-text-tertiary mx-auto mb-3" />
        <p className="font-body text-sm text-text-tertiary">No completed services for this period.</p>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-spa-lg border border-border overflow-hidden">
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr className="bg-background/50 border-b border-border">
              <th className="px-4 py-3 text-left font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Service</th>
              <th className="px-4 py-3 text-center font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Completed</th>
              <th className="px-4 py-3 text-center font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Cancelled</th>
              <th className="px-4 py-3 text-center font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Missed</th>
              <th className="px-4 py-3 text-center font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Avg Duration</th>
              <th className="px-4 py-3 text-right font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {services.map((s) => (
              <tr key={s.serviceName} className="hover:bg-background/30 spa-transition-fast">
                <td className="px-4 py-3">
                  <span className="font-body font-body-medium text-sm text-text-primary truncate block max-w-[220px]">{s.serviceName}</span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="font-data font-data-normal text-sm text-success">{s.completed}</span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="font-data font-data-normal text-sm text-error">{s.cancelled}</span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="font-data font-data-normal text-sm text-text-secondary">{s.missed}</span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="font-data font-data-normal text-sm text-text-secondary">{s.avgDurationMinutes ? `${s.avgDurationMinutes} min` : '—'}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-data font-data-normal text-sm text-text-primary">{formatNPR(s.revenue)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card stack */}
      <div className="md:hidden divide-y divide-border">
        {services.map((s) => (
          <div key={s.serviceName} className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-body font-body-medium text-sm text-text-primary truncate min-w-0">{s.serviceName}</span>
              <span className="font-data font-data-normal text-sm text-text-primary flex-shrink-0">{formatNPR(s.revenue)}</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-text-tertiary">
              <span className="text-success">{s.completed} completed</span>
              <span className="text-error">{s.cancelled} cancelled</span>
              <span>{s.missed} missed</span>
              <span>{s.avgDurationMinutes ? `${s.avgDurationMinutes} min avg` : '—'}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ServicesTab;
