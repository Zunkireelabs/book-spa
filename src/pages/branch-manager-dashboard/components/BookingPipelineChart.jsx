import React from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import Icon from '../../../components/AppIcon';

const BookingPipelineChart = () => {
  const pipelineData = [
    { time: '09:00', inquiries: 15, bookings: 12, conversions: 80 },
    { time: '10:00', inquiries: 22, bookings: 18, conversions: 82 },
    { time: '11:00', inquiries: 28, bookings: 24, conversions: 86 },
    { time: '12:00', inquiries: 35, bookings: 28, conversions: 80 },
    { time: '13:00', inquiries: 42, bookings: 32, conversions: 76 },
    { time: '14:00', inquiries: 38, bookings: 30, conversions: 79 },
    { time: '15:00', inquiries: 45, bookings: 38, conversions: 84 },
    { time: '16:00', inquiries: 52, bookings: 42, conversions: 81 }
  ];

  const conversionStats = [
    { label: 'Conversion Rate', value: '81.2%', change: '+2.4%', positive: true },
    { label: 'Avg. Response Time', value: '3.2 min', change: '-0.8 min', positive: true },
    { label: 'Abandonment Rate', value: '18.8%', change: '-1.2%', positive: true }
  ];

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-surface border border-border rounded-spa p-3 spa-shadow-elevated">
          <p className="font-body font-body-medium text-sm text-text-primary mb-2">{label}</p>
          {payload.map((entry, index) => (
            <p key={index} className="font-body font-body-normal text-sm" style={{ color: entry.color }}>
              {entry.name}: {entry.value}
              {entry.dataKey === 'conversions' && '%'}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

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
              Conversion analytics for today
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button className="px-3 py-1 bg-primary/10 text-primary rounded text-xs font-body font-body-medium">
            Today
          </button>
          <button className="px-3 py-1 text-text-secondary rounded text-xs font-body font-body-medium hover:bg-background">
            Week
          </button>
        </div>
      </div>

      <div className="h-48 w-full mb-6">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={pipelineData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="inquiriesGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="bookingsGradient" x1="0" y1="0" x2="0" y2="1">
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
              dataKey="inquiries"
              stroke="var(--color-primary)"
              fillOpacity={1}
              fill="url(#inquiriesGradient)"
              name="Inquiries"
            />
            <Area
              type="monotone"
              dataKey="bookings"
              stroke="var(--color-success)"
              fillOpacity={1}
              fill="url(#bookingsGradient)"
              name="Bookings"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {conversionStats.map((stat, index) => (
          <div key={index} className="text-center p-3 bg-background rounded-spa">
            <div className="font-heading font-heading-semibold text-lg text-text-primary">
              {stat.value}
            </div>
            <div className="font-caption font-caption-normal text-xs text-text-secondary mb-1">
              {stat.label}
            </div>
            <div className={`flex items-center justify-center space-x-1 ${
              stat.positive ? 'text-success' : 'text-error'
            }`}>
              <Icon name={stat.positive ? 'ArrowUp' : 'ArrowDown'} size={12} />
              <span className="font-caption font-caption-normal text-xs">{stat.change}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BookingPipelineChart;