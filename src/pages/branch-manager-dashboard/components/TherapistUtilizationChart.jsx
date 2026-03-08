import React, { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import Icon from '../../../components/AppIcon';
import { getUtilizationIntelligence } from '../../../services/api';

const TherapistUtilizationChart = ({ branchId }) => {
  const [utilizationData, setUtilizationData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);

    const result = await getUtilizationIntelligence({ branchId });

    if (result.error) {
      setError(result.error.message || 'Failed to load utilization data.');
      setLoading(false);
      return;
    }

    const { therapistUtilization } = result.data;
    const chartData = therapistUtilization.map(t => ({
      name: t.name,
      utilization: t.percent,
      bookedMinutes: t.bookedMinutes,
      totalMinutes: t.totalMinutes,
    }));
    setUtilizationData(chartData);
    setLoading(false);
  }, [branchId]);

  useEffect(() => { loadData(); }, [loadData]);

  const getBarColor = (utilization) => {
    if (utilization >= 90) return '#DC2626'; // error
    if (utilization >= 80) return '#D97706'; // warning
    return '#059669'; // success
  };

  const optimalCount = utilizationData.filter(d => d.utilization < 80).length;
  const highLoadCount = utilizationData.filter(d => d.utilization >= 80 && d.utilization < 90).length;
  const overloadedCount = utilizationData.filter(d => d.utilization >= 90).length;

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-surface border border-border rounded-spa p-3 spa-shadow-elevated">
          <p className="font-body font-body-medium text-sm text-text-primary mb-1">{label}</p>
          <p className="font-body font-body-normal text-sm text-text-secondary">
            Utilization: {data.utilization}%
          </p>
          <p className="font-body font-body-normal text-sm text-text-secondary">
            Booked: {data.bookedMinutes}m / {data.totalMinutes}m
          </p>
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 border border-border">
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center">
            <Icon name="Users" size={20} className="text-accent" />
          </div>
          <div>
            <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
              Therapist Utilization
            </h3>
            <p className="font-body font-body-normal text-sm text-text-secondary">
              Loading...
            </p>
          </div>
        </div>
        <div className="h-64 flex items-center justify-center">
          <div className="animate-pulse space-y-3 w-full">
            <div className="h-4 bg-background rounded w-full" />
            <div className="h-4 bg-background rounded w-3/4" />
            <div className="h-4 bg-background rounded w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 border border-border">
        <div className="flex items-center space-x-3 mb-4">
          <Icon name="AlertCircle" size={18} className="text-error" />
          <p className="font-body text-sm text-error">{error}</p>
        </div>
        <button onClick={loadData} className="font-body font-body-medium text-sm text-error underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 border border-border">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center">
            <Icon name="Users" size={20} className="text-accent" />
          </div>
          <div>
            <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
              Therapist Utilization
            </h3>
            <p className="font-body font-body-normal text-sm text-text-secondary">
              Today's workload distribution
            </p>
          </div>
        </div>
        <button className="p-2 rounded-spa hover:bg-background spa-transition-fast">
          <Icon name="MoreVertical" size={16} className="text-text-secondary" />
        </button>
      </div>

      {utilizationData.length === 0 ? (
        <div className="h-64 flex items-center justify-center">
          <p className="font-body text-sm text-text-tertiary">No therapist data available</p>
        </div>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={utilizationData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis
                tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
                domain={[0, 100]}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="utilization" radius={[4, 4, 0, 0]}>
                {utilizationData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={getBarColor(entry.utilization)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-4 text-center">
        <div className="p-3 bg-success/10 rounded-spa">
          <div className="font-heading font-heading-semibold text-lg text-success">{optimalCount}</div>
          <div className="font-caption font-caption-normal text-xs text-text-secondary">Optimal</div>
        </div>
        <div className="p-3 bg-warning/10 rounded-spa">
          <div className="font-heading font-heading-semibold text-lg text-warning">{highLoadCount}</div>
          <div className="font-caption font-caption-normal text-xs text-text-secondary">High Load</div>
        </div>
        <div className="p-3 bg-error/10 rounded-spa">
          <div className="font-heading font-heading-semibold text-lg text-error">{overloadedCount}</div>
          <div className="font-caption font-caption-normal text-xs text-text-secondary">Overloaded</div>
        </div>
      </div>
    </div>
  );
};

export default TherapistUtilizationChart;
