import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Select from '../../../components/ui/Select';
import Input from '../../../components/ui/Input';

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

  return (
    <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-heading font-heading-semibold text-lg text-text-primary">
          Quick Filters
        </h2>
        <button
          onClick={clearFilters}
          className="flex items-center space-x-1 px-3 py-1 text-xs text-text-secondary hover:text-primary spa-transition-fast"
        >
          <Icon name="RotateCcw" size={14} />
          <span>Clear</span>
        </button>
      </div>

      {/* Search */}
      <div className="space-y-2">
        <Input
          type="search"
          placeholder="Search by ID, phone, or email..."
          value={filters.search}
          onChange={(e) => handleFilterChange('search', e.target.value)}
          className="w-full"
        />
      </div>

      {/* Date Range Filter */}
      <div className="space-y-2">
        <Select
          label="Date Range"
          options={dateRangeOptions}
          value={filters.dateRange}
          onChange={(value) => handleFilterChange('dateRange', value)}
        />
      </div>

      {/* Service Type Filter */}
      <div className="space-y-2">
        <Select
          label="Service Type"
          options={serviceTypeOptions}
          value={filters.serviceType}
          onChange={(value) => handleFilterChange('serviceType', value)}
        />
      </div>

      {/* Status Filter */}
      <div className="space-y-2">
        <Select
          label="Booking Status"
          options={statusOptions}
          value={filters.status}
          onChange={(value) => handleFilterChange('status', value)}
        />
      </div>

      {/* Booking Counts */}
      <div className="space-y-3 pt-4 border-t border-border">
        <h3 className="font-body font-body-medium text-sm text-text-primary">
          Today's Overview
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center p-3 bg-background rounded-spa">
            <div className="font-heading font-heading-semibold text-lg text-success">
              {bookingCounts.confirmed}
            </div>
            <div className="font-caption font-caption-normal text-xs text-text-secondary">
              Confirmed
            </div>
          </div>
          <div className="text-center p-3 bg-background rounded-spa">
            <div className="font-heading font-heading-semibold text-lg text-warning">
              {bookingCounts.pending}
            </div>
            <div className="font-caption font-caption-normal text-xs text-text-secondary">
              Pending
            </div>
          </div>
          <div className="text-center p-3 bg-background rounded-spa">
            <div className="font-heading font-heading-semibold text-lg text-primary">
              {bookingCounts.inProgress}
            </div>
            <div className="font-caption font-caption-normal text-xs text-text-secondary">
              In Progress
            </div>
          </div>
          <div className="text-center p-3 bg-background rounded-spa">
            <div className="font-heading font-heading-semibold text-lg text-text-secondary">
              {bookingCounts.completed}
            </div>
            <div className="font-caption font-caption-normal text-xs text-text-secondary">
              Completed
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuickFilters;