import React, { useState, useMemo } from 'react';
import Icon from '../../../../components/AppIcon';
import FilterBar from '../../../../components/ui/FilterBar';
import { getPeriodRange, getTodayISO } from '../../../../utils/periodPresets';
import OverviewTab from './OverviewTab';
import CustomersTab from './CustomersTab';
import ServicesTab from './ServicesTab';
import AttendanceTab from './AttendanceTab';

// Subset of the shared PERIOD_PRESETS, relabeled to match this view's spec (Today/Week/Month/
// Year/Custom) — the main table keeps the full preset list, this drill-down only needs these.
const DETAIL_PERIOD_PRESETS = [
  { id: 'daily', label: 'Today' },
  { id: 'weekly', label: 'Week' },
  { id: 'monthly', label: 'Month' },
  { id: 'annually', label: 'Year' },
];

const TABS = [
  { key: 'overview', label: 'Overview', icon: 'LayoutGrid' },
  { key: 'customers', label: 'Customers', icon: 'Users' },
  { key: 'services', label: 'Services', icon: 'Sparkles' },
  { key: 'attendance', label: 'Attendance', icon: 'Clock' },
];

function formatPrettyDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const TherapistDetailView = ({ therapistId, therapistName, branchId, onBack }) => {
  const today = getTodayISO();

  const [activePreset, setActivePreset] = useState('weekly');
  const [mode, setMode] = useState('preset'); // 'preset' | 'custom'
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  // The single source of truth every tab derives from — changing this changes every tab's data,
  // per the "no tab silently uses a different range" requirement.
  const range = useMemo(() => {
    if (mode === 'custom' && appliedFrom) {
      return { fromDate: appliedFrom, toDate: appliedTo || today };
    }
    const { startDate, endDate } = getPeriodRange(activePreset);
    return { fromDate: startDate, toDate: endDate };
  }, [mode, activePreset, appliedFrom, appliedTo, today]);

  const customDirty = customFrom && (customFrom !== appliedFrom || customTo !== appliedTo);

  const handlePreset = (id) => {
    setMode('preset');
    setActivePreset(id);
  };

  const handleCustomApply = () => {
    if (!customFrom) return;
    setAppliedFrom(customFrom);
    setAppliedTo(customTo);
    setMode('custom');
  };

  const periodLabel = mode === 'preset'
    ? (DETAIL_PERIOD_PRESETS.find(p => p.id === activePreset)?.label || 'Period')
    : 'Custom';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1 mb-2 font-body font-body-medium text-sm text-text-secondary hover:text-text-primary spa-transition-fast"
          >
            <Icon name="ChevronLeft" size={16} />
            <span>Back to Performance</span>
          </button>
          <h2 className="font-heading font-heading-semibold text-xl text-text-primary truncate">{therapistName}</h2>
          <p className="font-body text-sm text-text-secondary">
            {periodLabel} · {formatPrettyDate(range.fromDate)}–{formatPrettyDate(range.toDate)}
          </p>
        </div>
      </div>

      {/* Global period selector — drives every tab below */}
      <FilterBar
        presets={DETAIL_PERIOD_PRESETS.map((p) => ({
          label: p.label,
          active: mode === 'preset' && activePreset === p.id,
          onClick: () => handlePreset(p.id),
        }))}
        dateRange={{
          from: customFrom,
          onFromChange: setCustomFrom,
          to: customTo,
          onToChange: setCustomTo,
          max: today,
          onApply: handleCustomApply,
          applyDisabled: !customFrom || !customDirty,
          applyActive: mode === 'custom',
        }}
      />

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 bg-background border border-border rounded-spa-lg p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`inline-flex items-center space-x-1.5 px-3 py-2 rounded-spa text-sm font-body font-body-medium spa-transition-fast ${
              activeTab === tab.key
                ? 'bg-surface text-primary shadow-spa-resting border border-border'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface/60'
            }`}
          >
            <Icon name={tab.icon} size={14} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content — each tab fetches its own data for {therapistId, branchId, ...range} and
          refetches whenever the period above changes. */}
      <div>
        {activeTab === 'overview' && <OverviewTab therapistId={therapistId} branchId={branchId} range={range} />}
        {activeTab === 'customers' && <CustomersTab therapistId={therapistId} branchId={branchId} range={range} />}
        {activeTab === 'services' && <ServicesTab therapistId={therapistId} branchId={branchId} range={range} />}
        {activeTab === 'attendance' && <AttendanceTab therapistId={therapistId} branchId={branchId} range={range} />}
      </div>
    </div>
  );
};

export default TherapistDetailView;
