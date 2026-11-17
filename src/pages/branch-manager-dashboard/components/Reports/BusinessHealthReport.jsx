import React, { useMemo, useState } from 'react';
import Icon from 'components/AppIcon';
import { useAuth } from 'contexts/AuthContext';
import { useBranch } from 'contexts/BranchContext';
import { useIndustry } from 'hooks/useIndustry';
import { computeDelta } from 'utils/reportPeriod';
import { downloadCsv } from 'utils/csvExport';
import { businessHealthInsights } from 'lib/reportInsights';
import ReportFrame, { DeltaChip, InsightList } from './ReportFrame';
import { isReportOpenable } from './reportRegistry';
import { useBusinessHealth } from './useBusinessHealth';
import { buildTiles, buildBridge, hasPreviousData, methodSlices, bookingFunnel, isEmptyPeriod, exportRows, num, pctText, DEFINITIONS } from './businessHealthView';
import { wordBranch, wordBranchCap, wordBranches, wordBranchesCap } from '../../../../utils/industryTerms';

const Card = ({ title, meta, children }) => (
  <div className="bg-surface border border-border rounded-spa-lg">
    <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
      <b className="text-sm font-semibold text-text-primary">{title}</b>
      {meta && <span className="ml-auto text-xs text-text-tertiary">{meta}</span>}
    </div>
    {children}
  </div>
);

const fmtDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

// Sales per day, this period solid and the previous one dashed. The two series are index-aligned (day 1 vs day 1).
const TrendChart = ({ cur = [], prev = [] }) => {
  const W = 600; const H = 150; const PAD = 14;
  const max = Math.max(1, ...cur.map((d) => Number(d.sales)), ...prev.map((d) => Number(d.sales)));
  const pts = (arr) => arr.map((d, i) => `${arr.length < 2 ? W / 2 : (i / (arr.length - 1)) * W},${H - PAD - (Number(d.sales) / max) * (H - PAD * 2)}`).join(' ');
  const ticks = cur.length ? [0, 0.25, 0.5, 0.75, 1].map((f) => cur[Math.round(f * (cur.length - 1))]).filter(Boolean) : [];
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[170px] block px-4 pt-2.5" role="img" aria-label="Sales by day, this period against the previous period">
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="#F4F4F6" />)}
        <polyline fill="none" stroke="#C9C9CF" strokeWidth="1.6" strokeDasharray="4 4" points={pts(prev)} vectorEffect="non-scaling-stroke" />
        <polyline fill="none" stroke="#2D5A27" strokeWidth="2.2" points={pts(cur)} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10.5px] text-text-tertiary px-4 pb-3 pt-0.5">{ticks.map((d) => <span key={d.d}>{fmtDay(d.d)}</span>)}</div>
    </>
  );
};

const BridgeCard = ({ c }) => (
  <Card title="Sales → Cash in" meta="why they differ">
    <div className="py-1">
      {buildBridge(c).map((r, i) => (r.sub
        ? <div key={i} className="px-4 pl-7 py-0.5 text-xs text-text-tertiary">{r.sub}</div>
        : (
          <div key={i} className={`flex justify-between px-4 py-2 text-[13px] ${r.total ? 'border-t border-border mt-1 pt-2.5' : ''}`}>
            <span className={r.total ? 'font-semibold text-text-primary' : 'text-text-secondary'}>{r.label}</span>
            <b className={`font-data tabular-nums ${r.total ? 'font-semibold text-sm' : 'font-medium'}`}>{r.value}</b>
          </div>
        )))}
    </div>
    <p className="px-4 pb-3 text-[11.5px] text-text-tertiary">
      Not paid yet → Money owed{c.owed?.count > 0 && ` (NPR ${num(c.owed.amount)} on ${c.owed.count} booking${c.owed.count > 1 ? 's' : ''} right now)`}.
    </p>
  </Card>
);

const MethodCard = ({ by, refunds }) => {
  const slices = methodSlices(by);
  return (
    <Card title="Cash in by method">
      {slices.length === 0 ? <p className="px-4 pb-4 text-xs text-text-tertiary">No money received in this period.</p> : (
        <>
          <div className="flex h-2.5 rounded-full overflow-hidden mx-4 mt-1 mb-2" role="img" aria-label="Cash in by method">
            {slices.map((s) => <i key={s.key} style={{ width: `${s.share * 100}%`, background: s.color }} />)}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 text-[11.5px] text-text-secondary">
            {slices.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-sm inline-block" style={{ background: s.color }} />{s.label} {num(s.amount)}</span>)}
          </div>
          {Number(refunds) > 0 && <p className="px-4 pb-3 text-[11.5px] text-text-tertiary">Refunds of {num(refunds)} come off these.</p>}
        </>
      )}
    </Card>
  );
};

const FunnelCard = ({ c }) => {
  const f = bookingFunnel(c);
  return (
    <Card title="Bookings" meta={`${num(f.made)} made`}>
      <div className="flex flex-col gap-2 px-4 py-3">
        {f.rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[90px_1fr_50px] gap-2.5 items-center text-[12.5px]">
            <span>{r.label}</span>
            <div className="h-2 rounded-full bg-black/[0.05] overflow-hidden"><i className="block h-full" style={{ width: `${r.share * 100}%`, background: r.color }} /></div>
            <b className={`font-data tabular-nums font-medium text-right`}>{num(r.n)}</b>
          </div>
        ))}
      </div>
      <p className="px-4 pb-3 text-[11.5px] text-text-tertiary">Bookings tile = {num(f.made)} − {num(c.cancelled)} cancelled = {num(c.bookings)}.</p>
    </Card>
  );
};

const BranchesTable = ({ data, onPickBranch }) => {
  const rows = data.branches || [];
  const hasPrev = hasPreviousData(data);
  const cell = `px-3.5 py-2.5 border-b border-border text-right font-data tabular-nums text-[12.5px]`;
  const line = (key, name, cur, prev, bold, onClick) => {
    const d = hasPrev ? computeDelta(cur.sales, prev.sales) : null;
    const share = cur.busy?.share;
    return (
      <tr key={key} onClick={onClick} className={onClick ? 'cursor-pointer hover:bg-black/[0.02]' : ''}>
        <td className={`${cell} !text-left !font-body ${bold ? 'font-semibold' : ''}`}>{name}</td>
        <td className={`${cell} ${bold ? 'font-semibold' : ''}`}>{num(cur.sales)}</td>
        <td className={cell}>{d ? <DeltaChip delta={d} /> : ''}</td>
        <td className={cell}>{num(cur.bookings)}</td>
        <td className={cell}>{num(cur.avg_ticket)}</td>
        <td className={cell}>{share == null ? 'No hours set' : (
          <><span className="inline-block w-14 h-[5px] rounded-full bg-black/[0.06] overflow-hidden align-middle mr-1.5"><i className="block h-full bg-primary" style={{ width: `${Math.min(100, share * 100)}%` }} /></span>{pctText(share)}</>
        )}</td>
        <td className={cell}>{pctText(cur.return_rate?.rate) ?? '—'}</td>
        <td className={cell}>{num(cur.owed?.amount ?? 0)}</td>
      </tr>
    );
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>{[`${wordBranchCap()}`, 'Sales', 'vs prev', 'Bookings', 'Avg ticket', 'Busy', 'Return rate', 'Owed'].map((h, i) => (
            <th key={h} className={`px-3.5 py-2 text-[11px] font-medium text-text-tertiary bg-background border-b border-border ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((b) => line(b.branch_id, b.name, b.current, b.previous, false, () => onPickBranch(b.branch_id)))}
          {line('all', `All ${wordBranches()}`, data.current, data.previous, true, null)}
        </tbody>
      </table>
    </div>
  );
};

const BusinessHealthReport = ({ periodId, onPeriod, custom, onCustom, reopen, onBack, onHome, onOpenView, titleExtra, isFavourite, onToggleFav }) => {
  const { profile } = useAuth();
  const { switchBranch } = useBranch();
  const { staffLabel } = useIndustry();
  const role = profile?.role;
  const { data, error, loading, range } = useBusinessHealth(periodId, true, custom);
  const [tab, setTab] = useState('summary');

  const showBranches = (data?.branches?.length || 0) > 1;
  const activeTab = showBranches ? tab : 'summary';
  const empty = !loading && !error && isEmptyPeriod(data);
  const insights = useMemo(() => (data?.current ? businessHealthInsights(data, { staffLabel, periodLabel: range.label }) : []), [data, staffLabel, range.label]);
  const canOpen = (view) => isReportOpenable(view, role);
  const insightList = <InsightList insights={insights} canOpen={canOpen} onOpen={onOpenView} />;
  const ready = !!data?.current && !empty;

  return (
    <ReportFrame
      groupLabel="Overview" title="Business health" subtitle="What you earned, what came in, and how busy you were, vs the previous period."
      titleExtra={titleExtra} reopen={reopen} onBack={onBack} onHome={onHome}
      range={range} periodId={periodId} onPeriod={onPeriod} onCustom={onCustom}
      previousNote={ready && !hasPreviousData(data) ? `No data for the previous ${range.days} days yet.` : null}
      tiles={ready ? buildTiles(data) : []}
      tabs={ready && showBranches ? [{ id: 'summary', label: 'Summary' }, { id: 'branches', label: `${wordBranchesCap()}` }] : []} activeTab={activeTab} onTab={setTab}
      definitions={DEFINITIONS}
      isFavourite={isFavourite} onToggleFav={onToggleFav}
      onExport={ready ? () => downloadCsv(`business-health-${range.from}-to-${range.to}${activeTab === 'branches' ? '-branches' : ''}.csv`, exportRows(data, activeTab, range.label)) : null}
    >
      {loading && !data && <p className="py-12 text-center text-sm text-text-secondary">Loading…</p>}
      {error && !loading && <p className="py-12 text-center text-sm text-error">Couldn't load Business health. Please try again.</p>}
      {empty && (
        <div className="border border-dashed border-border rounded-spa-lg bg-surface p-7 text-center text-sm text-text-secondary leading-relaxed">
          <b className="block text-text-primary mb-1">Nothing recorded for {range.label.toLowerCase()}</b>
          No bookings, sales or payments fall between {fmtDay(range.from)} and {fmtDay(range.to)}. Pick a longer period or another {wordBranch()}.
        </div>
      )}
      {ready && activeTab === 'summary' && (
        <div className="grid lg:grid-cols-[1.6fr_1fr] gap-3.5 items-start">
          <div className="flex flex-col gap-3.5 min-w-0">
            <Card title="Sales by day" meta={<><span className="text-primary">—</span> this period &nbsp;<span>┄ previous period</span></>}>
              <TrendChart cur={data.by_day?.current} prev={data.by_day?.previous} />
            </Card>
            {insightList}
          </div>
          <div className="flex flex-col gap-3.5 min-w-0">
            <BridgeCard c={data.current} />
            <MethodCard by={data.current.by_method} refunds={data.current.refunds} />
            <FunnelCard c={data.current} />
          </div>
        </div>
      )}
      {ready && activeTab === 'branches' && (
        <div className="flex flex-col gap-3.5">
          {insightList}
          <div className="bg-surface border border-border rounded-spa-lg overflow-hidden">
            <BranchesTable data={data} onPickBranch={(id) => { switchBranch(id); setTab('summary'); }} />
          </div>
          <p className="text-xs text-text-tertiary flex items-center gap-1.5"><Icon name="MousePointerClick" size={12} /> Click a {wordBranch()} to open its Summary. {wordBranchCap()} rows add up to All {wordBranches()}.</p>
        </div>
      )}
    </ReportFrame>
  );
};

export default BusinessHealthReport;
