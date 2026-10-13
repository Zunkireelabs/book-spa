import React from 'react';

// Relabels the existing is_service_staff boolean as an explicit two-option
// choice. Drives which fields StaffProfileSection shows below it.
const StaffTypeToggle = ({ isServiceStaff, onChange }) => {
  const options = [
    { value: true, label: 'Service Staff', hint: 'Delivers bookable services' },
    { value: false, label: 'Support Staff', hint: 'Not assigned to bookings' },
  ];

  return (
    <div className="bg-surface border border-border rounded-spa-lg p-5 space-y-3">
      <h3 className="font-heading font-heading-semibold text-base text-text-primary">Staff Type</h3>
      <div className="grid grid-cols-2 gap-2">
        {options.map(opt => (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`text-left p-3 rounded-spa border spa-transition-fast ${
              isServiceStaff === opt.value
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-background'
            }`}
          >
            <p className={`font-body font-body-medium text-sm ${isServiceStaff === opt.value ? 'text-primary' : 'text-text-primary'}`}>
              {opt.label}
            </p>
            <p className="font-caption text-xs text-text-secondary mt-0.5">{opt.hint}</p>
          </button>
        ))}
      </div>
    </div>
  );
};

export default StaffTypeToggle;
