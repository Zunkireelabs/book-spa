import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from 'components/AppIcon';
import { useAuth } from 'contexts/AuthContext';
import { useBranch } from 'contexts/BranchContext';
import AreaLayout, { AreaPage, menuRow } from '../Area/AreaLayout';
import { REPORT_CATEGORIES, getReportByView, canOpenReport, getVisibleReports } from './reportRegistry';

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

// Reports area: an internal menu (lg+), a searchable catalogue with favourites, and a slim header over each report panel.
// `renderReport(view)` returns the (unchanged) panel for a registry view.
const ReportsLayout = ({ view, renderReport }) => {
  const [params, setParams] = useSearchParams();
  const { profile } = useAuth();
  const { branchName, isOverall } = useBranch();
  const role = profile?.role;
  const userId = profile?.id;

  const [favs, setFavs] = useState(() => readJSON(favKey(userId), []));
  useEffect(() => { setFavs(readJSON(favKey(userId), [])); }, [userId]);
  const toggleFav = useCallback((id) => {
    setFavs((prev) => { const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]; writeJSON(favKey(userId), next); return next; });
  }, [userId]);

  const [query, setQuery] = useState('');
  const visible = useMemo(() => getVisibleReports(role), [role]);
  const favCount = visible.filter((r) => favs.includes(r.id)).length;
  const tab = params.get('tab');
  const go = (v, extra = {}) => setParams({ view: v, ...extra });
  const openCatalogue = () => go('all-reports');

  const report = view === 'all-reports' ? null : getReportByView(view);
  const scope = isOverall ? 'all branches' : (branchName || 'this branch');
  const cats = REPORT_CATEGORIES.map((c) => ({ ...c, items: visible.filter((r) => r.category === c.id) })).filter((c) => c.items.length);

  // Rows above the category list (the shared AreaLayout renders the categories themselves).
  const menuTop = (
    <>
      <button type="button" className={menuRow(view === 'all-reports' && tab !== 'favourites')} onClick={openCatalogue}>
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

  // ── Catalogue ──
  const renderCatalogue = (reopen) => {
    const q = query.trim().toLowerCase();
    const base = tab === 'favourites' ? visible.filter((r) => favs.includes(r.id)) : visible;
    const matches = q ? base.filter((r) => `${r.title} ${r.description}`.toLowerCase().includes(q)) : base;
    const groups = REPORT_CATEGORIES.map((c) => ({ ...c, items: matches.filter((r) => r.category === c.id) })).filter((c) => c.items.length);
    return (
      <>
        <div className="px-4 sm:px-6 lg:px-8 pt-5 pb-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            {reopen}
            <h1 className="font-heading font-heading-semibold text-xl text-text-primary">{tab === 'favourites' ? 'Favourites' : 'All reports'}</h1>
            <span className="px-2 py-0.5 rounded-full bg-black/[0.05] text-[11px] font-medium text-text-secondary tabular-nums">{base.length}</span>
          </div>
          <p className="mt-1 text-[13px] text-text-secondary">{tab === 'favourites' ? 'Your starred reports.' : `Every report for ${scope}.`}</p>
          <div className="relative mt-4 max-w-md">
            <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search reports"
              aria-label="Search reports"
              className="w-full h-9 pl-9 pr-3 rounded-spa-lg border border-border bg-surface text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>
        <div className="content-scroll flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 lg:px-8 py-5">
          {matches.length === 0 ? (
            <p className="py-12 text-center text-sm text-text-secondary">
              {q ? `No reports match “${query.trim()}”.` : 'Star a report to pin it here.'}
            </p>
          ) : groups.map((g) => (
            <section key={g.id} className="mb-6">
              <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">{g.label}</h2>
              <div className="border border-border rounded-spa-lg divide-y divide-border overflow-hidden bg-surface">
                {g.items.map((r) => (
                  <div
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => go(r.view)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(r.view); } }}
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-black/[0.02] focus:outline-none focus-visible:bg-black/[0.03]"
                  >
                    <span className="w-10 h-10 rounded-spa-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                      <Icon name={r.icon} size={18} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-text-primary">{r.title}</span>
                      <span className="block text-[13px] text-text-secondary">{r.description}</span>
                    </span>
                    <Star on={favs.includes(r.id)} onToggle={() => toggleFav(r.id)} label={r.title} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </>
    );
  };

  // ── A report ──
  const renderReportPage = (reopen) => {
    const allowed = canOpenReport(report, role);
    return (
      <AreaPage
        title={report.title}
        description={report.description}
        titleExtra={<Star on={favs.includes(report.id)} onToggle={() => toggleFav(report.id)} label={report.title} />}
        backLabel="Reports"
        onBack={openCatalogue}
        reopen={reopen}
      >
        {allowed ? renderReport(report.view) : (
          <p className="py-12 text-center text-sm text-text-secondary">This report isn't available for your role.</p>
        )}
      </AreaPage>
    );
  };

  return (
    <AreaLayout title="Reports" menuStorageKey={MENU_KEY} menuTop={menuTop} categories={cats} activeView={view} onNavigate={(v) => go(v)}>
      {({ reopen }) => (report ? renderReportPage(reopen) : renderCatalogue(reopen))}
    </AreaLayout>
  );
};

export default ReportsLayout;
