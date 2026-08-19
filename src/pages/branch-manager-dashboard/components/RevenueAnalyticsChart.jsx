import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import Icon from '../../../components/AppIcon';
import { fetchBookings } from '../../../services/api';
import { transformBookings } from '../../../services/bookingTransformers';

const SERVICE_COLORS = ['#2D5A27', '#8B4513', '#DAA520', '#059669', '#D97706'];

const RevenueAnalyticsChart = ({ branchId, period }) => {
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
    const result = await fetchBookings(branchId, { dateFrom: period?.from || today, dateTo: period?.to || today });

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
  }, [branchId, period?.from, period?.to]);

  useEffect(() => { loadData(); }, [loadData]);

  const tabs = [
    { id: 'revenue', label: 'Revenue Trend', icon: 'TrendingUp' },
    { id: 'services', label: 'Service Popularity', icon: 'PieChart' },
  ];

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg">
          <p className="text-sm font-medium text-gray-900 mb-2">{label}</p>
          {payload.map((entry, index) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
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
            <div className="h-4 bg-gray-100 rounded w-full" />
            <div className="h-4 bg-gray-100 rounded w-3/4" />
            <div className="h-4 bg-gray-100 rounded w-1/2" />
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex items-center space-x-3 p-4">
          <Icon name="AlertCircle" size={18} className="text-red-600" />
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={loadData} className="ml-auto text-sm font-medium text-red-600 underline">
            Retry
          </button>
        </div>
      );
    }

    switch (activeTab) {
      case 'revenue':
        return (
          <div className="space-y-3 sm:space-y-4">
            {revenueData.length === 0 ? (
              <div className="h-48 sm:h-64 flex items-center justify-center">
                <p className="text-xs sm:text-sm text-gray-400">No paid bookings yet today</p>
              </div>
            ) : (
              <div className="h-48 sm:h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={revenueData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 10, fill: '#6b7280' }}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#6b7280' }}
                      width={40}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ fill: '#3b82f6', strokeWidth: 2, r: 3 }}
                      name="Revenue (NPR)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              <div className="text-center p-2 sm:p-3 bg-gray-50 rounded-lg">
                <div className="text-sm sm:text-lg font-semibold text-gray-900 truncate">
                  <span className="sm:hidden">NPR {(totalRevenue / 1000).toFixed(0)}K</span>
                  <span className="hidden sm:inline">NPR {totalRevenue.toLocaleString('en-IN')}</span>
                </div>
                <div className="text-[10px] sm:text-xs text-gray-500">Revenue</div>
              </div>
              <div className="text-center p-2 sm:p-3 bg-gray-50 rounded-lg">
                <div className="text-sm sm:text-lg font-semibold text-gray-900">{paidCount}</div>
                <div className="text-[10px] sm:text-xs text-gray-500">Paid</div>
              </div>
              <div className="text-center p-2 sm:p-3 bg-gray-50 rounded-lg">
                <div className="text-sm sm:text-lg font-semibold text-gray-900 truncate">
                  <span className="sm:hidden">{(avgPerBooking / 1000).toFixed(1)}K</span>
                  <span className="hidden sm:inline">NPR {avgPerBooking.toLocaleString('en-IN')}</span>
                </div>
                <div className="text-[10px] sm:text-xs text-gray-500">Avg</div>
              </div>
            </div>
          </div>
        );

      case 'services':
        return (
          <div className="space-y-3 sm:space-y-4">
            {serviceData.length === 0 ? (
              <div className="h-48 sm:h-64 flex items-center justify-center">
                <p className="text-xs sm:text-sm text-gray-400">No bookings yet today</p>
              </div>
            ) : (
              <>
                <div className="h-48 sm:h-64 w-full flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={serviceData}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={75}
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
                <div className="space-y-1.5 sm:space-y-2">
                  {serviceData.map((service, index) => (
                    <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg gap-2">
                      <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
                        <div
                          className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: service.color }}
                        />
                        <span className="text-xs sm:text-sm font-medium text-gray-900 truncate">
                          {service.name}
                        </span>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-xs sm:text-sm font-medium text-gray-900">
                          {service.value}% <span className="text-gray-500">({service.count})</span>
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
    <div className="bg-white rounded-lg p-4 sm:p-6 border border-gray-200">
      <div className="flex items-center justify-between mb-4 sm:mb-6 gap-2">
        <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
          <div className="w-9 h-9 sm:w-10 sm:h-10 bg-purple-50 rounded-lg flex items-center justify-center flex-shrink-0">
            <Icon name="BarChart3" size={18} className="sm:w-5 sm:h-5 text-purple-600" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-semibold text-gray-900 truncate">
              Revenue Analytics
            </h3>
            <p className="text-xs sm:text-sm text-gray-500 hidden sm:block">
              Today's business insights
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 mb-4 sm:mb-6 bg-gray-100 rounded-lg p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center justify-center space-x-1.5 sm:space-x-2 px-2.5 sm:px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-colors flex-1 sm:flex-initial min-h-[36px] ${
              activeTab === tab.id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <Icon name={tab.icon} size={14} className="sm:w-4 sm:h-4" />
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
