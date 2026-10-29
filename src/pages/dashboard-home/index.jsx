import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch, OVERALL_BRANCH_ID } from '../../contexts/BranchContext';
import { useIndustry } from '../../hooks/useIndustry';
import { supabase } from '../../lib/supabase';
import { nepalNow } from '../../utils/customerDirectory';
import { VIEWS, availableViews, defaultView, dayPhase, readRememberedView, rememberView } from '../../lib/dashboardViews';

const PHASES = [
  { key: 'prep', label: 'Prep' },
  { key: 'live', label: 'Live' },
  { key: 'close', label: 'Close' },
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
  const { locationLabelPlural } = useIndustry();
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
  const view = !isOverall && picked && picked !== 'business' && views.includes(picked)
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

  const autoPhase = dayPhase(now.hm, hours || {});
  const [manualPhase, setManualPhase] = useState(null); // a manual pick lasts for the session
  const phase = manualPhase || autoPhase;

  const blocks = useMemo(() => {
    const set = BLOCKS[view];
    return set.all || set[phase];
  }, [view, phase]);

  const firstName = (profile?.full_name || '').split(' ')[0];
  const showPhases = view === 'branch';
  const scope = isOverall ? `All ${(locationLabelPlural || 'branches').toLowerCase()}` : branchName;

  return (
    <div className="space-y-3 sm:space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">
            {greetingFor(now.hm)}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-sm text-gray-500">{dateLine(now.today)}{scope ? ` · ${scope}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {views.length > 1 && (
            <div role="tablist" aria-label="Dashboard view" className="inline-flex rounded-lg bg-gray-100 p-0.5">
              {views.map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => pickView(v)}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${view === v ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  {VIEWS[v]}
                </button>
              ))}
            </div>
          )}
          {showPhases && (
            <div role="tablist" aria-label="Part of the day" className="flex items-center gap-3">
              {PHASES.map((p) => (
                <button
                  key={p.key}
                  role="tab"
                  aria-selected={phase === p.key}
                  onClick={() => setManualPhase(p.key)}
                  className={`text-sm pb-0.5 border-b-2 transition-colors ${phase === p.key ? 'border-primary text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        {blocks.map((name) => (
          <div key={name} className="bg-white rounded-lg border border-gray-200 p-4 min-h-[120px]">
            <div className="text-sm font-medium text-gray-900">{name}</div>
            <div className="text-xs text-gray-400 mt-1">Coming in the next step</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DashboardHome;
