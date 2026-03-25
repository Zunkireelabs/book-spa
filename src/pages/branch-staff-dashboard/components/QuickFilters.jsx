import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const QuickFilters = ({ onFiltersChange, bookingCounts }) => {
  const [filters, setFilters] = useState({
    dateRange: 'today',
    serviceType: 'all',
    status: 'all',
    search: ''
  });

  const dateRangeOptions = [
    { value: 'today', label: 'Today' },
    { value: 'tomorrow', label: 'Tomorrow' },
    { value: 'week', label: 'This Week' },
    { value: 'month', label: 'This Month' }
  ];

  const serviceTypeOptions = [
    { value: 'all', label: 'All Services' },
    { value: 'massage', label: 'Massage Therapy' },
    { value: 'facial', label: 'Facial Treatment' },
    { value: 'body', label: 'Body Treatment' },
    { value: 'aromatherapy', label: 'Aromatherapy' },
    { value: 'reflexology', label: 'Reflexology' }
  ];

  const statusOptions = [
    { value: 'all', label: 'All Status' },
    { value: 'pending', label: 'Pending' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' }
  ];

  const handleFilterChange = (key, value) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    onFiltersChange(newFilters);
  };

  const clearFilters = () => {
    const defaultFilters = {
      dateRange: 'today',
      serviceType: 'all',
      status: 'all',
      search: ''
    };
    setFilters(defaultFilters);
    onFiltersChange(defaultFilters);
  };

  const hasActiveFilters = filters.search || filters.dateRange !== 'today' || filters.serviceType !== 'all' || filters.status !== 'all';

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search Input */}
      <div className="relative flex-1 min-w-[200px] max-w-md">
        <Icon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
        <input
          type="search"
          placeholder="Search by ID, phone, or email..."
          value={filters.search}
          onChange={(e) => handleFilterChange('search', e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-sm border border-[rgba(0,0,29,0.102)] rounded-spa bg-surface focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
          aria-label="Search bookings by ID, phone, or email"
        />
      </div>

      {/* Date Range Filter */}
      <select
        value={filters.dateRange}
        onChange={(e) => handleFilterChange('dateRange', e.target.value)}
        className="px-3 py-2 text-sm border border-[rgba(0,0,29,0.102)] rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary cursor-pointer"
      >
        {dateRangeOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Service Type Filter */}
      <select
        value={filters.serviceType}
        onChange={(e) => handleFilterChange('serviceType', e.target.value)}
        className="px-3 py-2 text-sm border border-[rgba(0,0,29,0.102)] rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary cursor-pointer"
      >
        {serviceTypeOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Status Filter */}
      <select
        value={filters.status}
        onChange={(e) => handleFilterChange('status', e.target.value)}
        className="px-3 py-2 text-sm border border-[rgba(0,0,29,0.102)] rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary cursor-pointer"
      >
        {statusOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Clear Filters Button */}
      {hasActiveFilters && (
        <button
          onClick={clearFilters}
          className="flex items-center space-x-1 px-3 py-2 text-sm text-text-secondary hover:text-primary border border-[rgba(0,0,29,0.102)] rounded-spa bg-surface spa-transition-fast"
        >
          <Icon name="X" size={14} />
          <span>Clear</span>
        </button>
      )}
    </div>
  );
};

export default QuickFilters;
