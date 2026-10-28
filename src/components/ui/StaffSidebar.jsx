import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import Icon from '../AppIcon';
import BrandMark from './BrandMark';
import zennlyIcon from 'assets/brand/zennly-icon.png';
import { useAuth } from 'contexts/AuthContext';
import { useBranch } from 'contexts/BranchContext';
import { useIndustry } from 'hooks/useIndustry';
import { useAutoRefresh } from 'hooks/useAutoRefresh';
import { fetchPendingApprovalCount } from 'services/api';
import { useOptionalCommandPalette, SHORTCUT_LABEL } from 'components/CommandPalette/useCommandPalette';
import { getNav, navPath, isNavItemActive } from 'navigation/navRegistry';
import { useNotifications } from 'contexts/NotificationsContext';

const StaffSidebar = ({ userRole: propRole, userName: propName, branchName: propBranch, onCollapseChange, collapsed }) => {
  const location = useLocation();
  const { orgSlug: urlOrgSlug } = useParams();
  const { profile, signOut } = useAuth();
  const { branchName: contextBranchName, branchId, isOverall } = useBranch();
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const { unreadCount: inboxUnread } = useNotifications();
  const { staffLabelPlural, productLabel } = useIndustry();
  const palette = useOptionalCommandPalette();
  const openPalette = palette?.openPalette;
  const [isCollapsed, setIsCollapsed] = useState(false);
  // Lets a parent (e.g. Calendar's auto-collapse-for-width effect) push a collapsed
  // state in, while the toggle button below still owns it day-to-day — undefined
  // `collapsed` (every other call site) means this never fires, so manual-toggle-only
  // behavior is unchanged everywhere else.
  useEffect(() => {
    if (collapsed !== undefined) setIsCollapsed(collapsed);
  }, [collapsed]);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef(null);

  // Shrink the floating mobile nav + FAB while the user is actively scrolling
  // any scrollable container on the page. `capture: true` catches scroll events
  // from nested scrollers (e.g. the calendar grid) that don't bubble to window.
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolling(true);
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => setIsScrolling(false), 300);
    };
    document.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', handleScroll, { capture: true });
      clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  const showWorldCupKick = new Date() < new Date('2026-07-21T00:00:00+05:45');

  const userRole = profile?.role || propRole || 'staff';
  const userName = profile?.full_name || propName || 'Staff Member';
  const branchName = contextBranchName || profile?.branches?.name || propBranch || '';
  const isManagerOrAdmin = ['manager', 'admin', 'admin_viewer'].includes(userRole);

  // Pending discount-approval count for the badge on "Dashboard".
  // Only approvers (manager/admin) can receive requests; re-check on branch
  // change, on navigation, and on a slow poll so the badge stays current.
  const loadPendingApprovals = useCallback(async () => {
    if (!isManagerOrAdmin || !branchId) {
      setPendingApprovals(0);
      return;
    }
    const { count } = await fetchPendingApprovalCount(branchId);
    setPendingApprovals(count);
  }, [isManagerOrAdmin, branchId]);

  useEffect(() => {
    loadPendingApprovals();
  }, [loadPendingApprovals, location.pathname, location.search]);

  useEffect(() => {
    window.addEventListener('pending-approvals-changed', loadPendingApprovals);
    return () => window.removeEventListener('pending-approvals-changed', loadPendingApprovals);
  }, [loadPendingApprovals]);

  useAutoRefresh(loadPendingApprovals, { intervalMs: 60000, enabled: isManagerOrAdmin && !!branchId });

  // Get org slug from URL params or profile
  const orgSlug = urlOrgSlug || profile?.organizations?.slug;

  // Base path for navigation - uses org-scoped URL if available
  const basePath = orgSlug ? `/${orgSlug}/dashboard` : (isManagerOrAdmin ? '/branch-manager-dashboard' : '/branch-staff-dashboard');

  const handleLogout = async () => {
    await signOut();
  };

  // The nav is generated from the module registry (src/navigation/navRegistry.js): flat items under section labels, Settings pinned
  // at the bottom. Labels are hidden when the role sees only a handful of items (staff).
  const { sections, footer, showLabels } = getNav({ role: userRole, isOverall, staffLabelPlural, productLabel });

  // The current `?view=`; the bare dashboard URL is the landing view: the dashboard for managers/admins, the calendar for staff.
  const onDashboard = location.pathname === basePath;
  const currentView = onDashboard ? (new URLSearchParams(location.search).get('view') || (userRole === 'staff' ? 'calendar' : 'dashboard')) : null;
  const isItemActive = (item) => (item.path ? location.pathname.endsWith(`/${item.path}`) : currentView !== null && isNavItemActive(item, currentView));

  // New Booking is no longer a nav item (it is a tab under Bookings); the mobile FAB remains.
  const showNewBookingFab = !isOverall;

  // Mobile: a few primary pills, everything else in the "More" sheet (grouped by section, Settings last).
  const flatItems = [
    ...sections.flatMap((sec) => sec.items.map((item) => ({ ...item, groupLabel: sec.label }))),
    ...footer.map((item) => ({ ...item, groupLabel: null, isFooter: true })),
  ].map((item) => ({ ...item, path: navPath(item, basePath) }));
  const primaryIds = ['dashboard', 'calendar', 'bookings', isManagerOrAdmin ? 'customers' : null].filter(Boolean);
  const mobilePrimaryItems = primaryIds.map((id) => flatItems.find((i) => i.id === id)).filter(Boolean);
  const mobileOverflowItems = flatItems.filter((i) => !primaryIds.includes(i.id));

  const renderNavItem = (item) => {
    const badgeCount = item.id === 'inbox' ? inboxUnread : (item.id === 'dashboard' ? pendingApprovals : 0);
    const showBadge = badgeCount > 0;
    return (
      <Link
        key={item.id}
        to={navPath(item, basePath)}
        title={isCollapsed ? item.label : undefined}
        className={`flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-colors ${
          isItemActive(item)
            ? 'bg-white text-gray-900 shadow-[0_0_0_1px_#E9E9EC]'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
        } ${isCollapsed ? 'justify-center' : ''}`}
      >
        <div className="relative flex-shrink-0">
          <Icon name={item.icon} size={18} />
          {showBadge && isCollapsed && (
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-error rounded-full ring-2 ring-surface-sidebar" />
          )}
        </div>
        {!isCollapsed && <span className="flex-1">{item.label}</span>}
        {showBadge && !isCollapsed && (
          <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 text-[11px] font-semibold text-white bg-error rounded-full">
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
      </Link>
    );
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className={`fixed left-0 top-0 h-full z-staff-sidebar bg-surface-sidebar flex flex-col transition-all duration-200 ${
        isCollapsed ? 'w-16' : 'w-60'
      } hidden lg:flex`}>
        {/* Header */}
        <div className={`py-3 h-12 flex items-center justify-between ${isCollapsed ? 'px-2' : 'px-5'}`}>
          <Link to={basePath} className="flex items-center gap-3 shrink-0">
              <div className="relative">
                {isCollapsed ? (
                  <img
                    src={zennlyIcon}
                    alt="Zennly"
                    className={`w-auto shrink-0 h-10 rounded-md ${showWorldCupKick ? 'zenly-wc-bubble' : ''}`}
                  />
                ) : (
                  <BrandMark className={`h-6 w-auto ml-2 shrink-0 ${showWorldCupKick ? 'zenly-wc-bubble' : ''}`} />
                )}
                {showWorldCupKick && (
                  <>
                    {/* Athletic stick figure — head, torso, and 4 limbs each
                        split into TWO segments (upper arm + forearm, thigh +
                        shin) so we can bend the knee/elbow independently of
                        the hip/shoulder. That's what makes the gait & kick
                        read as athletic instead of as a rigid swing.        */}
                    <svg
                      className="zenly-wc-player"
                      viewBox="0 0 32 32"
                      fill="none"
                      aria-hidden="true"
                    >
                      <g className="zenly-wc-figure">
                        {/* Colors come from CSS (currentColor = Zennly green) */}
                        <circle cx="16" cy="5.8" r="2.6" />
                        <line x1="16" y1="8.4" x2="16" y2="18.5" strokeWidth="2.4" strokeLinecap="round" />
                        <line x1="13.5" y1="10.5" x2="18.5" y2="10.5" strokeWidth="1.6" strokeLinecap="round" />
                        <g className="zenly-wc-arm-l">
                          <line x1="14" y1="10.8" x2="14" y2="14.8" strokeWidth="2" strokeLinecap="round" />
                          <g className="zenly-wc-forearm-l">
                            <line x1="14" y1="14.8" x2="14" y2="18.6" strokeWidth="1.8" strokeLinecap="round" />
                          </g>
                        </g>
                        <g className="zenly-wc-arm-r">
                          <line x1="18" y1="10.8" x2="18" y2="14.8" strokeWidth="2" strokeLinecap="round" />
                          <g className="zenly-wc-forearm-r">
                            <line x1="18" y1="14.8" x2="18" y2="18.6" strokeWidth="1.8" strokeLinecap="round" />
                          </g>
                        </g>
                        <g className="zenly-wc-leg-l">
                          <line x1="15.2" y1="18.5" x2="15.2" y2="23" strokeWidth="2.4" strokeLinecap="round" />
                          <g className="zenly-wc-shin-l">
                            <line x1="15.2" y1="23" x2="15.2" y2="28" strokeWidth="2.2" strokeLinecap="round" />
                          </g>
                        </g>
                        <g className="zenly-wc-leg-r">
                          <line x1="16.8" y1="18.5" x2="16.8" y2="23" strokeWidth="2.4" strokeLinecap="round" />
                          <g className="zenly-wc-shin-r">
                            <line x1="16.8" y1="23" x2="16.8" y2="28" strokeWidth="2.2" strokeLinecap="round" />
                          </g>
                        </g>
                      </g>
                    </svg>

                    {/* Goal post — frame with net pattern */}
                    <svg className="zenly-wc-goalpost" viewBox="0 0 24 18" aria-hidden="true">
                      <line x1="2" y1="2" x2="2" y2="17" stroke="#1f2937" strokeWidth="1.4" strokeLinecap="round" />
                      <line x1="22" y1="2" x2="22" y2="17" stroke="#1f2937" strokeWidth="1.4" strokeLinecap="round" />
                      <line x1="2" y1="2" x2="22" y2="2" stroke="#1f2937" strokeWidth="1.4" strokeLinecap="round" />
                      <line x1="6" y1="2" x2="6" y2="17" stroke="#1f2937" strokeWidth="0.4" opacity="0.55" />
                      <line x1="10" y1="2" x2="10" y2="17" stroke="#1f2937" strokeWidth="0.4" opacity="0.55" />
                      <line x1="14" y1="2" x2="14" y2="17" stroke="#1f2937" strokeWidth="0.4" opacity="0.55" />
                      <line x1="18" y1="2" x2="18" y2="17" stroke="#1f2937" strokeWidth="0.4" opacity="0.55" />
                      <line x1="2" y1="6" x2="22" y2="6" stroke="#1f2937" strokeWidth="0.4" opacity="0.55" />
                      <line x1="2" y1="11" x2="22" y2="11" stroke="#1f2937" strokeWidth="0.4" opacity="0.55" />
                    </svg>

                    {/* Ball — SVG circle with a tiny pentagon mark so it reads as a soccer ball */}
                    <svg
                      className="zenly-wc-ball"
                      viewBox="0 0 12 12"
                      aria-hidden="true"
                    >
                      <circle cx="6" cy="6" r="5.4" fill="white" stroke="#1f2937" strokeWidth="0.6" />
                      <path d="M6 3 L8.5 4.8 L7.5 7.5 L4.5 7.5 L3.5 4.8 Z" fill="#1f2937" />
                    </svg>

                    {/* Color burst — radiating accent-colored dots for the celebration */}
                    <svg
                      className="zenly-wc-burst"
                      viewBox="0 0 40 40"
                      aria-hidden="true"
                    >
                      <circle cx="6"  cy="14" r="1.6" fill="#DAA520" />
                      <circle cx="34" cy="14" r="1.6" fill="#DAA520" />
                      <circle cx="4"  cy="26" r="1.4" fill="#10B981" />
                      <circle cx="36" cy="26" r="1.4" fill="#10B981" />
                      <circle cx="20" cy="2"  r="1.6" fill="#DC2626" />
                      <circle cx="10" cy="6"  r="1.2" fill="#DAA520" />
                      <circle cx="30" cy="6"  r="1.2" fill="#DAA520" />
                      <circle cx="20" cy="38" r="1.4" fill="#DC2626" />
                    </svg>

                    <span className="zenly-wc-goal-text" aria-hidden="true">GOAL!</span>
                  </>
                )}
              </div>
          </Link>
          <button
            onClick={() => {
              const next = !isCollapsed;
              setIsCollapsed(next);
              onCollapseChange?.(next);
            }}
            className={`rounded-md hover:bg-background transition-colors shrink-0 ${isCollapsed ? 'p-1' : 'p-2'}`}
          >
            <Icon
              name={isCollapsed ? "ChevronRight" : "ChevronLeft"}
              size={isCollapsed ? 14 : 16}
              className="text-gray-500"
            />
          </button>
        </div>

        {/* "Search… ⌘K": opens the command palette (icon-only in the collapsed rail) */}
        {openPalette && <div className={`pb-2 ${isCollapsed ? 'flex justify-center' : 'px-3'}`}>
          {isCollapsed ? (
            <button
              type="button"
              onClick={openPalette}
              title={`Search (${SHORTCUT_LABEL})`}
              aria-label="Search"
              className="h-[var(--control-h)] w-[var(--control-h)] flex items-center justify-center rounded-spa border border-border bg-surface text-text-tertiary hover:text-text-secondary"
            >
              <Icon name="Search" size={15} />
            </button>
          ) : (
            <button
              type="button"
              onClick={openPalette}
              aria-label="Search"
              className="w-full h-[var(--control-h)] flex items-center gap-2 px-2.5 rounded-spa border border-border bg-surface text-[13px] text-text-tertiary hover:border-black/20 spa-transition-fast"
            >
              <Icon name="Search" size={15} className="flex-shrink-0" />
              <span className="flex-1 text-left truncate">Search…</span>
              <kbd className="text-[11px] text-text-tertiary border border-border rounded px-1.5 leading-4">{SHORTCUT_LABEL}</kbd>
            </button>
          )}
        </div>}

        {/* Navigation — flat items under section labels, generated from navigation/navRegistry.js (no dropdowns) */}
        <nav className="sidebar-scroll flex-1 overflow-y-auto p-3">
          {sections.map((sec, si) => (
            <div key={sec.id}>
              {isCollapsed ? (
                si > 0 && <div className="h-px bg-border mx-3 my-2" />
              ) : showLabels && sec.label && (
                <p className="px-3 mt-5 mb-1.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">{sec.label}</p>
              )}
              {!isCollapsed && !showLabels && si > 0 && <div className="h-2" />}
              <div className="space-y-0.5">{sec.items.map(renderNavItem)}</div>
            </div>
          ))}
        </nav>

        {/* Settings, pinned to the bottom of the nav column */}
        {footer.length > 0 && (
          <div className="px-3 pb-2">
            {isCollapsed && <div className="h-px bg-border mx-3 mb-2" />}
            <div className="space-y-0.5">{footer.map(renderNavItem)}</div>
          </div>
        )}

        {/* Footer - Powered by Zunkireelabs */}
        <div className="p-3">
          {isCollapsed ? (
            <div className="flex justify-center py-2">
              <img src="/zunkireelabs-icon.png" alt="Zunkireelabs" className="w-5 h-5" />
            </div>
          ) : (
            <div className="px-3 py-2 flex items-center gap-1.5">
              <span className="text-xs text-gray-400">A Product of</span>
              <img src="/zunkireelabs-icon.png" alt="Zunkireelabs" className="w-4 h-4" />
              <span className="text-xs font-medium text-gray-700">zunkireelabs</span>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Floating Pill Navigation — icon + label inside the pill; subtle shrink while scrolling */}
      <nav
        className={`js-mobile-floating-ui lg:hidden fixed left-1/2 -translate-x-1/2 z-staff-sidebar bg-surface-sidebar rounded-full shadow-spa-elevated border border-border transition-all duration-200 ease-out ${
          isScrolling ? 'bottom-3 px-1.5 py-1' : 'bottom-4 px-2 py-1.5'
        }`}
      >
        <div className="flex items-center gap-0.5">
          {mobilePrimaryItems.map((item) => {
            const badgeCount = item.id === 'inbox' ? inboxUnread : (item.id === 'dashboard' ? pendingApprovals : 0);
            const showBadge = badgeCount > 0;
            return (
              <Link
                key={item.id}
                to={item.path}
                aria-label={item.label}
                className={`relative flex flex-col items-center justify-center rounded-full transition-all duration-200 ${
                  isScrolling ? 'px-2 py-1 gap-0.5' : 'px-2.5 py-1.5 gap-0.5'
                } ${
                  isItemActive(item)
                    ? 'bg-primary/10 text-primary'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-background'
                }`}
              >
                <Icon name={item.icon} size={isScrolling ? 19 : 20} />
                <span className="text-[10px] leading-none font-medium">{item.label}</span>
                {showBadge && (
                  <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 text-[10px] font-semibold text-white bg-error rounded-full">
                    {badgeCount > 9 ? '9+' : badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
          {mobileOverflowItems.length > 0 && (
            <button
              onClick={() => setMobileMoreOpen(!mobileMoreOpen)}
              aria-label="More"
              className={`flex flex-col items-center justify-center rounded-full transition-all duration-200 ${
                isScrolling ? 'px-2 py-1 gap-0.5' : 'px-2.5 py-1.5 gap-0.5'
              } ${
                mobileMoreOpen ? 'bg-primary/10 text-primary' : 'text-gray-500 hover:text-gray-900 hover:bg-background'
              }`}
            >
              <Icon name="MoreHorizontal" size={isScrolling ? 19 : 20} />
              <span className="text-[10px] leading-none font-medium">More</span>
            </button>
          )}
        </div>

      </nav>

      {/* Mobile "More" full-screen panel — slides in from the right, grouped list style */}
      {mobileMoreOpen && (
        <div className="lg:hidden fixed inset-0 z-modal bg-surface flex flex-col animate-slide-in-right">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-surface flex-shrink-0">
            <button
              onClick={() => setMobileMoreOpen(false)}
              className="p-1 -ml-1 rounded-spa hover:bg-background"
              aria-label="Back"
            >
              <Icon name="ArrowLeft" size={22} className="text-text-primary" />
            </button>
            <h2 className="font-heading font-heading-semibold text-lg text-text-primary">More</h2>
          </div>

          {/* Grouped list */}
          <div className="flex-1 overflow-y-auto">
            {(() => {
              // Group overflow items by their original parent group label.
              const groups = [];
              const groupMap = new Map();
              mobileOverflowItems.forEach(item => {
                const key = item.groupLabel || (item.isFooter ? '__footer' : 'Other');
                if (!groupMap.has(key)) {
                  const group = { label: key, items: [] };
                  groupMap.set(key, group);
                  groups.push(group);
                }
                groupMap.get(key).items.push(item);
              });
              return groups.map(group => (
                <div key={group.label} className="border-b border-border last:border-b-0">
                  {group.label !== 'Other' && group.label !== '__footer' && (
                    <div className="px-4 pt-4 pb-2 font-caption font-caption-medium text-[11px] uppercase tracking-wider text-text-tertiary">
                      {group.label}
                    </div>
                  )}
                  {group.items.map(item => (
                    <Link
                      key={item.id}
                      to={item.path}
                      onClick={() => setMobileMoreOpen(false)}
                      className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                        isItemActive(item) ? 'bg-background' : 'hover:bg-background'
                      }`}
                    >
                      <Icon name={item.icon} size={20} className="text-text-secondary flex-shrink-0" />
                      <span className="flex-1 font-body font-body-medium text-sm text-text-primary">{item.label}</span>
                      <Icon name="ChevronRight" size={16} className="text-text-tertiary flex-shrink-0" />
                    </Link>
                  ))}
                </div>
              ));
            })()}

            {/* Logout */}
            <button
              onClick={() => { setMobileMoreOpen(false); handleLogout(); }}
              className="flex items-center gap-3 px-4 py-3 w-full text-error hover:bg-red-50 transition-colors border-t border-border"
            >
              <Icon name="LogOut" size={20} className="flex-shrink-0" />
              <span className="flex-1 text-left font-body font-body-medium text-sm">Logout</span>
              <Icon name="ChevronRight" size={16} className="flex-shrink-0" />
            </button>
          </div>
        </div>
      )}

      {/* Mobile floating New Booking FAB — chatbot-style, shrinks while scrolling.
          Routes to the calendar view with ?newBooking=1, which opens the Quick Booking panel. */}
      {showNewBookingFab && (
        <Link
          to={`${basePath}?view=calendar&newBooking=1`}
          aria-label="New Booking"
          className={`js-mobile-floating-ui lg:hidden fixed right-4 z-staff-sidebar inline-flex items-center justify-center rounded-full bg-primary text-white shadow-lg hover:bg-primary/90 transition-all duration-200 ease-out ${
            isScrolling ? 'bottom-[72px] w-[52px] h-[52px]' : 'bottom-20 w-14 h-14'
          }`}
        >
          <Icon name="CalendarPlus" size={isScrolling ? 22 : 24} />
        </Link>
      )}
    </>
  );
};

export default StaffSidebar;
