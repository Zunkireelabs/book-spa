import React from 'react';
import Icon from '../../../components/AppIcon';

const MetricsCard = ({ title, value, change, changeType, icon, currency = false }) => {
  const getChangeColor = () => {
    if (changeType === 'positive') return 'text-success';
    if (changeType === 'negative') return 'text-error';
    return 'text-text-secondary';
  };

  const getChangeIcon = () => {
    if (changeType === 'positive') return 'TrendingUp';
    if (changeType === 'negative') return 'TrendingDown';
    return 'Minus';
  };

  return (
    <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 border border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
          <Icon name={icon} size={24} className="text-primary" />
        </div>
        <div className={`flex items-center space-x-1 ${getChangeColor()}`}>
          <Icon name={getChangeIcon()} size={16} />
          <span className="font-body font-body-medium text-sm">{change}</span>
        </div>
      </div>
      <div className="space-y-1">
        <h3 className="font-heading font-heading-semibold text-2xl text-text-primary">
          {currency && 'NPR '}
          {value}
        </h3>
        <p className="font-body font-body-normal text-sm text-text-secondary">
          {title}
        </p>
      </div>
    </div>
  );
};

export default MetricsCard;