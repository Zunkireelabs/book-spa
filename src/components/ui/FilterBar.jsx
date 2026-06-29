import React, { useState } from 'react';
import Icon from '../AppIcon';
import CustomSelect from './CustomSelect';

/**
 * Reusable FilterBar component for consistent filtering UI across the app.
 *
 * Renders a two-tier layout: an optional count chip + search on the first row,
 * then preset pills, date-range inputs and filter dropdowns on a second row.
 *
 * @example
 * <FilterBar
 *   count={{ value: 228, label: 'Leads' }}
 *   search={{ value, onChange, placeholder: "Search..." }}
 *   presets={[{ label: 'Last 7 Days', active: true, onClick: () => {} }]}
 *   dateRange={{ from, onFromChange, to, onToChange, max, onApply, applyDisabled, applyActive }}
 *   filters={[
 *     { value, onChange, options: [{ value: 'all', label: 'All' }] },
 *   ]}
 *   resultCount={{ filtered: 10, total: 100 }}
 *   onClear={() => {}}
 *   hasActiveFilters={true}
 * />
 */

const FilterBar = ({
  count,
  search,
  presets = [],
  dateRange,
  filters = [],
  resultCount,
  onClear,
  hasActiveFilters = false,
  className = '',
}) => {
  const hasTopRow = count != null || !!search;
  const hasFilterRow = presets.length > 0 || !!dateRange || filters.length > 0;
  const showMeta = !!resultCount || (hasActiveFilters && !!onClear);

  // Mobile "Custom" mode — toggled when the user picks Custom from the preset
  // dropdown. Date inputs only render on mobile while this is true (or while
  // the parent already reports applyActive — i.e. a custom range is in effect).
  const [mobileCustomOpen, setMobileCustomOpen] = useState(false);
  const isMobileCustomMode = mobileCustomOpen || !!dateRange?.applyActive;
  // Synthetic "Custom" option appended to the mobile preset dropdown when a
  // date range picker is available. Selected when no preset is active and we're
  // in custom mode.
  const presetMobileValue =
    (presets.find((p) => p.active) || {}).label
    || (isMobileCustomMode && dateRange ? 'Custom' : '');

  const meta = showMeta && (
    <div className="flex items-center gap-2 ml-auto">
      {resultCount && (
        <span className="text-sm text-gray-500 whitespace-nowrap">
          {resultCount.filtered} of {resultCount.total}
        </span>
      )}
      {hasActiveFilters && onClear && (
        <button
          onClick={onClear}
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
          title="Clear filters"
        >
          <Icon name="X" size={16} />
        </button>
      )}
    </div>
  );

  // On mobile, the second row only carries the date inputs + Apply (since
  // preset pills move into the search row as a dropdown). Hide it entirely
  // when not in custom mode and there are no `filters[]` to render.
  const showFilterRowMobile = isMobileCustomMode || filters.length > 0;

  // Mobile preset dropdown — declared once so it can render either in the
  // search row (when a top row exists) or in the filter row (when it doesn't).
  const mobilePresetDropdown = presets.length > 0 && (
    <div className="sm:hidden w-[110px] flex-shrink-0">
      <CustomSelect
        size="sm"
        value={presetMobileValue}
        onChange={(label) => {
          if (label === 'Custom') {
            setMobileCustomOpen(true);
            return;
          }
          const match = presets.find((p) => p.label === label);
          if (match) {
            setMobileCustomOpen(false);
            match.onClick();
          }
        }}
        options={[
          ...presets.map((p) => ({ value: p.label, label: p.label })),
          ...(dateRange ? [{ value: 'Custom', label: 'Custom' }] : []),
        ]}
        placeholder="Period"
      />
    </div>
  );

  return (
    <div className={`flex flex-col bg-white rounded-lg border border-gray-200 ${className}`}>
      {/* Row 1 — count chip + search + (mobile) preset dropdown.
          Mobile layout puts the preset dropdown on the right of the search box. */}
      {hasTopRow && (
        <div className={`flex flex-wrap items-center gap-2 sm:gap-3 p-3 ${hasFilterRow ? 'border-b border-gray-100' : ''}`}>
          {count != null && (
            <span className="hidden sm:inline-flex items-center h-9 px-3 rounded-md bg-gray-50 border border-gray-200 text-sm font-medium text-gray-600 whitespace-nowrap">
              {count.value}{count.label ? ` ${count.label}` : ''}
            </span>
          )}
          {search && (
            <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
              <Icon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder={search.placeholder || 'Search...'}
                value={search.value}
                onChange={(e) => search.onChange(e.target.value)}
                className="w-full h-9 pl-9 pr-9 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                aria-label={search.placeholder || 'Search'}
              />
              {search.value && (
                <button
                  type="button"
                  onClick={() => search.onChange('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                >
                  <Icon name="X" size={14} />
                </button>
              )}
            </div>
          )}
          {/* Mobile-only preset dropdown — sits to the right of the search box */}
          {mobilePresetDropdown}
          {!hasFilterRow && meta}
        </div>
      )}

      {/* Row 2 — preset pills (desktop), date range + Apply, filter dropdowns.
          On mobile, only renders when in Custom mode or filters[] is non-empty. */}
      {hasFilterRow && (
        <div className={`${showFilterRowMobile ? 'flex' : 'hidden sm:flex'} flex-wrap items-center gap-2 p-3`}>
          {/* Preset pill buttons — desktop only */}
          {presets.length > 0 && (
            <div className="hidden sm:flex flex-wrap items-center gap-2">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={p.onClick}
                  className={`px-3 h-9 rounded-md text-sm font-medium transition-colors ${
                    p.active
                      ? 'bg-primary text-white'
                      : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* Mobile preset dropdown rendered in the filter row only when there's
              no top row to host it (rare). Normally it lives in the search row above. */}
          {!hasTopRow && mobilePresetDropdown}

          {/* Date range inputs.
              Desktop (sm+): always shown next to the preset pills.
              Mobile (<sm): only shown when the user picked "Custom" in the dropdown
                            or a custom range is already applied. */}
          {dateRange && (
            <div className={`${isMobileCustomMode ? 'flex' : 'hidden'} sm:flex items-center flex-wrap gap-1 sm:gap-2 flex-1 min-w-0`}>
              <input
                type="date"
                value={dateRange.from}
                max={dateRange.max}
                onChange={(e) => dateRange.onFromChange(e.target.value)}
                className="h-9 px-1.5 sm:px-2 text-xs sm:text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary min-w-0 flex-shrink"
              />
              <span className="hidden sm:inline text-xs text-gray-400">to</span>
              <span className="sm:hidden text-xs text-gray-400">–</span>
              <input
                type="date"
                value={dateRange.to}
                max={dateRange.max}
                onChange={(e) => dateRange.onToChange(e.target.value)}
                className="h-9 px-1.5 sm:px-2 text-xs sm:text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary min-w-0 flex-shrink"
              />
              {dateRange.onApply && (
                <button
                  type="button"
                  onClick={dateRange.onApply}
                  disabled={dateRange.applyDisabled}
                  className={`px-2 sm:px-3 h-9 rounded-md text-xs sm:text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    dateRange.applyActive
                      ? 'bg-primary text-white'
                      : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Apply
                </button>
              )}
            </div>
          )}

          {/* Filter Dropdowns */}
          {filters.map((filter, index) => (
            <CustomSelect
              key={index}
              value={filter.value}
              onChange={filter.onChange}
              options={filter.options}
              size="sm"
            />
          ))}

          {meta}
        </div>
      )}
    </div>
  );
};

export default FilterBar;
