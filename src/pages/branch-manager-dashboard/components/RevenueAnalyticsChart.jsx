import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from 'recharts';
import Icon from '../../../components/AppIcon';

const RevenueAnalyticsChart = () => {
  const [activeTab, setActiveTab] = useState('revenue');

  const revenueData = [
    { time: '09:00', revenue: 2400, bookings: 3 },
    { time: '10:00', revenue: 4200, bookings: 5 },
    { time: '11:00', revenue: 6800, bookings: 8 },
    { time: '12:00', revenue: 9200, bookings: 11 },
    { time: '13:00', revenue: 12600, bookings: 15 },
    { time: '14:00', revenue: 15800, bookings: 19 },
    { time: '15:00', revenue: 19400, bookings: 23 },
    { time: '16:00', revenue: 22800, bookings: 27 }
  ];

  const servicePopularityData = [
    { name: 'Deep Tissue Massage', value: 35, revenue: 63000, color: '#2D5A27' },
    { name: 'Hot Stone Therapy', value: 25, revenue: 55000, color: '#8B4513' },
    { name: 'Aromatherapy', value: 20, revenue: 40000, color: '#DAA520' },
    { name: 'Swedish Massage', value: 15, revenue: 24000, color: '#059669' },
    { name: 'Reflexology', value: 5, revenue: 7000, color: '#D97706' }
  ];

  const peakHoursData = [
    { hour: '09:00', bookings: 3, efficiency: 60 },
    { hour: '10:00', bookings: 5, efficiency: 75 },
    { hour: '11:00', bookings: 8, efficiency: 85 },
    { hour: '12:00', bookings: 11, efficiency: 90 },
    { hour: '13:00', bookings: 15, efficiency: 95 },
    { hour: '14:00', bookings: 19, efficiency: 100 },
    { hour: '15:00', bookings: 23, efficiency: 95 },
    { hour: '16:00', bookings: 27, efficiency: 90 },
    { hour: '17:00', bookings: 22, efficiency: 85 }
  ];

  const customerRetentionData = [
    { month: 'Jan', newCustomers: 45, returningCustomers: 78, retention: 63 },
    { month: 'Feb', newCustomers: 52, returningCustomers: 89, retention: 68 },
    { month: 'Mar', newCustomers: 48, returningCustomers: 95, retention: 72 },
    { month: 'Apr', newCustomers: 61, returningCustomers: 102, retention: 75 },
    { month: 'May', newCustomers: 55, returningCustomers: 118, retention: 78 },
    { month: 'Jun', newCustomers: 67, returningCustomers: 134, retention: 82 }
  ];

  const tabs = [
    { id: 'revenue', label: 'Revenue Trend', icon: 'TrendingUp' },
    { id: 'services', label: 'Service Popularity', icon: 'PieChart' },
    { id: 'peak', label: 'Peak Hours', icon: 'Clock' },
    { id: 'retention', label: 'Customer Retention', icon: 'Users' }
  ];

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-surface border border-border rounded-spa p-3 spa-shadow-elevated">
          <p className="font-body font-body-medium text-sm text-text-primary mb-2">{label}</p>
          {payload.map((entry, index) => (
            <p key={index} className="font-body font-body-normal text-sm" style={{ color: entry.color }}>
              {entry.name}: {entry.name.includes('revenue') || entry.name.includes('Revenue') ? 'NPR ' : ''}{entry.value}
              {entry.name.includes('retention') || entry.name.includes('efficiency') ? '%' : ''}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'revenue':
        return (
          <div className="space-y-4">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenueData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis 
                    dataKey="time" 
                    tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
                  />
                  <YAxis 
                    tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line 
                    type="monotone" 
                    dataKey="revenue" 
                    stroke="var(--color-primary)" 
                    strokeWidth={3}
                    dot={{ fill: 'var(--color-primary)', strokeWidth: 2, r: 4 }}
                    name="Revenue (NPR)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-background rounded-spa">
                <div className="font-heading font-heading-semibold text-lg text-text-primary">NPR 22,800</div>
                <div className="font-caption font-caption-normal text-xs text-text-secondary">Current Revenue</div>
              </div>
              <div className="text-center p-3 bg-background rounded-spa">
                <div className="font-heading font-heading-semibold text-lg text-success">+12.5%</div>
                <div className="font-caption font-caption-normal text-xs text-text-secondary">vs Yesterday</div>
              </div>
              <div className="text-center p-3 bg-background rounded-spa">
                <div className="font-heading font-heading-semibold text-lg text-text-primary">NPR 844</div>
                <div className="font-caption font-caption-normal text-xs text-text-secondary">Avg per Booking</div>
              </div>
            </div>
          </div>
        );

      case 'services':
        return (
          <div className="space-y-4">
            <div className="h-64 w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={servicePopularityData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {servicePopularityData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2">
              {servicePopularityData.map((service, index) => (
                <div key={index} className="flex items-center justify-between p-2 bg-background rounded-spa">
                  <div className="flex items-center space-x-3">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: service.color }}
                    ></div>
                    <span className="font-body font-body-medium text-sm text-text-primary">
                      {service.name}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="font-body font-body-medium text-sm text-text-primary">
                      {service.value}%
                    </div>
                    <div className="font-caption font-caption-normal text-xs text-text-secondary">
                      NPR {service.revenue.toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case 'peak':
        return (
          <div className="space-y-4">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={peakHoursData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis 
                    dataKey="hour" 
                    tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
                  />
                  <YAxis 
                    tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar 
                    dataKey="bookings" 
                    fill="var(--color-primary)" 
                    radius={[4, 4, 0, 0]}
                    name="Bookings"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-background rounded-spa">
                <div className="font-heading font-heading-semibold text-lg text-text-primary">2:00 PM</div>
                <div className="font-caption font-caption-normal text-xs text-text-secondary">Peak Hour</div>
              </div>
              <div className="text-center p-3 bg-background rounded-spa">
                <div className="font-heading font-heading-semibold text-lg text-text-primary">27</div>
                <div className="font-caption font-caption-normal text-xs text-text-secondary">Max Bookings</div>
              </div>
              <div className="text-center p-3 bg-background rounded-spa">
                <div className="font-heading font-heading-semibold text-lg text-text-primary">92%</div>
                <div className="font-caption font-caption-normal text-xs text-text-secondary">Avg Efficiency</div>
              </div>
            </div>
          </div>
        );

      case 'retention':
        return (
          <div className="space-y-4">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={customerRetentionData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis 
                    dataKey="month" 
                    tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
                  />
                  <YAxis 
                    tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line 
                    type="monotone" 
                    dataKey="newCustomers" 
                    stroke="var(--color-primary)" 
                    strokeWidth={2}
                    name="New Customers"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="returningCustomers" 
                    stroke="var(--color-success)" 
                    strokeWidth={2}
                    name="Returning Customers"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="retention" 
                    stroke="var(--color-accent)" 
                    strokeWidth={2}
                    name="Retention Rate (%)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-background rounded-spa">
                <div className="font-heading font-heading-semibold text-lg text-text-primary">82%</div>
                <div className="font-caption font-caption-normal text-xs text-text-secondary">Retention Rate</div>
              </div>
              <div className="text-center p-3 bg-background rounded-spa">
                <div className="font-heading font-heading-semibold text-lg text-success">+7%</div>
                <div className="font-caption font-caption-normal text-xs text-text-secondary">vs Last Month</div>
              </div>
              <div className="text-center p-3 bg-background rounded-spa">
                <div className="font-heading font-heading-semibold text-lg text-text-primary">134</div>
                <div className="font-caption font-caption-normal text-xs text-text-secondary">Returning This Month</div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 border border-border">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center">
            <Icon name="BarChart3" size={20} className="text-accent" />
          </div>
          <div>
            <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
              Revenue Analytics
            </h3>
            <p className="font-body font-body-normal text-sm text-text-secondary">
              Comprehensive business insights
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 mb-6 bg-background rounded-spa p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center space-x-2 px-3 py-2 rounded text-sm font-body font-body-medium spa-transition-fast ${
              activeTab === tab.id
                ? 'bg-surface text-text-primary spa-shadow-resting'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <Icon name={tab.icon} size={16} />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      {renderContent()}
    </div>
  );
};

export default RevenueAnalyticsChart;