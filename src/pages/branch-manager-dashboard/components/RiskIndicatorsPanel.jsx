import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { getRiskIndicators } from '../../../services/api';

function RiskBadge({ level }) {
  const styles = {
    Low: 'bg-success/10 text-success',
    Moderate: 'bg-warning/10 text-warning',
    High: 'bg-error/10 text-error',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded font-caption font-caption-medium text-[11px] ${styles[level] || styles.Low}`}>
      {level}
    </span>
  );
}

function TrendIndicator({ value, invertColor }) {
  if (value === 0) {
    return (
      <span className="font-data font-data-normal text-xs text-text-tertiary">
        — no change
      </span>
    );
  }

  const isUp = value > 0;
  // For most risk metrics, up = bad. invertColor flips that.
  const isGood = invertColor ? isUp : !isUp;

  return (
    <span className={`inline-flex items-center space-x-1 font-data font-data-normal text-xs ${isGood ? 'text-success' : 'text-error'}`}>
      <Icon name={isUp ? 'TrendingUp' : 'TrendingDown'} size={14} />
      <span>{isUp ? '+' : ''}{value}%</span>
    </span>
  );
}

function getRiskLevel(metric, value) {
  const thresholds = {
    unpaidPercent: { moderate: 15, high: 30 },
    cancellationRate7d: { moderate: 10, high: 25 },
    discountedBookingPercent: { moderate: 20, high: 40 },
    atRiskPercent: { moderate: 15, high: 30 },
  };

  const t = thresholds[metric];
  if (!t) return 'Low';
  if (value >= t.high) return 'High';
  if (value >= t.moderate) return 'Moderate';
  return 'Low';
}

const RiskIndicatorsPanel = ({ branchId }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);

    const result = await getRiskIndicators({ branchId });

    if (result.error) {
      setError(result.error.message || 'Failed to load risk indicators.');
      setLoading(false);
      return;
    }

    setData(result.data);
    setLoading(false);
  }, [branchId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="bg-surface rounded-spa-lg border border-border p-5 animate-pulse">
            <div className="h-4 bg-background rounded w-28 mb-3" />
            <div className="h-6 bg-background rounded w-20 mb-2" />
            <div className="h-3 bg-background rounded w-full mb-2" />
            <div className="h-3 bg-background rounded w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-error/5 border border-error/20 rounded-spa p-4 flex items-center space-x-3">
        <Icon name="AlertCircle" size={18} className="text-error flex-shrink-0" />
        <p className="font-body text-sm text-error">{error}</p>
        <button onClick={loadData} className="ml-auto font-body font-body-medium text-sm text-error underline">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { unpaidRisk, cancellationRisk, discountRisk, retentionRisk } = data;

  const cards = [
    {
      title: 'Unpaid Revenue',
      icon: 'DollarSign',
      iconBg: 'bg-error/10',
      iconColor: 'text-error',
      mainValue: `NPR ${unpaidRisk.totalUnpaidAmount.toLocaleString('en-IN')}`,
      secondary: `${unpaidRisk.unpaidCount} unpaid booking${unpaidRisk.unpaidCount !== 1 ? 's' : ''}`,
      badge: getRiskLevel('unpaidPercent', unpaidRisk.unpaidPercent),
      extra: `${unpaidRisk.unpaidPercent}% of recent bookings`,
    },
    {
      title: 'Cancellation (7d)',
      icon: 'XCircle',
      iconBg: 'bg-warning/10',
      iconColor: 'text-warning',
      mainValue: `${cancellationRisk.cancellationRate7d}%`,
      secondary: `No-show: ${cancellationRisk.noShowRate7d}%`,
      badge: getRiskLevel('cancellationRate7d', cancellationRisk.cancellationRate7d),
      trend: cancellationRisk.deltaVsPrevious7d,
    },
    {
      title: 'Discount Usage (30d)',
      icon: 'Percent',
      iconBg: 'bg-accent/10',
      iconColor: 'text-accent',
      mainValue: `${discountRisk.avgDiscountPercent30d}% avg`,
      secondary: `${discountRisk.discountedBookingPercent}% of bookings discounted`,
      badge: getRiskLevel('discountedBookingPercent', discountRisk.discountedBookingPercent),
      extra: discountRisk.topDiscountApprover
        ? `Top approver: ${discountRisk.topDiscountApprover}`
        : null,
    },
    {
      title: 'Retention Risk',
      icon: 'UserMinus',
      iconBg: 'bg-primary/10',
      iconColor: 'text-primary',
      mainValue: `${retentionRisk.atRiskCustomerCount} customer${retentionRisk.atRiskCustomerCount !== 1 ? 's' : ''}`,
      secondary: `${retentionRisk.atRiskPercent}% at risk (60d+ inactive)`,
      badge: getRiskLevel('atRiskPercent', retentionRisk.atRiskPercent),
      extra: retentionRisk.revenueAtRiskEstimate > 0
        ? `Est. revenue at risk: NPR ${retentionRisk.revenueAtRiskEstimate.toLocaleString('en-IN')}`
        : null,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center space-x-2">
        <Icon name="ShieldAlert" size={18} className="text-text-secondary" />
        <h2 className="font-body font-body-medium text-sm text-text-secondary">Risk Indicators</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
          <div key={card.title} className="bg-surface rounded-spa-lg border border-border p-5">
            {/* Header row */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <div className={`w-8 h-8 rounded-lg ${card.iconBg} flex items-center justify-center`}>
                  <Icon name={card.icon} size={16} className={card.iconColor} />
                </div>
                <h3 className="font-body font-body-medium text-sm text-text-primary">{card.title}</h3>
              </div>
              <RiskBadge level={card.badge} />
            </div>

            {/* Main value */}
            <p className="font-heading font-heading-semibold text-lg text-text-primary mb-1">
              {card.mainValue}
            </p>

            {/* Secondary metric */}
            <p className="font-body text-xs text-text-secondary mb-2">
              {card.secondary}
            </p>

            {/* Trend or extra info */}
            {card.trend !== undefined && (
              <div className="flex items-center space-x-1">
                <TrendIndicator value={card.trend} />
                <span className="font-caption font-caption-normal text-[11px] text-text-tertiary">vs prev 7d</span>
              </div>
            )}

            {card.extra && (
              <p className="font-caption font-caption-normal text-[11px] text-text-tertiary mt-1">
                {card.extra}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default RiskIndicatorsPanel;
