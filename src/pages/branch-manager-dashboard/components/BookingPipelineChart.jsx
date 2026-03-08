import React, { useState, useEffect, useCallback } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import Icon from '../../../components/AppIcon';
import { fetchBookings } from '../../../services/api';
import { transformBookings } from '../../../services/bookingTransformers';

const BookingPipelineChart = ({ branchId }) => {
  const [pipelineData, setPipelineData] = useState([]);
  const [stats, setStats] = useState({ total: 0, completed: 0, completionRate: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);

    const today = new Date().toISOString().split('T')[0];
    const result = await fetchBookings(branchId, { date: today });

    if (result.error) {
      setError(result.error.message || 'Failed to load booking data.');
      setLoading(false);
      return;
    }

    const bookings = transformBookings(result.data || []);
    const totalCount = bookings.length;
    const completedCount = bookings.filter(b => b.status === 'completed').length;
    const rate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100 * 10) / 10 : 0;

    setStats({ total: totalCount, completed: completedCount, completionRate: rate });

    // Group bookings by hour
    const hourlyMap = {};
    for (const b of bookings) {
      if (!b.time) continue;
      const hour = b.time.slice(0, 2);
      const hourLabel = `${hour}:00`;
      if (!hourlyMap[hourLabel]) {
        hourlyMap[hourLabel] = { total: 0, completed: 0 };
      }
      hourlyMap[hourLabel].total += 1;
      if (b.status === 'completed') {
        hourlyMap[hourLabel].completed += 1;
      }
    }

    // Build cumulative data sorted by hour
    const hours = Object.keys(hourlyMap).sort();
    let cumulativeTotal = 0;
    let cumulativeCompleted = 0;
    const chartData = hours.map(time => {
      cumulativeTotal += hourlyMap[time].total;
      cumulativeCompleted += hourlyMap[time].completed;
      return {
        time,
        bookings: cumulativeTotal,
        completed: cumulativeCompleted,
      };
    });

    setPipelineData(chartData);
    setLoading(false);
  }, [branchId]);

  useEffect(() => { loadData(); }, [loadData]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-surface border border-border rounded-spa p-3 spa-shadow-elevated">
          <p className="font-body font-body-medium text-sm text-text-primary mb-2">{label}</p>
          {payload.map((entry, index) => (
            <p key={index} className="font-body font-body-normal text-sm" style={{ color: entry.color }}>
              {entry.name}: {entry.value}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 border border-border">
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-10 h-10 bg-secondary/10 rounded-lg flex items-center justify-center">
            <Icon name="TrendingUp" size={20} className="text-secondary" />
          </div>
          <div>
            <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
              Booking Pipeline
            </h3>
            <p className="font-body font-body-normal text-sm text-text-secondary">
              Loading...
            </p>
          </div>
        </div>
        <div className="h-48 flex items-center justify-center">
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

  const conversionStats = [
    { label: 'Total Bookings', value: String(stats.total), icon: 'Calendar' },
    { label: 'Completed', value: String(stats.completed), icon: 'CheckCircle' },
    { label: 'Completion Rate', value: `${stats.completionRate}%`, icon: 'TrendingUp' },
  ];

  return (
    <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 border border-border">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-secondary/10 rounded-lg flex items-center justify-center">
            <Icon name="TrendingUp" size={20} className="text-secondary" />
          </div>
          <div>
            <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
              Booking Pipeline
            </h3>
            <p className="font-body font-body-normal text-sm text-text-secondary">
              Cumulative bookings for today
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button className="px-3 py-1 bg-primary/10 text-primary rounded text-xs font-body font-body-medium">
            Today
          </button>
        </div>
      </div>

      {pipelineData.length === 0 ? (
        <div className="h-48 flex items-center justify-center mb-6">
          <p className="font-body text-sm text-text-tertiary">No bookings yet today</p>
        </div>
      ) : (
        <div className="h-48 w-full mb-6">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={pipelineData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="bookingsTotalGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="bookingsCompletedGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-success)" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="var(--color-success)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
              />
              <YAxis
                tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="bookings"
                stroke="var(--color-primary)"
                fillOpacity={1}
                fill="url(#bookingsTotalGradient)"
                name="Total Bookings"
              />
              <Area
                type="monotone"
                dataKey="completed"
                stroke="var(--color-success)"
                fillOpacity={1}
                fill="url(#bookingsCompletedGradient)"
                name="Completed"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {conversionStats.map((stat, index) => (
          <div key={index} className="text-center p-3 bg-background rounded-spa">
            <div className="font-heading font-heading-semibold text-lg text-text-primary">
              {stat.value}
            </div>
            <div className="font-caption font-caption-normal text-xs text-text-secondary mb-1">
              {stat.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BookingPipelineChart;
