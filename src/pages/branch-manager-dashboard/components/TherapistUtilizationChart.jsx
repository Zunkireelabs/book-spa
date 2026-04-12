import React, { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import Icon from '../../../components/AppIcon';
import { useIndustry } from '../../../hooks/useIndustry';
import { getUtilizationIntelligence } from '../../../services/api';

const TherapistUtilizationChart = ({ branchId }) => {
  const { staffLabel, staffLabelPlural } = useIndustry();
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
        <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg">
          <p className="text-sm font-medium text-gray-900 mb-1">{label}</p>
          <p className="text-sm text-gray-500">
            Utilization: {data.utilization}%
          </p>
          <p className="text-sm text-gray-500">
            Booked: {data.bookedMinutes}m / {data.totalMinutes}m
          </p>
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg p-6 border border-gray-200">
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
            <Icon name="Users" size={20} className="text-purple-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {staffLabel} Utilization
            </h3>
            <p className="text-sm text-gray-500">
              Loading...
            </p>
          </div>
        </div>
        <div className="h-64 flex items-center justify-center">
          <div className="animate-pulse space-y-3 w-full">
            <div className="h-4 bg-gray-100 rounded w-full" />
            <div className="h-4 bg-gray-100 rounded w-3/4" />
            <div className="h-4 bg-gray-100 rounded w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg p-6 border border-gray-200">
        <div className="flex items-center space-x-3 mb-4">
          <Icon name="AlertCircle" size={18} className="text-red-600" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
        <button onClick={loadData} className="text-sm font-medium text-red-600 underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg p-6 border border-gray-200">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
            <Icon name="Users" size={20} className="text-purple-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {staffLabel} Utilization
            </h3>
            <p className="text-sm text-gray-500">
              Today's workload distribution
            </p>
          </div>
        </div>
        <button className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
          <Icon name="MoreVertical" size={16} className="text-gray-500" />
        </button>
      </div>

      {utilizationData.length === 0 ? (
        <div className="h-64 flex items-center justify-center">
          <p className="text-sm text-gray-400">No {staffLabelPlural.toLowerCase()} data available</p>
        </div>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={utilizationData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 12, fill: '#6b7280' }}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis
                tick={{ fontSize: 12, fill: '#6b7280' }}
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
        <div className="p-3 bg-green-50 rounded-lg">
          <div className="text-lg font-semibold text-green-600">{optimalCount}</div>
          <div className="text-xs text-gray-500">Optimal</div>
        </div>
        <div className="p-3 bg-amber-50 rounded-lg">
          <div className="text-lg font-semibold text-amber-600">{highLoadCount}</div>
          <div className="text-xs text-gray-500">High Load</div>
        </div>
        <div className="p-3 bg-red-50 rounded-lg">
          <div className="text-lg font-semibold text-red-600">{overloadedCount}</div>
          <div className="text-xs text-gray-500">Overloaded</div>
        </div>
      </div>
    </div>
  );
};

export default TherapistUtilizationChart;
