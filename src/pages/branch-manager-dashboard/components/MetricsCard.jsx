import React from 'react';
import Icon from '../../../components/AppIcon';

const MetricsCard = ({ title, value, change, changeType, icon, currency = false }) => {
  const getChangeColor = () => {
    if (changeType === 'positive') return 'text-green-600';
    if (changeType === 'negative') return 'text-red-600';
    return 'text-gray-500';
  };

  const getChangeIcon = () => {
    if (changeType === 'positive') return 'TrendingUp';
    if (changeType === 'negative') return 'TrendingDown';
    return 'Minus';
  };

  return (
    <div className="bg-white rounded-lg p-5 border border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
          <Icon name={icon} size={20} className="text-gray-600" />
        </div>
        <div className={`flex items-center space-x-1 ${getChangeColor()}`}>
          <Icon name={getChangeIcon()} size={14} />
          <span className="text-sm font-medium">{change}</span>
        </div>
      </div>
      <div className="space-y-1">
        <h3 className="text-2xl font-semibold text-gray-900">
          {currency && 'NPR '}
          {value}
        </h3>
        <p className="text-sm text-gray-500">
          {title}
        </p>
      </div>
    </div>
  );
};

export default MetricsCard;