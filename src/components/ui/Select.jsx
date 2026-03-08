import React from 'react';
import Icon from '../AppIcon';

const Select = ({
  label,
  options = [],
  value,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  error,
}) => {
  const handleChange = (e) => {
    if (onChange) onChange(e.target.value);
  };

  return (
    <div className="space-y-1">
      {label && (
        <label className="block font-body font-body-medium text-sm text-text-primary">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          value={value}
          onChange={handleChange}
          disabled={disabled}
          className={`
            w-full appearance-none rounded-spa border bg-surface px-3 py-2 pr-8
            font-body font-body-normal text-sm text-text-primary
            focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary
            disabled:opacity-50 disabled:cursor-not-allowed
            spa-transition-fast
            ${error ? 'border-error' : 'border-border'}
          `}
        >
          {placeholder && !value && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
          <Icon name="ChevronDown" size={14} className="text-text-secondary" />
        </div>
      </div>
      {error && (
        <p className="font-caption font-caption-normal text-xs text-error">{error}</p>
      )}
    </div>
  );
};

export default Select;
