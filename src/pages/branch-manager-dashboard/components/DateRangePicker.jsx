import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const DateRangePicker = ({ onDateRangeChange, onExport }) => {
  const [selectedRange, setSelectedRange] = useState('today');
  const [customRange, setCustomRange] = useState({
    startDate: '',
    endDate: ''
  });
  const [isCustomOpen, setIsCustomOpen] = useState(false);

  const predefinedRanges = [
    { key: 'today', label: 'Today', icon: 'Calendar' },
    { key: 'yesterday', label: 'Yesterday', icon: 'Calendar' },
    { key: 'week', label: 'This Week', icon: 'Calendar' },
    { key: 'month', label: 'This Month', icon: 'Calendar' },
    { key: 'quarter', label: 'This Quarter', icon: 'Calendar' },
    { key: 'custom', label: 'Custom Range', icon: 'CalendarRange' }
  ];

  const getDateRange = (range) => {
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    switch (range) {
      case 'today':
        return { start: startOfDay, end: endOfDay };
      case 'yesterday':
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        return { 
          start: new Date(yesterday.setHours(0, 0, 0, 0)), 
          end: new Date(yesterday.setHours(23, 59, 59, 999)) 
        };
      case 'week':
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay());
        return { 
          start: new Date(startOfWeek.setHours(0, 0, 0, 0)), 
          end: endOfDay 
        };
      case 'month':
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        return { 
          start: startOfMonth, 
          end: endOfDay 
        };
      case 'quarter':
        const quarter = Math.floor(today.getMonth() / 3);
        const startOfQuarter = new Date(today.getFullYear(), quarter * 3, 1);
        return { 
          start: startOfQuarter, 
          end: endOfDay 
        };
      default:
        return { start: startOfDay, end: endOfDay };
    }
  };

  const handleRangeSelect = (range) => {
    setSelectedRange(range);
    
    if (range === 'custom') {
      setIsCustomOpen(true);
    } else {
      setIsCustomOpen(false);
      const dateRange = getDateRange(range);
      if (onDateRangeChange) {
        onDateRangeChange(dateRange);
      }
    }
  };

  const handleCustomRangeApply = () => {
    if (customRange.startDate && customRange.endDate) {
      const dateRange = {
        start: new Date(customRange.startDate),
        end: new Date(customRange.endDate)
      };
      if (onDateRangeChange) {
        onDateRangeChange(dateRange);
      }
      setIsCustomOpen(false);
    }
  };

  const formatDateRange = () => {
    if (selectedRange === 'custom' && customRange.startDate && customRange.endDate) {
      const start = new Date(customRange.startDate).toLocaleDateString('en-GB');
      const end = new Date(customRange.endDate).toLocaleDateString('en-GB');
      return `${start} - ${end}`;
    }
    
    const range = predefinedRanges.find(r => r.key === selectedRange);
    return range ? range.label : 'Today';
  };

  const exportOptions = [
    { key: 'pdf', label: 'Export PDF', icon: 'FileText' },
    { key: 'excel', label: 'Export Excel', icon: 'FileSpreadsheet' },
    { key: 'csv', label: 'Export CSV', icon: 'Download' }
  ];

  return (
    <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 border border-border">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <Icon name="Calendar" size={20} className="text-primary" />
          </div>
          <div>
            <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
              Analytics Period
            </h3>
            <p className="font-body font-body-normal text-sm text-text-secondary">
              {formatDateRange()}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            iconName="Download"
            onClick={() => onExport && onExport('pdf')}
          >
            Export
          </Button>
        </div>
      </div>

      {/* Predefined Ranges */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        {predefinedRanges.map((range) => (
          <button
            key={range.key}
            onClick={() => handleRangeSelect(range.key)}
            className={`flex items-center space-x-2 px-3 py-2 rounded-spa spa-transition-fast ${
              selectedRange === range.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-text-secondary hover:text-text-primary hover:bg-border/50'
            }`}
          >
            <Icon name={range.icon} size={16} />
            <span className="font-body font-body-medium text-sm">{range.label}</span>
          </button>
        ))}
      </div>

      {/* Custom Date Range */}
      {isCustomOpen && (
        <div className="p-4 bg-background rounded-spa border border-border space-y-4">
          <h4 className="font-body font-body-medium text-sm text-text-primary">
            Select Custom Date Range
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-body font-body-medium text-sm text-text-primary mb-2">
                Start Date
              </label>
              <input
                type="date"
                value={customRange.startDate}
                onChange={(e) => setCustomRange(prev => ({ ...prev, startDate: e.target.value }))}
                className="w-full px-3 py-2 border border-border rounded-spa bg-surface text-text-primary focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast"
              />
            </div>
            <div>
              <label className="block font-body font-body-medium text-sm text-text-primary mb-2">
                End Date
              </label>
              <input
                type="date"
                value={customRange.endDate}
                onChange={(e) => setCustomRange(prev => ({ ...prev, endDate: e.target.value }))}
                className="w-full px-3 py-2 border border-border rounded-spa bg-surface text-text-primary focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast"
              />
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="primary"
              size="sm"
              onClick={handleCustomRangeApply}
              disabled={!customRange.startDate || !customRange.endDate}
            >
              Apply Range
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCustomOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Quick Stats */}
      <div className="mt-6 pt-4 border-t border-border">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="p-3 bg-background rounded-spa">
            <div className="font-heading font-heading-semibold text-lg text-text-primary">
              {selectedRange === 'today' ? '47' : '324'}
            </div>
            <div className="font-caption font-caption-normal text-xs text-text-secondary">
              Total Bookings
            </div>
          </div>
          <div className="p-3 bg-background rounded-spa">
            <div className="font-heading font-heading-semibold text-lg text-text-primary">
              NPR {selectedRange === 'today' ? '56,400' : '3,88,800'}
            </div>
            <div className="font-caption font-caption-normal text-xs text-text-secondary">
              Revenue
            </div>
          </div>
          <div className="p-3 bg-background rounded-spa">
            <div className="font-heading font-heading-semibold text-lg text-text-primary">
              {selectedRange === 'today' ? '4.8' : '4.7'}
            </div>
            <div className="font-caption font-caption-normal text-xs text-text-secondary">
              Avg Rating
            </div>
          </div>
        </div>
      </div>

      {/* Export Options Dropdown */}
      <div className="mt-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <span className="font-body font-body-medium text-sm text-text-primary">
            Export Options
          </span>
          <div className="flex space-x-2">
            {exportOptions.map((option) => (
              <Button
                key={option.key}
                variant="ghost"
                size="xs"
                iconName={option.icon}
                onClick={() => onExport && onExport(option.key)}
              >
                {option.label.split(' ')[1]}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DateRangePicker;