import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import Icon from '../../../components/AppIcon';
import { fetchBookings } from '../../../services/api';
import { transformBookings } from '../../../services/bookingTransformers';

const SERVICE_COLORS = ['#2D5A27', '#8B4513', '#DAA520', '#059669', '#D97706'];

const RevenueAnalyticsChart = ({ branchId }) => {
  const [activeTab, setActiveTab] = useState('revenue');
  const [revenueData, setRevenueData] = useState([]);
  const [serviceData, setServiceData] = useState([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [avgPerBooking, setAvgPerBooking] = useState(0);
  const [paidCount, setPaidCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);

    const today = new Date().toISOString().split('T')[0];
    const result = await fetchBookings(branchId, { date: today });

    if (result.error) {
      setError(result.error.message || 'Failed to load revenue data.');
      setLoading(false);
      return;
    }

    const bookings = transformBookings(result.data || []);

    // --- Revenue Trend: group paid bookings by hour, show cumulative revenue ---
    const paidBookings = bookings.filter(b => b.paymentStatus === 'paid');
    setPaidCount(paidBookings.length);

    const hourlyRevMap = {};
    for (const b of paidBookings) {
      if (!b.time) continue;
      const hour = b.time.slice(0, 2);
      const hourLabel = `${hour}:00`;
      if (!hourlyRevMap[hourLabel]) {
        hourlyRevMap[hourLabel] = 0;
      }
      hourlyRevMap[hourLabel] += b.finalAmount;
    }

    const hours = Object.keys(hourlyRevMap).sort();
    let cumRevenue = 0;
    const revChart = hours.map(time => {
      cumRevenue += hourlyRevMap[time];
      return { time, revenue: cumRevenue };
    });
    setRevenueData(revChart);

    const total = paidBookings.reduce((sum, b) => sum + b.finalAmount, 0);
    setTotalRevenue(total);
    setAvgPerBooking(paidBookings.length > 0 ? Math.round(total / paidBookings.length) : 0);

    // --- Service Popularity: count all bookings per service, top 5 ---
    const serviceMap = {};
    for (const b of bookings) {
      const svc = b.service || 'Unknown';
      if (!serviceMap[svc]) {
        serviceMap[svc] = { count: 0, revenue: 0 };
      }
      serviceMap[svc].count += 1;
      serviceMap[svc].revenue += b.finalAmount;
    }

    const totalBookings = bookings.length;
    const svcArr = Object.entries(serviceMap)
      .map(([name, { count, revenue }]) => ({
        name,
        value: totalBookings > 0 ? Math.round((count / totalBookings) * 100) : 0,
        revenue,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((item, idx) => ({ ...item, color: SERVICE_COLORS[idx % SERVICE_COLORS.length] }));

    setServiceData(svcArr);
    setLoading(false);
  }, [branchId]);

  useEffect(() => { loadData(); }, [loadData]);

  const tabs = [
    { id: 'revenue', label: 'Revenue Trend', icon: 'TrendingUp' },
    { id: 'services', label: 'Service Popularity', icon: 'PieChart' },
  ];

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-surface border border-border rounded-spa p-3 spa-shadow-elevated">
          <p className="font-body font-body-medium text-sm text-text-primary mb-2">{label}</p>
          {payload.map((entry, index) => (
            <p key={index} className="font-body font-body-normal text-sm" style={{ color: entry.color }}>
              {entry.name}: {entry.name.includes('Revenue') ? 'NPR ' : ''}{entry.value.toLocaleString('en-IN')}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="h-64 flex items-center justify-center">
          <div className="animate-pulse space-y-3 w-full">
            <div className="h-4 bg-background rounded w-full" />
            <div className="h-4 bg-background rounded w-3/4" />
            <div className="h-4 bg-background rounded w-1/2" />
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex items-center space-x-3 p-4">
          <Icon name="AlertCircle" size={18} className="text-error" />
          <p className="font-body text-sm text-error">{error}</p>
          <button onClick={loadData} className="ml-auto font-body font-body-medium text-sm text-error underline">
            Retry
          </button>
        </div>
      );
    }

    switch (activeTab) {
      case 'revenue':
        return (
          <div className="space-y-4">
            {revenueData.length === 0 ? (
              <div className="h-64 flex items-center justify-center">
                <p className="font-body text-sm text-text-tertiary">No paid bookings yet today</p>
              </div>
            ) : (
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
            )}
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-background rounded-spa">
                <div className="font-heading font-heading-semibold text-lg text-text-primary">
                  NPR {totalRevenue.toLocaleString('en-IN')}
                </div>
                <div className="font-caption font-caption-normal text-xs text-text-secondary">Current Revenue</div>
              </div>
              <div className="text-center p-3 bg-background rounded-spa">
                <div className="font-heading font-heading-semibold text-lg text-text-primary">{paidCount}</div>
                <div className="font-caption font-caption-normal text-xs text-text-secondary">Paid Bookings</div>
              </div>
              <div className="text-center p-3 bg-background rounded-spa">
                <div className="font-heading font-heading-semibold text-lg text-text-primary">
                  NPR {avgPerBooking.toLocaleString('en-IN')}
                </div>
                <div className="font-caption font-caption-normal text-xs text-text-secondary">Avg per Booking</div>
              </div>
            </div>
          </div>
        );

      case 'services':
        return (
          <div className="space-y-4">
            {serviceData.length === 0 ? (
              <div className="h-64 flex items-center justify-center">
                <p className="font-body text-sm text-text-tertiary">No bookings yet today</p>
              </div>
            ) : (
              <>
                <div className="h-64 w-full flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={serviceData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {serviceData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2">
                  {serviceData.map((service, index) => (
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
                          {service.value}% ({service.count})
                        </div>
                        <div className="font-caption font-caption-normal text-xs text-text-secondary">
                          NPR {service.revenue.toLocaleString('en-IN')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
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
              Today's business insights
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
