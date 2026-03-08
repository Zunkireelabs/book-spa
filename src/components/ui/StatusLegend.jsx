import React from 'react';

const STATUS_ITEMS = [
  { key: 'pending', label: 'Pending', color: '#f59e0b' },
  { key: 'confirmed', label: 'Confirmed', color: '#3b82f6' },
  { key: 'in-progress', label: 'In Progress', color: '#6366f1' },
  { key: 'completed', label: 'Completed', color: '#22c55e' },
  { key: 'cancelled', label: 'Cancelled', color: '#991b1b' },
];

const PAYMENT_ITEMS = [
  { key: 'unpaid', label: 'Unpaid', borderColor: '#facc15' },
];

const StatusLegend = ({ showPayment = false, compact = false }) => {
  return (
    <div className={`flex items-center flex-wrap ${compact ? 'gap-x-3 gap-y-1' : 'gap-x-4 gap-y-1'}`}>
      {STATUS_ITEMS.map((item) => (
        <div key={item.key} className="flex items-center space-x-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm"
            style={{ backgroundColor: item.color }}
          />
          <span className="font-caption font-caption-normal text-xs text-text-secondary">
            {item.label}
          </span>
        </div>
      ))}
      {showPayment && PAYMENT_ITEMS.map((item) => (
        <div key={item.key} className="flex items-center space-x-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm border-2"
            style={{ borderColor: item.borderColor, backgroundColor: 'transparent' }}
          />
          <span className="font-caption font-caption-normal text-xs text-text-secondary">
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
};

export default StatusLegend;
