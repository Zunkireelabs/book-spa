import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
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
  const { staffLabelPlural } = useIndustry();
  const listRef = useRef(null);

  const ctx = { role: profile?.role, isOverall, branchName, staffLabelPlural };
  const tabs = getVisibleTabs(area, ctx);
  const areaTitle = typeof area.title === 'function' ? area.title(ctx) : area.title;

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
      <AreaPage title={areaTitle} description={area.description(ctx)} tabs={tabRow}>
        {children}
      </AreaPage>
    </div>
  );
};

export default AreaTabs;
