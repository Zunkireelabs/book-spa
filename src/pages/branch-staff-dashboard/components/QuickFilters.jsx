import React, { useState } from 'react';
import FilterBar from '../../../components/ui/FilterBar';

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
    <FilterBar
      search={{
        value: filters.search,
        onChange: (value) => handleFilterChange('search', value),
        placeholder: 'Search by ID, phone, or email...',
      }}
      filters={[
        {
          value: filters.dateRange,
          onChange: (value) => handleFilterChange('dateRange', value),
          options: dateRangeOptions,
        },
        {
          value: filters.serviceType,
          onChange: (value) => handleFilterChange('serviceType', value),
          options: serviceTypeOptions,
        },
        {
          value: filters.status,
          onChange: (value) => handleFilterChange('status', value),
          options: statusOptions,
        },
      ]}
      hasActiveFilters={hasActiveFilters}
      onClear={clearFilters}
    />
  );
};

export default QuickFilters;
