import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import Icon from '../../../components/AppIcon';

const TherapistUtilizationChart = () => {
  const utilizationData = [
    { name: 'Emma Wilson', utilization: 85, bookings: 12, available: true },
    { name: 'Michael Chen', utilization: 92, bookings: 14, available: false },
    { name: 'Lisa Rodriguez', utilization: 78, bookings: 10, available: true },
    { name: 'David Kim', utilization: 88, bookings: 13, available: true },
    { name: 'Sarah Thompson', utilization: 65, bookings: 8, available: true }
  ];

  const getBarColor = (utilization) => {
    if (utilization >= 90) return '#DC2626'; // error
    if (utilization >= 80) return '#D97706'; // warning
    return '#059669'; // success
  };

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
            Bookings: {data.bookings}
          </p>
          <div className="flex items-center space-x-1 mt-1">
            <div className={`w-2 h-2 rounded-full ${data.available ? 'bg-success' : 'bg-error'}`}></div>
            <span className="font-caption font-caption-normal text-xs text-text-secondary">
              {data.available ? 'Available' : 'Busy'}
            </span>
          </div>
        </div>
      );
    }
    return null;
  };

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

      <div className="mt-4 grid grid-cols-3 gap-4 text-center">
        <div className="p-3 bg-success/10 rounded-spa">
          <div className="font-heading font-heading-semibold text-lg text-success">3</div>
          <div className="font-caption font-caption-normal text-xs text-text-secondary">Optimal</div>
        </div>
        <div className="p-3 bg-warning/10 rounded-spa">
          <div className="font-heading font-heading-semibold text-lg text-warning">1</div>
          <div className="font-caption font-caption-normal text-xs text-text-secondary">High Load</div>
        </div>
        <div className="p-3 bg-error/10 rounded-spa">
          <div className="font-heading font-heading-semibold text-lg text-error">1</div>
          <div className="font-caption font-caption-normal text-xs text-text-secondary">Overloaded</div>
        </div>
      </div>
    </div>
  );
};

export default TherapistUtilizationChart;