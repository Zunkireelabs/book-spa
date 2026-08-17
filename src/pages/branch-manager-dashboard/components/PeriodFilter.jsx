import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import CustomSelect from '../../../components/ui/CustomSelect';
import { PERIOD_PRESETS, getPeriodRange, getTodayISO } from '../../../utils/periodPresets';

// Header wording override — the shared PERIOD_PRESETS list (also used by ~11 other
// report panels) labels the same preset 'Daily'; here in the dashboard's global
// filter 'Today' reads clearer next to 'Yesterday'.
const LABEL_OVERRIDES = { daily: 'Today' };

const OPTIONS = [
  ...PERIOD_PRESETS.map((p) => ({ value: p.id, label: LABEL_OVERRIDES[p.id] || p.label })),
  { value: 'custom', label: 'Custom' },
];

// value: { key, from, to } — from/to are YYYY-MM-DD. onChange(next) with the same shape.
const PeriodFilter = ({ value, onChange }) => {
  const [customFrom, setCustomFrom] = useState(value.key === 'custom' ? value.from : '');
  const [customTo, setCustomTo] = useState(value.key === 'custom' ? value.to : '');
  const [showCustom, setShowCustom] = useState(value.key === 'custom');
  const wrapRef = useRef(null);

  useEffect(() => {
    if (value.key !== 'custom') setShowCustom(false);
  }, [value.key]);

  // Close the custom range popover on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setShowCustom(false);
      }
    };
    if (showCustom) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCustom]);

  const handleSelect = (key) => {
    if (key === 'custom') {
      setShowCustom(true);
      return;
    }
    const { startDate, endDate } = getPeriodRange(key);
    onChange({ key, from: startDate, to: endDate });
  };

  const handleApplyCustom = () => {
    if (!customFrom || !customTo) return;
    onChange({ key: 'custom', from: customFrom, to: customTo });
    setShowCustom(false);
  };

  return (
    <div className="relative flex items-center gap-2" ref={wrapRef}>
      <CustomSelect
        value={value.key}
        onChange={handleSelect}
        options={OPTIONS}
        size="sm"
        className="min-w-[9rem]"
      />
      {showCustom && (
        <div className="absolute left-0 top-full mt-1 z-dropdown bg-white border border-gray-200 rounded-md shadow-lg p-3 space-y-2 w-64">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
              <input
                type="date"
                value={customFrom}
                max={getTodayISO()}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
              <input
                type="date"
                value={customTo}
                max={getTodayISO()}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={handleApplyCustom}
            disabled={!customFrom || !customTo}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-white text-sm font-medium disabled:opacity-40"
          >
            <Icon name="Check" size={14} />
            Apply
          </button>
        </div>
      )}
    </div>
  );
};

export default PeriodFilter;
