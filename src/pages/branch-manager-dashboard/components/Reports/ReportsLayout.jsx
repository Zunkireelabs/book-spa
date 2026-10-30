import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from 'components/AppIcon';
import { useAuth } from 'contexts/AuthContext';
import { useBranch } from 'contexts/BranchContext';
import { useIndustry } from 'hooks/useIndustry';
import { DEFAULT_REPORT_PERIOD, REPORT_PERIODS } from 'utils/reportPeriod';
import AreaLayout, { AreaPage, menuRow } from '../Area/AreaLayout';
import { START_HERE, fillLabels, getReportByView, getReportTabs, canOpenReport, getVisibleReports, getVisibleGroups, migrateFavourites } from './reportRegistry';
import BusinessHealthReport from './BusinessHealthReport';
import { useBusinessHealth } from './useBusinessHealth';
import { DeltaChip, PeriodPicker } from './ReportFrame';
import { buildTiles, num, isEmptyPeriod, hasPreviousData } from './businessHealthView';

const MENU_KEY = 'zennly.reports.menu';
const favKey = (userId) => `zennly.reports.favs.${userId || 'anon'}`;

const readJSON = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const writeJSON = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };

const Star = ({ on, onToggle, label, className = '' }) => (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); onToggle(); }}
    aria-pressed={on}
    aria-label={on ? `Remove ${label} from favourites` : `Add ${label} to favourites`}
    title={on ? 'Remove from favourites' : 'Add to favourites'}
    className={`p-1.5 rounded-spa hover:bg-black/[0.05] spa-transition-fast ${on ? 'text-warning' : 'text-text-tertiary hover:text-text-secondary'} ${className}`}
  >
    <Icon name="Star" size={16} fill={on ? 'currentColor' : 'none'} />
  </button>
);

// Sparkline of Sales by day for the Start here card (this period solid, previous dashed).
const Spark = ({ cur = [], prev = [] }) => {
  const max = Math.max(1, ...cur.map((d) => Number(d.sales)), ...prev.map((d) => Number(d.sales)));
  const pts = (a) => a.map((d, i) => `${a.length < 2 ? 150 : (i / (a.length - 1)) * 300},${30 - (Number(d.sales) / max) * 26}`).join(' ');
  return (
    <svg className="w-full h-[34px]" viewBox="0 0 300 34" preserveAspectRatio="none" aria-hidden="true">
      <polyline fill="none" stroke="#C9C9CF" strokeWidth="1.5" strokeDasharray="3 3" points={pts(prev)} vectorEffect="non-scaling-stroke" />
      <polyline fill="none" stroke="#2D5A27" strokeWidth="2" points={pts(cur)} vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

// Reports area: an internal menu (lg+), a home (Start here + one card per report), and each report in its frame.
// `renderReport(view)` returns the (unchanged) legacy panel for a registry view; Business health is built on ReportFrame and renders itself.
const ReportsLayout = ({ view, renderReport }) => {
  const [params, setParams] = useSearchParams();
  const { profile } = useAuth();
  const { branchName, isOverall } = useBranch();
  const { staffLabel, staffLabelPlural } = useIndustry();
  const role = profile?.role;
  const userId = profile?.id;
  const labels = useMemo(() => ({ staffLabel, staffLabelPlural }), [staffLabel, staffLabelPlural]);
  const L = useCallback((text) => fillLabels(text, labels), [labels]);

  const [favs, setFavs] = useState(() => migrateFavourites(readJSON(favKey(userId), [])));
  useEffect(() => { setFavs(migrateFavourites(readJSON(favKey(userId), []))); }, [userId]);
  const toggleFav = useCallback((id) => {
    setFavs((prev) => { const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]; writeJSON(favKey(userId), next); return next; });
  }, [userId]);

  const [query, setQuery] = useState('');
  const visible = useMemo(() => getVisibleReports(role), [role]);
  const groups = useMemo(() => getVisibleGroups(role), [role]);
  const favCount = visible.filter((r) => favs.includes(r.id)).length;
  const tab = params.get('tab');
  const periodParam = params.get('period');
  const periodId = REPORT_PERIODS.some((p) => p.id === periodParam) ? periodParam : DEFAULT_REPORT_PERIOD;
  const customFrom = params.get('from');
  const customTo = params.get('to');
  const custom = useMemo(() => (customFrom && customTo ? { from: customFrom, to: customTo } : null), [customFrom, customTo]);
  const periodExtra = periodParam ? { period: periodParam, ...(periodParam === 'custom' && custom ? custom : {}) } : {};
  const go = (v, extra = {}) => setParams({ view: v, ...periodExtra, ...extra });
  const setPeriod = (p) => setParams({ view, ...(tab ? { tab } : {}), period: p, ...(p === 'custom' ? { from: health.range.from, to: health.range.to } : {}) });
  const setCustom = (c) => setParams({ view, ...(tab ? { tab } : {}), period: 'custom', from: c.from, to: c.to });
  const openHome = () => go('all-reports');

  const report = view === 'all-reports' ? null : getReportByView(view);
  const scope = isOverall ? 'all branches' : (branchName || 'this branch');
  const menuGroups = groups.map((g) => ({ ...g, items: g.items.map((r) => ({ ...r, title: L(r.title) })) }));
  const needsHealth = !report && visible.some((r) => r.id === 'business-health');
  const health = useBusinessHealth(periodId, needsHealth, custom);

  const menuTop = (
    <>
      <button type="button" className={menuRow(view === 'all-reports' && tab !== 'favourites')} onClick={openHome}>
        <Icon name="LayoutList" size={15} className="flex-shrink-0" />
        <span className="flex-1">All reports</span>
        <span className="text-[11px] text-text-tertiary tabular-nums">{visible.length}</span>
      </button>
      <button type="button" className={`${menuRow(view === 'all-reports' && tab === 'favourites')} mt-0.5`} onClick={() => go('all-reports', { tab: 'favourites' })}>
        <Icon name="Star" size={15} className="flex-shrink-0" />
        <span className="flex-1">Favourites</span>
        <span className="text-[11px] text-text-tertiary tabular-nums">{favCount}</span>
      </button>
      <div className="h-px bg-border my-3" />
    </>
  );

  // ── Home ──
  const PeriodPick = (
    <div className="ml-auto"><PeriodPicker periodId={periodId} range={health.range} onPeriod={setPeriod} onCustom={setCustom} /></div>
  );

  const healthNumbers = (() => {
    const d = health.data;
    if (!d?.current || isEmptyPeriod(d)) return null;
    const t = Object.fromEntries(buildTiles(d).map((x) => [x.key, x]));
    return { d, t };
  })();

  // What customers still owe right now, from the same call as Business health (no new query). Null until it has loaded.
  const owed = health.data?.current?.owed || null;

  const StartHere = ({ r }) => {
    const isHealth = r.id === 'business-health';
    return (
      <div role="button" tabIndex={0} onClick={() => go(r.view)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(r.view); } }}
        className="bg-surface border border-border rounded-spa-lg px-4 py-4 flex flex-col gap-1.5 cursor-pointer hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
        <div className="flex items-center gap-2 font-medium text-[13px] text-text-secondary">
          <span className="w-[26px] h-[26px] rounded-spa bg-primary/10 text-primary flex items-center justify-center"><Icon name={r.icon} size={15} /></span>
          {L(r.title)}
          <Icon name="ChevronRight" size={14} className="ml-auto text-text-tertiary" />
        </div>
        {isHealth && healthNumbers ? (
          <>
            <div className="flex items-baseline gap-2"><span className={`font-data tabular-nums text-2xl font-semibold tracking-tight`}>NPR {healthNumbers.t.sales.value}</span><DeltaChip delta={healthNumbers.t.sales.delta} /></div>
            <div className="text-xs text-text-tertiary">Sales (earned){healthNumbers.t.sales.prevText ? ` · ${healthNumbers.t.sales.prevText.replace('vs ', 'vs NPR ')} previous ${health.range.days} days` : ''}</div>
            <Spark cur={healthNumbers.d.by_day?.current} prev={healthNumbers.d.by_day?.previous} />
            <div className="grid grid-cols-4 gap-2 mt-1.5 pt-2.5 border-t border-black/[0.05]">
              {[['Bookings', 'bookings'], ['Avg ticket', 'avg_ticket'], ['Busy', 'busy'], ['Return rate', 'return_rate']].map(([label, k]) => (
                <div key={k} className="text-[11px] text-text-tertiary whitespace-nowrap">{label}
                  <b className={`block font-data tabular-nums text-[13.5px] text-text-primary font-semibold mt-0.5`}>{healthNumbers.t[k].value}</b>
                  <DeltaChip delta={healthNumbers.t[k].delta} />
                </div>
              ))}
            </div>
          </>
        ) : r.id === 'money-owed' && owed ? (
          <>
            <div className={`font-data tabular-nums text-2xl font-semibold tracking-tight`}>NPR {num(owed.amount)}</div>
            <div className="text-xs text-text-tertiary">{owed.count} booking{owed.count === 1 ? '' : 's'} · Completed, not fully paid</div>
          </>
        ) : (
          <div className="text-[13px] text-text-secondary">
            {isHealth && health.loading ? 'Loading…' : isHealth && health.data && isEmptyPeriod(health.data) ? 'Nothing recorded for this period yet.' : L(r.subtitle)}
          </div>
        )}
      </div>
    );
  };

  const renderHome = (reopen) => {
    const q = query.trim().toLowerCase();
    const base = tab === 'favourites' ? visible.filter((r) => favs.includes(r.id)) : visible;
    const matches = q ? base.filter((r) => `${L(r.title)} ${L(r.subtitle)} ${r.keywords || ''}`.toLowerCase().includes(q)) : base;
    const shown = groups.map((g) => ({ ...g, items: matches.filter((r) => r.group === g.id) })).filter((g) => g.items.length);
    const startHere = !q && tab !== 'favourites' ? START_HERE.map((id) => visible.find((r) => r.id === id)).filter(Boolean) : [];
    return (
      <>
        <div className="px-4 sm:px-6 lg:px-8 pt-5 pb-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            {reopen}
            <h1 className="font-heading font-heading-semibold text-xl text-text-primary">{tab === 'favourites' ? 'Favourites' : 'Reports'}</h1>
            <span className="px-2 py-0.5 rounded-full bg-black/[0.05] text-[11px] font-medium text-text-secondary tabular-nums">{base.length}</span>
            {needsHealth && PeriodPick}
          </div>
          <p className="mt-1 text-[13px] text-text-secondary">{tab === 'favourites' ? 'Your starred reports.' : `How ${scope === 'all branches' ? 'the business is' : `${scope} is`} doing, and where to look next.`}</p>
          <div className="relative mt-4 max-w-md">
            <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search reports" aria-label="Search reports"
              className="w-full h-9 pl-9 pr-3 rounded-spa-lg border border-border bg-surface text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
        </div>
        <div className="content-scroll flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 lg:px-8 py-5">
          {matches.length === 0 ? (
            <p className="py-12 text-center text-sm text-text-secondary">{q ? `No reports match “${query.trim()}”.` : 'Star a report to pin it here.'}</p>
          ) : (
            <>
              {startHere.length > 0 && (
                <section className="mb-6">
                  <div className="mb-2 flex items-baseline gap-2"><b className="text-[13px] font-semibold">Start here</b><span className="text-xs text-text-tertiary">The reports owners open most</span></div>
                  <div className="grid gap-3 md:grid-cols-[1.3fr_1fr_1fr]">{startHere.map((r) => <StartHere key={r.id} r={r} />)}</div>
                </section>
              )}
              {shown.map((g) => (
                <section key={g.id} className="mb-6">
                  <div className="mb-2 flex items-baseline gap-2"><b className="text-[13px] font-semibold">{g.label}</b><span className="text-xs text-text-tertiary">{g.items.length} report{g.items.length > 1 ? 's' : ''}</span></div>
                  <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                    {g.items.map((r) => (
                      <div key={r.id} role="button" tabIndex={0} onClick={() => go(r.view)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(r.view); } }}
                        className="bg-surface border border-border rounded-spa-lg px-3.5 py-3 min-h-[96px] flex flex-col gap-1 cursor-pointer hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
                        <div className="flex items-center gap-2 font-semibold text-[13px]">
                          <span className="w-[26px] h-[26px] rounded-spa bg-black/[0.05] text-text-secondary flex items-center justify-center flex-shrink-0"><Icon name={r.icon} size={14} /></span>
                          <span className="truncate">{L(r.title)}</span>
                          <Star on={favs.includes(r.id)} onToggle={() => toggleFav(r.id)} label={L(r.title)} className="ml-auto" />
                        </div>
                        <div className="text-[11.5px] text-text-tertiary leading-snug">{L(r.subtitle)}</div>
                        {r.id === 'business-health' && healthNumbers && (
                          <div className="mt-auto pt-1.5 flex items-baseline gap-1.5"><b className={`font-data tabular-nums text-[15px] font-semibold`}>NPR {healthNumbers.t.sales.value}</b><small className="text-[11px] text-text-tertiary">sales</small></div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}
        </div>
      </>
    );
  };

  // ── A report ──
  const renderReportPage = (reopen) => {
    const allowed = canOpenReport(report, role, view);
    if (report.status === 'live') {
      return allowed ? (
        <BusinessHealthReport
          periodId={periodId} onPeriod={setPeriod} custom={custom} onCustom={setCustom} reopen={reopen} onBack={openHome} onHome={openHome} onOpenView={(v) => go(v)}
          isFavourite={favs.includes(report.id)} onToggleFav={() => toggleFav(report.id)}
        />
      ) : <p className="py-12 text-center text-sm text-text-secondary">This report isn't available for your role.</p>;
    }
    const tabs = getReportTabs(report, role);
    return (
      <AreaPage
        title={L(report.title)}
        description={L(report.subtitle)}
        titleExtra={<Star on={favs.includes(report.id)} onToggle={() => toggleFav(report.id)} label={L(report.title)} />}
        backLabel="Reports"
        onBack={openHome}
        reopen={reopen}
        tabs={tabs.length > 1 ? (
          <div className="flex gap-5 mt-2 border-b border-border -mb-3" role="tablist">
            {tabs.map((t) => (
              <button key={t.view} type="button" role="tab" aria-selected={view === t.view} onClick={() => go(t.view)}
                className={`py-2 -mb-px text-[13px] font-medium border-b-2 ${view === t.view ? 'text-text-primary border-primary' : 'text-text-tertiary border-transparent hover:text-text-secondary'}`}>{t.label}</button>
            ))}
          </div>
        ) : null}
      >
        {allowed ? renderReport(view) : (
          <p className="py-12 text-center text-sm text-text-secondary">This report isn't available for your role.</p>
        )}
      </AreaPage>
    );
  };

  return (
    <AreaLayout title="Reports" menuStorageKey={MENU_KEY} menuTop={menuTop} categories={menuGroups} activeView={report ? report.view : view} onNavigate={(v) => go(v)}>
      {({ reopen }) => (report ? renderReportPage(reopen) : renderHome(reopen))}
    </AreaLayout>
  );
};

export default ReportsLayout;
