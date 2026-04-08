import React from 'react';
import Icon from '../AppIcon';

/**
 * Reusable FilterBar component for consistent filtering UI across the app.
 *
 * @example
 * <FilterBar
 *   search={{ value, onChange, placeholder: "Search..." }}
 *   filters={[
 *     { value, onChange, options: [{ value: 'all', label: 'All' }] },
 *   ]}
 *   resultCount={{ filtered: 10, total: 100 }}
 *   onClear={() => {}}
 *   hasActiveFilters={true}
 * />
 */

const FilterBar = ({
  search,
  filters = [],
  resultCount,
  onClear,
  hasActiveFilters = false,
  className = '',
}) => {
  return (
    <div className={`bg-white rounded-lg border border-gray-200 ${className}`}>
      <div className="flex flex-wrap items-center gap-3 p-3">
        {/* Search Input */}
        {search && (
          <div className="relative flex-1 min-w-[200px] max-w-md">
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
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <Icon name="X" size={14} />
              </button>
            )}
          </div>
        )}

        {/* Filter Dropdowns */}
        {filters.map((filter, index) => (
          <div key={index} className="relative">
            <select
              value={filter.value}
              onChange={(e) => filter.onChange(e.target.value)}
              className="h-9 pl-3 pr-8 text-sm border border-gray-200 rounded-md bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary cursor-pointer"
              style={{ WebkitAppearance: 'none', MozAppearance: 'none', appearance: 'none', backgroundImage: 'none' }}
            >
              {filter.options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <Icon
              name="ChevronDown"
              size={14}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
          </div>
        ))}

        {/* Result Count */}
        {resultCount && (
          <span className="text-sm text-gray-500 whitespace-nowrap">
            {resultCount.filtered} of {resultCount.total}
          </span>
        )}

        {/* Clear Filters Button */}
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
    </div>
  );
};

export default FilterBar;
