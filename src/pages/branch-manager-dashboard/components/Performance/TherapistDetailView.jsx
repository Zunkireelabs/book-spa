import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import { useIndustry } from 'hooks/useIndustry';
import { getTherapistOverview } from '../../../../services/api';
import { downloadCsv } from 'utils/csvExport';
import { DEFAULT_REPORT_PERIOD } from 'utils/reportPeriod';
import { PeriodPicker } from '../Reports/ReportFrame';
import { useTherapistPerformance } from '../Reports/useTherapistPerformance';
import { buildRows } from '../Reports/therapistPerformanceView';
import { csvRows, rankOf } from './therapistInnerView';
import OverviewTab from './OverviewTab';
import CustomersTab from './CustomersTab';
import ServicesTab from './ServicesTab';
import AttendanceTab from './AttendanceTab';

const TABS = [
  { key: 'overview', label: 'Overview', icon: 'LayoutGrid' },
  { key: 'customers', label: 'Customers', icon: 'Users' },
  { key: 'services', label: 'Services', icon: 'Sparkles' },
  { key: 'attendance', label: 'Attendance', icon: 'Clock' },
];

const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

// The inner page of one person in the Therapist performance report (ZNLY-170). It owns the period (starts on the report's), asks the report RPC for
// the same cohort so the score, rank and team markers equal the report row, and asks getTherapistOverview for the booking-level numbers.
const TherapistDetailView = ({ therapistId, therapistName, branchId, onBack, periodId: startPeriod = DEFAULT_REPORT_PERIOD, custom: startCustom = null, onNeedsClosing = null, backLabel = 'Back to Therapist performance' }) => {
  const { staffLabel } = useIndustry();
  const [periodId, setPeriodId] = useState(startPeriod);
  const [custom, setCustom] = useState(startCustom);
  const [activeTab, setActiveTab] = useState('overview');
  const { data: report, loading: reportLoading, range } = useTherapistPerformance(periodId, custom);

  const [ov, setOv] = useState({ data: null, loading: true, error: null });
  const load = useCallback(async () => {
    if (!branchId || !therapistId) return;
    setOv((s) => ({ ...s, loading: true, error: null }));
    const res = await getTherapistOverview({ branchId, therapistId, fromDate: range.from, toDate: range.to });
    setOv({ data: res.data, loading: false, error: res.error ? (res.error.message || 'Failed to load overview.') : null });
  }, [branchId, therapistId, range.from, range.to]);
  useEffect(() => { load(); }, [load]);

  const ranked = useMemo(() => (report?.current ? buildRows(report.current, report.previous) : []), [report]);
  const row = ranked.find((r) => r.id === therapistId) || null;
  const prevRow = (report?.previous?.therapists || []).find((t) => t.therapist_id === therapistId) || null;
  const rank = rankOf(ranked, therapistId);
  const maxSales = Math.max(0, ...ranked.map((r) => Number(r.service_sales)));
  const tabRange = { fromDate: range.from, toDate: range.to };
  const d = ov.data;

  const counts = {
    customers: d ? d.customersAssigned : null,
    services: d ? new Set((d.bookingList || []).filter((b) => b.status === 'Completed').map((b) => b.service)).size : null,
    attendance: row ? `${row.att_days} day${row.att_days === 1 ? '' : 's'}` : null,
  };

  const onPeriod = (id) => { setPeriodId(id); if (id === 'custom' && !custom) setCustom({ from: range.from, to: range.to }); };
  const lower = staffLabel.toLowerCase();

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="inline-flex items-center gap-1 font-body font-body-medium text-sm text-text-secondary hover:text-text-primary spa-transition-fast">
        <Icon name="ChevronLeft" size={16} /><span>{backLabel}</span>
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center font-heading font-heading-semibold text-sm flex-shrink-0">{initials(therapistName)}</div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-heading font-heading-semibold text-xl text-text-primary truncate">{therapistName}</h2>
              {row && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${row.tier.cls}`}>{row.tier.label} · {row.score}</span>}
            </div>
            <p className="font-body text-sm text-text-secondary">
              {staffLabel}{row?.branch_name ? ` · ${row.branch_name}` : ''}{rank ? ` · #${rank.rank} in service sales of ${rank.of} ${rank.of === 1 ? lower : `${lower}s`}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <PeriodPicker periodId={periodId} range={range} onPeriod={onPeriod} onCustom={setCustom} />
          <button type="button" disabled={!d?.bookingList}
            onClick={() => downloadCsv(`${String(therapistName).toLowerCase().replace(/\s+/g, '-')}-bookings-${range.from}-to-${range.to}.csv`, csvRows(d.bookingList))}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-spa border border-border bg-surface text-sm font-body-medium text-text-primary hover:bg-black/[0.03] disabled:opacity-50">
            <Icon name="Download" size={14} />CSV
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-5 border-b border-border">
        {TABS.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`inline-flex items-center gap-1.5 pb-2.5 -mb-px text-sm font-body font-body-medium border-b-2 spa-transition-fast ${activeTab === tab.key ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
            <Icon name={tab.icon} size={14} /><span>{tab.label}</span>
            {counts[tab.key] != null && <span className="rounded-full bg-black/[0.05] px-1.5 text-[11px] text-text-secondary">{counts[tab.key]}</span>}
          </button>
        ))}
      </div>

      <div>
        {activeTab === 'overview' && <OverviewTab row={row} report={report} prevRow={prevRow} maxSales={maxSales} range={range} ov={ov} reportLoading={reportLoading} onRetry={load} onNeedsClosing={onNeedsClosing} />}
        {activeTab === 'customers' && <CustomersTab therapistId={therapistId} branchId={branchId} range={tabRange} />}
        {activeTab === 'services' && <ServicesTab therapistId={therapistId} branchId={branchId} range={tabRange} />}
        {activeTab === 'attendance' && <AttendanceTab therapistId={therapistId} branchId={branchId} range={tabRange} />}
      </div>
    </div>
  );
};

export default TherapistDetailView;
