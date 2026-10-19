import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import { useAuth } from '../../../../contexts/AuthContext';
import { useBranch } from '../../../../contexts/BranchContext';
import { fetchPackages, fetchPackageTypes } from '../../../../services/api';
import { leadParts } from '../../../../services/packagesView';
import { nepalNow } from '../../../../utils/customerDirectory';
import { friendlyError } from '../../../../utils/friendlyError';
import { getAreaForView, getVisibleTabs } from '../Area/areaTabsRegistry';
import PackageListPanel from './PackageListPanel';
import PackageOverviewPanel from './PackageOverviewPanel';
import NewPackagePanel from './NewPackagePanel';

// Packages (V20): one header (title, lead sentence, Export + Sell package) over two counted tabs, Guest packages and Package types.
// Both tabs share one load (packages + every package type, hidden ones included) so the tab counts and the types tab's
// "N active / M sold" agree with the list. Everything is scoped to the selected branch; "All branches" shows them all.
const PackagesPage = ({ view, branchId, readOnly = false }) => {
  const { profile } = useAuth();
  const { isOverall } = useBranch();
  const role = profile?.role;
  const canExport = role === 'manager' || role === 'admin';

  const [packages, setPackages] = useState(null);
  const [types, setTypes] = useState(null);
  const [error, setError] = useState(null);
  const [today, setToday] = useState(() => nepalNow().today);
  const [sell, setSell] = useState(null); // { customer?, typeId? } while the Sell package panel is open
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    const [pk, ty] = await Promise.all([fetchPackages(), fetchPackageTypes({ includeInactive: true })]);
    setToday(nepalNow().today);
    if (pk.error || ty.error) { setError(friendlyError(pk.error || ty.error, 'Failed to load packages.')); return; }
    setPackages(pk.data || []);
    setTypes(ty.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const notify = useCallback((msg, type = 'success') => setToast({ msg, type, at: Date.now() }), []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const scoped = useMemo(() => (packages ? (isOverall ? packages : packages.filter((p) => p.branchId === branchId)) : null), [packages, isOverall, branchId]);

  // Tabs stick at the top of the one scroller; the active tab's toolbar and column headings stick under them.
  const rootRef = useRef(null);
  const tabsRef = useRef(null);
  const [tabsH, setTabsH] = useState(39);
  useEffect(() => {
    const el = tabsRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setTabsH(Math.ceil(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }
    const sc = rootRef.current?.closest('.content-scroll');
    if (sc) sc.scrollTop = 0;
  }, [view]);

  // The active tab registers { run, disabled }; only a change in whether Export can run re-renders the header.
  const exportRef = useRef(null);
  const [exportReady, setExportReady] = useState(false);
  const registerExport = useCallback((api) => { exportRef.current = api; setExportReady(!!api && !api.disabled); }, []);

  const area = getAreaForView(view);
  const tabs = area ? getVisibleTabs(area, { role, isOverall }) : [];
  const counts = { packages: scoped?.length, 'package-overview': types?.length };
  const lead = view === 'packages'
    ? (scoped ? leadParts(scoped, today).map((part, i) => (part.strong ? <b key={i} className="font-medium text-[#515152]">{part.strong}</b> : <React.Fragment key={i}>{part.text}</React.Fragment>)) : ' ')
    : 'The packages you offer. Guests buy them up front and use the sessions over time.';

  const openSell = useCallback((prefill = {}) => setSell(prefill), []);
  const childProps = { packages: scoped, types, today, error, onRetry: load, onChanged: load, readOnly, isOverall, branchId, role, stickyTop: tabsH, onSell: openSell, notify, registerExport };

  return (
    <div ref={rootRef} className="pb-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-[-0.45px] text-text-primary">Packages</h1>
          <p className="text-[13px] text-[#8A8A90] mt-[3px] tabular-nums" data-lead>{lead}</p>
        </div>
        <div className="flex gap-2">
          {canExport && (
            <button type="button" onClick={() => exportRef.current?.run()} disabled={!exportReady}
              className="h-8 px-3 rounded-md border border-border bg-white text-[13px] font-medium inline-flex items-center gap-1.5 hover:bg-[#FAFAF9] disabled:opacity-50 disabled:cursor-not-allowed">
              <Icon name="Download" size={14} />Export
            </button>
          )}
          {!readOnly && (
            <button type="button" onClick={() => openSell()} className="h-8 px-3 rounded-md bg-primary text-white text-[13px] font-medium inline-flex items-center gap-1.5 shadow-[0_1px_2px_rgba(45,90,39,.25),inset_0_1px_0_rgba(255,255,255,.15)] hover:bg-primary/95">
              <Icon name="Plus" size={15} />Sell package
            </button>
          )}
        </div>
      </div>

      <div ref={tabsRef} className="sticky top-0 z-sticky-filter bg-white pt-[14px]">
        <div role="tablist" aria-label="Packages" className="flex items-center gap-[22px] border-b border-border overflow-x-auto overflow-y-hidden">
          {tabs.map((t) => {
            const on = t.view === view;
            return (
              <Link key={t.view} role="tab" aria-selected={on} to={{ search: `?view=${t.view}` }}
                className={`h-[38px] flex items-center gap-[7px] text-[13px] font-medium relative whitespace-nowrap flex-shrink-0 ${on ? 'text-text-primary' : 'text-[#515152] hover:text-text-primary'}`}>
                {t.label}{counts[t.view] != null && <span className="text-[#8A8A90] tabular-nums" data-count={t.view}>{counts[t.view]}</span>}
                {on && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-text-primary rounded" />}
              </Link>
            );
          })}
        </div>
      </div>

      {view === 'packages' ? <PackageListPanel {...childProps} /> : <PackageOverviewPanel {...childProps} />}

      {!readOnly && sell && (
        <NewPackagePanel
          userRole={role}
          initialCustomer={sell.customer || null}
          initialPackageTypeId={sell.typeId || null}
          onClose={() => setSell(null)}
          onIssued={(issued) => { setSell(null); if (issued) notify('Package sold'); load(); }}
        />
      )}

      {toast && (
        <div role="status" className={`fixed top-20 left-1/2 -translate-x-1/2 z-toast px-4 py-2.5 rounded-lg shadow-lg text-[13px] font-medium ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-text-primary text-white'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
};

export default PackagesPage;
