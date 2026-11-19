import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch, OVERALL_BRANCH_ID } from '../../contexts/BranchContext';
import { useIndustry } from '../../hooks/useIndustry';
import Icon from '../../components/AppIcon';
import { supabase } from '../../lib/supabase';
import { fetchDashboard, fetchSetupState } from '../../services/api';
import BranchView from './BranchView';
import BusinessView from './BusinessView';
import FrontDeskView from './FrontDeskView';
import MyDayView from './MyDayView';
import { isNewTenant, setupSteps } from '../../lib/dashboardTenant';
import { useSearchParams } from 'react-router-dom';
import { nepalNow } from '../../utils/customerDirectory';
import { VIEWS, availableViews, defaultView, dayPhase, readRememberedView, rememberView } from '../../lib/dashboardViews';
import { localizeBranch, wordBranch, wordBranches } from '../../utils/industryTerms';

const PHASES = [
  { key: 'prep', label: 'Prep', icon: 'Sun' },
  { key: 'live', label: 'Live', icon: 'Activity' },
  { key: 'close', label: 'Close', icon: 'Moon' },
];

// Block names per view and phase. V36c/d replace these placeholders with the real cards (mockup: dashboard-v2.html).
const BLOCKS = {
  business: { all: ['Business pulse', 'Branches today', 'Needs your decision', 'Insights'] },
  branch: {
    prep: ['Day brief', 'Roster and rooms', 'Today\'s first bookings', 'Needs you'],
    live: ['Today so far', 'Needs you now', 'Floor', 'Insights'],
    close: ['Day summary', 'Cash to reconcile', 'Open bookings', 'Tomorrow'],
  },
  frontdesk: { all: ['Who is here now', 'Next arrivals', 'Quick actions'] },
  myday: { all: ['My bookings today', 'My earnings today', 'My attendance'] },
};

const toMin = (t) => (t ? Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5)) : null);

const greetingFor = (hm) => {
  const h = Number(hm.slice(0, 2));
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

const dateLine = (today) =>
  new Date(`${today}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

const DashboardHome = ({ hasBookingsToday = false }) => {
  const { profile, user } = useAuth();
  const { branchId, branchName, branches = [], isOverall, switchBranch } = useBranch();
  const { staffLabel, staffLabelPlural, locationLabelPlural, enableRooms } = useIndustry();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlight = searchParams.get('highlight'); // discount notifications deep-link to the Branch view's Needs action
  const role = profile?.role || 'staff';
  const userId = user?.id || profile?.id;
  const branchCount = role === 'admin' || role === 'admin_viewer' ? branches.length : 1;

  const [now, setNow] = useState(() => nepalNow());
  useEffect(() => {
    const id = setInterval(() => setNow(nepalNow()), 60000);
    return () => clearInterval(id);
  }, []);

  const views = availableViews({ role, branchCount });
  const [picked, setPicked] = useState(null);
  const view = highlight && views.includes('branch') && !isOverall ? 'branch' : !isOverall && picked && picked !== 'business' && views.includes(picked)
    ? picked
    : defaultView({ role, branchCount, isOverall, hasBookingsToday, remembered: readRememberedView(userId) });

  // Business is All branches: picking it switches the header branch to Overall; picking any other view while on Overall
  // switches to a concrete branch (the last one used, else the first).
  const lastBranchId = useRef(null);
  useEffect(() => { if (branchId && !isOverall) lastBranchId.current = branchId; }, [branchId, isOverall]);
  const pickView = (v) => {
    setPicked(v);
    rememberView(userId, v);
    if (v === 'business') {
      if (!isOverall) switchBranch(OVERALL_BRANCH_ID);
    } else if (isOverall) {
      const target = branches.find((b) => b.id === lastBranchId.current) || branches[0];
      if (target) switchBranch(target.id);
    }
  };

  const [hours, setHours] = useState(null);
  useEffect(() => {
    if (!branchId || isOverall) { setHours(null); return undefined; }
    let cancelled = false;
    supabase.from('branches').select('open_time, close_time').eq('id', branchId).maybeSingle()
      .then(({ data }) => { if (!cancelled) setHours(data ? { open: data.open_time, close: data.close_time } : null); });
    return () => { cancelled = true; };
  }, [branchId, isOverall]);

  const [dash, setDash] = useState(null);
  const [dashError, setDashError] = useState(false);
  const loadDash = useCallback(async () => {
    const ids = isOverall ? branches.map((b) => b.id) : [branchId];
    if (!ids.length || !ids[0]) { setDash(null); setDashError(false); return; }
    const { data, error } = await fetchDashboard({ branchIds: ids });
    setDashError(!!error);
    if (!error) setDash(data); // a failed refresh keeps the last good data under the error notice
  }, [branchId, isOverall, branches]);
  useEffect(() => { loadDash(); }, [loadDash]);
  useEffect(() => {
    const id = setInterval(loadDash, 60000);
    window.addEventListener('pending-approvals-changed', loadDash);
    return () => { clearInterval(id); window.removeEventListener('pending-approvals-changed', loadDash); };
  }, [loadDash]);

  // New tenant (under two weeks of bookings): the Branch view shows a setup checklist and "—" instead of comparisons.
  const [setupState, setSetupState] = useState(null);
  useEffect(() => {
    if (!branchId || isOverall) { setSetupState(null); return undefined; }
    let cancelled = false;
    fetchSetupState({ branchId }).then(({ data }) => { if (!cancelled) setSetupState(data); });
    return () => { cancelled = true; };
  }, [branchId, isOverall]);
  const newTenant = !!setupState && isNewTenant(setupState.firstBookingDate, now.today);
  const setup = setupState ? setupSteps(setupState.counts, { staffLabel, roomLabel: locationLabelPlural || 'Rooms', enableRooms }) : null;
  const nowMin = Number(now.hm.slice(0, 2)) * 60 + Number(now.hm.slice(3, 5));
  const openBranch = (id, discountId = null) => {
    switchBranch(id);
    setPicked('branch');
    if (discountId) setSearchParams({ highlight: discountId });
  };

  const autoPhase = dayPhase(now.hm, hours || {});
  const [manualPhase, setManualPhase] = useState(null); // a manual pick lasts for the session
  const phase = manualPhase || autoPhase;

  const blocks = useMemo(() => {
    const set = BLOCKS[view];
    return set.all || set[phase];
  }, [view, phase]);

  const firstName = (profile?.full_name || '').split(' ')[0];
  const showPhases = view === 'branch' || view === 'business';
  const scope = isOverall ? `${branches.length} ${(branches.length === 1 ? wordBranch() : wordBranches())}` : branchName;

  return (
    <div className="space-y-3 sm:space-y-4">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">
            {greetingFor(now.hm)}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-sm text-gray-500">{dateLine(now.today)}{scope ? ` · ${scope}` : ''}</p>
        </div>
        {views.length > 1 && (
          <div role="tablist" aria-label="Dashboard view" className="inline-flex rounded-lg bg-gray-100 p-0.5 self-center">
            {views.map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => pickView(v)}
                className={`px-3 py-1.5 text-[12.5px] whitespace-nowrap rounded-md transition-colors ${view === v ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {localizeBranch(VIEWS[v])}
              </button>
            ))}
          </div>
        )}
        {showPhases && (
          <div role="tablist" aria-label="Part of the day" className="flex items-center gap-4 sm:ml-auto self-center">
            {PHASES.map((p) => (
              <button
                key={p.key}
                role="tab"
                aria-selected={phase === p.key}
                onClick={() => setManualPhase(p.key)}
                className={`flex items-center gap-1.5 text-sm font-medium py-1 border-b-2 transition-colors ${phase === p.key ? 'border-primary text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                <Icon name={p.icon} size={15} />{p.label}
                {phase === p.key && <i className="w-1.5 h-1.5 rounded-full bg-success" />}
              </button>
            ))}
            <span className="text-[11.5px] text-gray-400">{manualPhase ? 'chosen by you' : 'auto'}</span>
          </div>
        )}
      </header>

      {view === 'business' && isOverall ? (
        <BusinessView
          data={dash} dataError={dashError} branchIds={branches.map((b) => b.id)} today={now.today}
          role={role} onOpenBranch={openBranch} onReload={loadDash}
        />
      ) : view === 'frontdesk' && !isOverall ? (
        <FrontDeskView data={dash} dataError={dashError} branchId={branchId} today={now.today} nowMin={nowMin} role={role} staffLabel={staffLabel} onReload={loadDash} />
      ) : view === 'myday' && !isOverall ? (
        <MyDayView data={dash} dataError={dashError} branchId={branchId} today={now.today} nowHm={now.hm} role={role} staffLabelPlural={staffLabelPlural} onReload={loadDash} />
      ) : view === 'branch' && !isOverall ? (
        <BranchView
          phase={phase} data={dash} dataError={dashError} nowMin={nowMin} today={now.today} newTenant={newTenant} setup={setup}
          hours={hours ? { open: toMin(hours.open), close: toMin(hours.close) } : null}
          branchId={branchId} role={role} staffLabel={staffLabel} staffLabelPlural={staffLabelPlural} highlight={highlight} onReload={loadDash}
          nowHm={now.hm} onOpenMyDay={() => pickView('myday')}
        />
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        {blocks.map((name) => (
          <div key={name} className="bg-white rounded-lg border border-gray-200 p-4 min-h-[120px]">
            <div className="text-sm font-medium text-gray-900">{name}</div>
            <div className="text-xs text-gray-400 mt-1">Coming in the next step</div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
};

export default DashboardHome;
