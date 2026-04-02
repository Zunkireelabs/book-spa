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
    <div className="bg-white rounded-lg p-6 border border-gray-200">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
            <Icon name="Calendar" size={20} className="text-blue-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Analytics Period
            </h3>
            <p className="text-sm text-gray-500">
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
            className={`flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors ${
              selectedRange === range.key
                ? 'bg-blue-600 text-white'
                : 'bg-gray-50 text-gray-500 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            <Icon name={range.icon} size={16} />
            <span className="text-sm font-medium">{range.label}</span>
          </button>
        ))}
      </div>

      {/* Custom Date Range */}
      {isCustomOpen && (
        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-4">
          <h4 className="text-sm font-medium text-gray-900">
            Select Custom Date Range
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                Start Date
              </label>
              <input
                type="date"
                value={customRange.startDate}
                onChange={(e) => setCustomRange(prev => ({ ...prev, startDate: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                End Date
              </label>
              <input
                type="date"
                value={customRange.endDate}
                onChange={(e) => setCustomRange(prev => ({ ...prev, endDate: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
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
      <div className="mt-6 pt-4 border-t border-gray-100">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="text-lg font-semibold text-gray-900">
              {selectedRange === 'today' ? '47' : '324'}
            </div>
            <div className="text-xs text-gray-500">
              Total Bookings
            </div>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="text-lg font-semibold text-gray-900">
              NPR {selectedRange === 'today' ? '56,400' : '3,88,800'}
            </div>
            <div className="text-xs text-gray-500">
              Revenue
            </div>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="text-lg font-semibold text-gray-900">
              {selectedRange === 'today' ? '4.8' : '4.7'}
            </div>
            <div className="text-xs text-gray-500">
              Avg Rating
            </div>
          </div>
        </div>
      </div>

      {/* Export Options Dropdown */}
      <div className="mt-4 pt-4 border-t border-gray-100">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-900">
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