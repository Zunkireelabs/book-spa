import React, { useMemo, useState } from 'react';
import Icon from 'components/AppIcon';
import { useAuth } from 'contexts/AuthContext';
import { useBranch } from 'contexts/BranchContext';
import { useIndustry } from 'hooks/useIndustry';
import { downloadCsv } from 'utils/csvExport';
import { therapistPerformanceInsights } from 'lib/reportInsights';
import ReportFrame, { DeltaChip, InsightList } from './ReportFrame';
import TherapistDetailView from '../Performance/TherapistDetailView';
import { isReportOpenable } from './reportRegistry';
import { useTherapistPerformance } from './useTherapistPerformance';
import {
  buildRows, buildTiles, sortRows, searchRows, exportRows, isEmptyPerformance, hasPrevious, scoreFormula, num, pctText,
  BUSY_LOW, DEFAULT_SORT, DEFINITIONS,
} from './therapistPerformanceView';

const th = 'px-3 py-2 text-[11px] font-medium text-text-tertiary bg-background border-b border-border whitespace-nowrap';
const td = 'px-3 py-2.5 border-b border-border text-[12.5px] font-data tabular-nums text-right whitespace-nowrap';
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const pct1 = (v) => (v == null ? '—' : `${(Math.round(v * 1000) / 10).toLocaleString('en-IN')}%`);
const fmtWeek = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const TierPill = ({ tier }) => <span className={`ml-1.5 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold font-body ${tier.cls}`}>{tier.label}</span>;

const BusyCell = ({ busy }) => (busy == null
  ? <span className="text-text-tertiary font-body">No hours set</span>
  : (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-8 h-[5px] rounded-full bg-black/[0.06] overflow-hidden"><i className={`block h-full ${busy < BUSY_LOW ? 'bg-accent' : 'bg-primary'}`} style={{ width: `${Math.min(100, busy * 100)}%` }} /></span>
      <span className={busy < BUSY_LOW ? 'text-warning font-semibold' : ''}>{pctText(busy)}</span>
    </span>
  ));

const Person = ({ r, withRank = true, lentTo = null }) => (
  <div className="flex items-center gap-2.5 font-body text-left">
    {withRank && <span className="w-4 text-text-tertiary text-[12px]">{r.rank}</span>}
    <span className="w-[26px] h-[26px] rounded-full bg-black/[0.05] text-text-secondary text-[10.5px] font-semibold flex items-center justify-center flex-shrink-0">{initials(r.name)}</span>
    <div className="min-w-0 max-w-[130px]"><div className="text-[12.5px] text-text-primary truncate">{r.name}</div><div className="text-[11px] text-text-tertiary truncate">{lentTo && r.branch_id !== lentTo ? `from ${r.branch_name}` : r.branch_name}</div></div>
  </div>
);

const SortTh = ({ label, k, sort, onSort, left = false }) => {
  const on = sort.key === k;
  return (
    <th className={`${th} ${left ? 'text-left' : 'text-right'}`} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(k)} className={`inline-flex items-center gap-1 hover:text-text-primary ${on ? 'text-text-primary' : ''}`}>
        {label}<span className="text-[9px]">{on ? (sort.dir === 'asc' ? '▴' : '▾') : ''}</span>
      </button>
    </th>
  );
};

const Spark = ({ values }) => {
  const W = 120; const H = 28;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${values.length < 2 ? W / 2 : (i / (values.length - 1)) * W},${H - 3 - (v / max) * (H - 6)}`).join(' ');
  return <svg viewBox={`0 0 ${W} ${H}`} className="w-[120px] h-[28px] block" role="img" aria-label="Sales by week"><polyline fill="none" stroke="#2D5A27" strokeWidth="1.8" points={pts} vectorEffect="non-scaling-stroke" /></svg>;
};

const TherapistPerformanceReport = ({ periodId, onPeriod, custom, onCustom, reopen, onBack, onHome, onOpenView, titleExtra, isFavourite, onToggleFav }) => {
  const { profile } = useAuth();
  const { switchBranch, branchId: scopeBranchId } = useBranch();
  const { staffLabel, staffLabelPlural } = useIndustry();
  const role = profile?.role;
  const { data, error, loading, range } = useTherapistPerformance(periodId, custom);

  const [tab, setTab] = useState('ranking');
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);    // the row whose inner page is open; tab, sort and search live here, so Back returns to them

  const empty = !loading && !error && isEmptyPerformance(data);
  const ready = !!data?.current && !empty;
  const showBranches = (data?.branches?.length || 0) > 1;
  const activeTab = tab === 'branches' && !showBranches ? 'ranking' : tab;
  const hp = ready && hasPrevious(data);

  const ranked = useMemo(() => (ready ? buildRows(data.current, data.previous) : []), [data, ready]);
  const visibleRows = useMemo(() => sortRows(searchRows(ranked, search), sort), [ranked, search, sort]);
  const insights = useMemo(() => (ready ? therapistPerformanceInsights(data, { staffLabel, staffLabelPlural, periodLabel: range.label }) : []), [data, ready, staffLabel, staffLabelPlural, range.label]);
  const teamById = useMemo(() => new Map(ranked.map((r) => [r.id, r])), [ranked]); // one score per person, whichever branch block they appear in

  const onSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));
  const openFull = (r) => { const t = teamById.get(r.id) || r; setDetail({ id: r.id, name: r.name, branchId: scopeBranchId || r.branch_id, row: { ...t, formula: scoreFormula(t.parts) } }); };

  if (detail) {
    return (
      <div className="content-scroll flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 sm:px-6 lg:px-8 pt-4 pb-10 max-w-[1400px]">
          <TherapistDetailView therapistId={detail.id} therapistName={detail.name} branchId={detail.branchId} onBack={() => setDetail(null)} periodId={periodId} custom={custom} onNeedsClosing={() => onOpenView('money-owed', { section: 'needs-closing', therapist: detail.id, tname: detail.name })} onMoneyOwed={() => onOpenView('money-owed')} />
        </div>
      </div>
    );
  }

  const t = (ready && data.current.team) || {}; // rankingTable is built eagerly, so never null
  const searchBox = (
    <div className="relative max-w-xs w-full">
      <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
      <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${staffLabel.toLowerCase()} by name`} aria-label={`Search ${staffLabel.toLowerCase()} by name`}
        className="w-full h-9 pl-9 pr-3 rounded-spa border border-border bg-surface text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30" />
    </div>
  );
  const noMatch = <p className="px-4 py-8 text-center text-sm text-text-secondary">No {staffLabel.toLowerCase()} matches “{search.trim()}”.</p>;

  const rankingTable = (
    <div className="bg-surface border border-border rounded-spa-lg overflow-x-auto min-w-0">
      <table className="w-full border-collapse">
        <thead><tr>
          <SortTh label={staffLabel} k="name" sort={sort} onSort={onSort} left />
          <SortTh label="Score" k="score" sort={sort} onSort={onSort} />
          <SortTh label="Attendance" k="attendance" sort={sort} onSort={onSort} />
          <SortTh label="Service sales" k="sales" sort={sort} onSort={onSort} />
          <SortTh label="Completed" k="completed" sort={sort} onSort={onSort} />
          <SortTh label="Avg ticket" k="avg_ticket" sort={sort} onSort={onSort} />
          <SortTh label="Busy" k="busy" sort={sort} onSort={onSort} />
          <SortTh label="Rebook" k="rebook" sort={sort} onSort={onSort} />
          <SortTh label="No-show" k="no_show" sort={sort} onSort={onSort} />
        </tr></thead>
        <tbody>
          {visibleRows.map((r) => (
            <tr key={r.id} onClick={() => openFull(r)} className="cursor-pointer hover:bg-black/[0.02]">
              <td className="px-2 py-2.5 border-b border-border"><Person r={r} /></td>
              <td className={td}><b>{r.score}</b><TierPill tier={r.tier} /></td>
              <td className={td}>{pctText(r.attendance) ?? '—'}</td>
              <td className={td}>{num(r.service_sales)}</td>
              <td className={td}>{num(r.completed)}</td>
              <td className={td}>{num(r.avg_ticket)}</td>
              <td className={td}><BusyCell busy={r.busy} /></td>
              <td className={td}>{pctText(r.rebook_rate) ?? '—'}</td>
              <td className={td}>{r.bookings > 0 ? pct1(r.noShowRate) : '—'}</td>
            </tr>
          ))}
          {ready && !search.trim() && (
            <tr>
              <td className="px-3 py-2.5 font-semibold text-[12.5px]">All {t.active}</td><td className={td} />
              <td className={td}>{pctText(t.att_days > 0 ? t.att_present / t.att_days : null) ?? '—'}</td>
              <td className={`${td} font-semibold`}>{num(t.service_sales)}</td><td className={`${td} font-semibold`}>{num(t.completed)}</td>
              <td className={td}>{num(t.avg_ticket)}</td><td className={td}>{t.busy == null ? 'No hours set' : pctText(t.busy)}</td>
              <td className={td}>{pctText(t.rebook_rate) ?? '—'}</td><td className={td}>{t.bookings > 0 ? pct1(t.no_show / t.bookings) : '—'}</td>
            </tr>
          )}
        </tbody>
      </table>
      {visibleRows.length === 0 && noMatch}
    </div>
  );

  const emptyBranches = (data?.branches || []).filter((b) => b.current.therapists.length === 0);
  const branchBlocks = (
    <div className="flex flex-col gap-3.5">
      {(data?.branches || []).filter((b) => b.current.therapists.length > 0).map((b) => {
        // Branch figures, team score: a person has one score everywhere, so a branch block never re-scores them against its own top earner.
        const rows = sortRows(searchRows(buildRows(b.current).map((r) => { const t = teamById.get(r.id); return t ? { ...r, parts: t.parts, score: t.score, tier: t.tier, rank: t.rank } : r; }), search), sort);
        return (
          <div key={b.branch_id} className="bg-surface border border-border rounded-spa-lg overflow-x-auto">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <b className="text-sm font-semibold">{b.name}</b>
              <span className="text-xs text-text-tertiary">{b.current.team.active} {b.current.team.active === 1 ? staffLabel.toLowerCase() : staffLabelPlural.toLowerCase()} · service sales {num(b.current.team.service_sales)}</span>
              <button type="button" onClick={() => switchBranch(b.branch_id)} className="ml-auto text-xs text-primary hover:underline">Open this branch</button>
            </div>
            <table className="w-full border-collapse">
              <thead><tr>
                <th className={`${th} text-left`}>{staffLabel}</th><th className={`${th} text-right`}>Score</th><th className={`${th} text-right`}>Service sales</th>
                <th className={`${th} text-right`}>Completed</th><th className={`${th} text-right`}>Busy</th><th className={`${th} text-right`}>No-show</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => openFull(r)} className="cursor-pointer hover:bg-black/[0.02]">
                    <td className="px-2 py-2.5 border-b border-border"><Person r={r} lentTo={b.branch_id} /></td>
                    <td className={td}><b>{r.score}</b><TierPill tier={r.tier} /></td><td className={td}>{num(r.service_sales)}</td><td className={td}>{num(r.completed)}</td>
                    <td className={td}><BusyCell busy={r.busy} /></td><td className={td}>{r.bookings > 0 ? pct1(r.noShowRate) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <p className="px-4 py-6 text-center text-xs text-text-tertiary">{search.trim() ? `No match in ${b.name}.` : 'Nobody worked here in this period.'}</p>}
          </div>
        );
      })}
      {emptyBranches.length > 0 && <p className="text-xs text-text-tertiary">No activity: {emptyBranches.map((b) => b.name).join(', ')}</p>}
      <p className="text-xs text-text-tertiary flex items-center gap-1.5"><Icon name="MousePointerClick" size={12} /> Figures are for work done at each branch; the score is the same everywhere (ranked across all branches). A lent {staffLabel.toLowerCase()} counts where they worked. Click a row for the full breakdown.</p>
    </div>
  );

  const weeks = data?.weeks || [];
  const trendTable = (
    <div className="bg-surface border border-border rounded-spa-lg overflow-x-auto">
      <table className="w-full border-collapse">
        <thead><tr>
          <th className={`${th} text-left`}>{staffLabel}</th><th className={`${th} text-left`}>Service sales by week · {weeks.length > 0 ? `${fmtWeek(weeks[0])} to ${fmtWeek(weeks[weeks.length - 1])}` : ''}</th>
          <th className={`${th} text-right`}>Total</th><th className={`${th} text-right`}>Best week</th><th className={`${th} text-right`}>vs previous</th>
        </tr></thead>
        <tbody>
          {sortRows(searchRows(ranked, search), { key: 'sales', dir: 'desc' }).map((r) => {
            const v = (r.sales_by_week || []).map(Number);
            const best = v.length ? Math.max(...v) : 0;
            return (
              <tr key={r.id} onClick={() => openFull(r)} className="cursor-pointer hover:bg-black/[0.02]">
                <td className="px-3 py-2.5 border-b border-border"><Person r={r} withRank={false} /></td>
                <td className="px-3 py-2.5 border-b border-border"><Spark values={v} /></td>
                <td className={td}>{num(r.service_sales)}</td><td className={td}>{num(best)}</td>
                <td className={td}>{hp && r.salesDelta ? <DeltaChip delta={r.salesDelta} /> : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {ranked.length > 0 && searchRows(ranked, search).length === 0 && noMatch}
      <p className="px-4 py-2.5 text-[11.5px] text-text-tertiary">Weeks start on Monday; the first and last may be part weeks. Click a row for the full breakdown.</p>
    </div>
  );

  const tabs = ready ? [{ id: 'ranking', label: 'Ranking' }, ...(showBranches ? [{ id: 'branches', label: 'By branch' }] : []), { id: 'trend', label: 'Trend' }] : [];

  return (
    <ReportFrame
      groupLabel="Team" title={`${staffLabel} performance`} subtitle="Who earns, who's busy, who brings customers back. For coaching, not blame."
      titleExtra={titleExtra} reopen={reopen} onBack={onBack} onHome={onHome}
      range={range} periodId={periodId} onPeriod={onPeriod} onCustom={onCustom}
      previousNote={ready && !hp ? `No data for the previous ${range.days} days yet.` : null}
      tiles={ready ? buildTiles(data) : []}
      tabs={tabs} activeTab={activeTab} onTab={setTab}
      definitions={DEFINITIONS}
      isFavourite={isFavourite} onToggleFav={onToggleFav}
      onExport={ready ? () => downloadCsv(`${staffLabel.toLowerCase()}-performance-${range.from}-to-${range.to}${activeTab === 'ranking' ? '' : `-${activeTab}`}.csv`, exportRows(data, activeTab, activeTab === 'trend' ? sortRows(ranked, { key: 'sales', dir: 'desc' }) : visibleRows, staffLabel)) : null}
    >
      {loading && !data && <p className="py-12 text-center text-sm text-text-secondary">Loading…</p>}
      {error && !loading && <p className="py-12 text-center text-sm text-error">Couldn't load {staffLabel.toLowerCase()} performance. Please try again.</p>}
      {empty && (
        <div className="border border-dashed border-border rounded-spa-lg bg-surface p-7 text-center text-sm text-text-secondary leading-relaxed">
          <b className="block text-text-primary mb-1">No {staffLabel.toLowerCase()} activity in {range.label.toLowerCase()}</b>
          No bookings or working hours fall between {fmtWeek(range.from)} and {fmtWeek(range.to)}. Pick a longer period or another branch.
        </div>
      )}
      {ready && (
        <>
          <InsightList insights={insights} canOpen={(v) => isReportOpenable(v, role)} onOpen={onOpenView} />
          <div className="flex items-center gap-3 flex-wrap print:hidden">
            {searchBox}
            <span className="text-xs text-text-tertiary">{activeTab === 'branches' ? `${data.branches.length - emptyBranches.length} branches with activity${emptyBranches.length ? ` · ${emptyBranches.length} without` : ''}` : `${visibleRows.length} ${visibleRows.length === 1 ? staffLabel.toLowerCase() : staffLabelPlural.toLowerCase()}`}</span>
          </div>
          {activeTab === 'ranking' && rankingTable}
          {activeTab === 'branches' && branchBlocks}
          {activeTab === 'trend' && trendTable}
          <p className="text-xs text-text-tertiary">Score = sales 40 + completion 25 + attendance 20 + busy 15 (0–100); a part with no data is left out and the rest rescaled. Low values show amber, never red: this report is for coaching.</p>
        </>
      )}
    </ReportFrame>
  );
};

export default TherapistPerformanceReport;
