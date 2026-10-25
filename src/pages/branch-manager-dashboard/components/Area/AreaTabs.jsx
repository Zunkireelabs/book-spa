import React, { useRef } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from 'contexts/AuthContext';
import { useBranch } from 'contexts/BranchContext';
import { useIndustry } from 'hooks/useIndustry';
import { AreaPage } from './AreaLayout';
import { getVisibleTabs } from './areaTabsRegistry';

// A small area as tabs: header (title + description), an underline tab row (same style as the Outstanding / Settled tabs), then the
// panel in `.content-scroll`. Each tab is a `?view=` link. The tab row is hidden when only one tab is visible.
const AreaTabs = ({ area, view, children }) => {
  const { profile } = useAuth();
  const { branchName, isOverall } = useBranch();
  const { staffLabelPlural, productLabel } = useIndustry();
  const listRef = useRef(null);

  const ctx = { role: profile?.role, isOverall, branchName, staffLabelPlural, productLabel };
  const tabs = getVisibleTabs(area, ctx);
  // The role cannot open this view: send it to the area's first visible tab, or to the dashboard when it has none.
  if (!tabs.some((t) => t.view === view)) {
    return <Navigate to={{ search: `?view=${tabs[0]?.view || 'dashboard'}` }} replace />;
  }

  const areaTitle = typeof area.title === 'function' ? area.title(ctx) : area.title;

  // The page draws its own header and tabs inside the one scroller (Packages).
  if (area.selfHeader) {
    return (
      <div className="h-full flex flex-col min-h-0">
        <div className="content-scroll flex-1 min-h-0 overflow-y-auto">
          <div className="px-3 sm:px-4 md:px-6 lg:px-8 pt-4 sm:pt-5">{children}</div>
        </div>
      </div>
    );
  }

  // Arrow keys / Home / End move focus between tabs; Enter or Space opens the focused one (it is a link).
  const onKeyDown = (e) => {
    const items = Array.from(listRef.current?.querySelectorAll('[role="tab"]') || []);
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowRight: (i + 1) % items.length, ArrowLeft: (i - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    items[next].focus();
  };

  const tabRow = tabs.length > 1 ? (
    <div ref={listRef} role="tablist" aria-label={areaTitle} onKeyDown={onKeyDown} className="mt-2 -mb-[13px] flex gap-6 overflow-x-auto whitespace-nowrap">
      {tabs.map((t) => {
        const active = t.view === view;
        return (
          <Link
            key={t.view}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            to={{ search: `?view=${t.view}` }}
            className={`py-2.5 px-1 border-b-2 spa-transition-fast font-body font-body-medium text-sm focus:outline-none focus-visible:text-text-primary ${
              active ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  ) : null;

  return (
    <div className="h-full flex flex-col min-h-0">
      <AreaPage title={areaTitle} description={area.description(ctx)} tabs={tabRow} scrollHeader={area.id === 'bookings' && view === 'bookings'}>
        {children}
      </AreaPage>
    </div>
  );
};

export default AreaTabs;
