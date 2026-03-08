import React from 'react';

const Checkbox = ({ label, checked, onChange, name, disabled = false }) => {
  const handleChange = (e) => {
    if (onChange) onChange(e);
  };

  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={handleChange}
        disabled={disabled}
        className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
      />
      {label && (
        <span className="font-body font-body-normal text-sm text-text-primary">
          {label}
        </span>
      )}
    </label>
  );
};

export { Checkbox };
