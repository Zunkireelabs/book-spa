import React from 'react';
import CustomSelect from './CustomSelect';

const Select = ({
  label,
  options = [],
  value,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  error,
}) => {
  return (
    <div className="space-y-1">
      {label && (
        <label className="block font-body font-body-medium text-sm text-text-primary">
          {label}
        </label>
      )}
      <CustomSelect
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        error={!!error}
        size="md"
      />
      {error && (
        <p className="font-caption font-caption-normal text-xs text-error">{error}</p>
      )}
    </div>
  );
};

export default Select;
