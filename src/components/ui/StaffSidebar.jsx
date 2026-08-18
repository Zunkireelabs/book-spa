import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import Icon from '../AppIcon';
import { useAuth } from 'contexts/AuthContext';
import { useBranch } from 'contexts/BranchContext';
import { useIndustry } from 'hooks/useIndustry';
import { fetchPendingApprovalCount } from 'services/api';
import { MEMBERSHIP_ENABLED } from 'lib/featureFlags';

const StaffSidebar = ({ userRole: propRole, userName: propName, branchName: propBranch, onCollapseChange }) => {
  const location = useLocation();
  const { orgSlug: urlOrgSlug } = useParams();
  const { profile, signOut } = useAuth();
  const { branchName: contextBranchName, branchId, isOverall } = useBranch();
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const { staffLabelPlural, locationLabelPlural, enableRooms } = useIndustry();
  const [isCollapsed, setIsCollapsed] = useState(false);
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
  const [expandedItems, setExpandedItems] = useState(['operations']); // Default expanded

  // World Cup 2026 — show the logo-kicks-football animation through July 20, 2026 (Nepal time).
  const showWorldCupKick = new Date() < new Date('2026-07-21T00:00:00+05:45');
  const userRole = profile?.role || propRole || 'staff';
  const userName = profile?.full_name || propName || 'Staff Member';
  const branchName = contextBranchName || profile?.branches?.name || propBranch || 'Main Branch';
  const isManagerOrAdmin = ['manager', 'admin', 'admin_viewer'].includes(userRole);

  // Pending discount-approval count for the badge on "Dashboard".
  // Only approvers (manager/admin) can receive requests; re-check on branch
  // change, on navigation, and on a slow poll so the badge stays current.
  useEffect(() => {
    if (!isManagerOrAdmin || !branchId) {
      setPendingApprovals(0);
      return;
    }
    let active = true;
    const load = async () => {
      const { count } = await fetchPendingApprovalCount(branchId);
      if (active) setPendingApprovals(count);
    };
    load();
    const interval = setInterval(load, 60000);
    window.addEventListener('pending-approvals-changed', load);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener('pending-approvals-changed', load);
    };
  }, [isManagerOrAdmin, branchId, location.pathname, location.search]);

  // Get org slug from URL params or profile
  const orgSlug = urlOrgSlug || profile?.organizations?.slug;

  // Base path for navigation - uses org-scoped URL if available
  const basePath = orgSlug ? `/${orgSlug}/dashboard` : (isManagerOrAdmin ? '/branch-manager-dashboard' : '/branch-staff-dashboard');

  const handleLogout = async () => {
    await signOut();
  };

  const toggleExpand = (id) => {
    setExpandedItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Navigation items with collapsible groups (Agentic Commerce style)
  const navigationItems = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: 'LayoutDashboard',
      path: basePath,
      roles: ['staff', 'manager', 'admin', 'admin_viewer']
    },
    {
      id: 'operations',
      label: 'Operations',
      icon: 'ClipboardList',
      roles: ['staff', 'manager', 'admin', 'admin_viewer'],
      children: [
        {
          id: 'bookings',
          label: 'Bookings',
          icon: 'BookOpen',
          path: `${basePath}?view=bookings`,
          roles: ['staff', 'manager', 'admin', 'admin_viewer']
        },
        {
          id: 'calendar',
          label: 'Calendar',
          icon: 'Calendar',
          path: `${basePath}?view=calendar`,
          roles: ['staff', 'manager', 'admin', 'admin_viewer']
        },
        {
          id: 'collect-payment',
          label: 'Collect Payment',
          icon: 'CreditCard',
          path: `${basePath}?view=collect-payment`,
          roles: ['staff']
        },
        {
          id: 'new-booking',
          label: 'New Booking',
          icon: 'CalendarPlus',
          path: `${basePath}?view=new-booking`,
          roles: ['staff', 'manager', 'admin', 'admin_viewer'],
          overallHidden: true
        },
      ]
    },
    {
      id: 'customers',
      label: 'Customers',
      icon: 'Users',
      path: `${basePath}?view=customers`,
      roles: ['manager', 'admin', 'admin_viewer']
    },
    {
      id: 'insights',
      label: 'Reports',
      icon: 'BarChart3',
      roles: ['manager', 'admin', 'admin_viewer'],
      children: [
        {
          id: 'reports',
          label: 'Daily Report',
          icon: 'FileText',
          path: `${basePath}?view=reports`,
          roles: ['manager', 'admin', 'admin_viewer']
        },
        {
          id: 'performance',
          label: 'Performance',
          icon: 'TrendingUp',
          path: `${basePath}?view=performance`,
          roles: ['manager', 'admin', 'admin_viewer']
        },
        {
          id: 'discounts',
          label: 'Discounts Report',
          icon: 'Percent',
          path: `${basePath}?view=discounts`,
          roles: ['manager', 'admin', 'admin_viewer']
        },
        {
          id: 'attendance-report',
          label: 'Attendance Report',
          icon: 'CalendarCheck',
          path: `${basePath}?view=attendance-report`,
          roles: ['manager', 'admin', 'admin_viewer']
        },
        {
          id: 'attendance-calendar',
          label: 'Attendance Calendar',
          icon: 'CalendarDays',
          path: orgSlug ? `/${orgSlug}/attendance-calendar` : '/attendance-calendar',
          roles: ['manager', 'admin', 'admin_viewer']
        },
        {
          id: 'transfer-report',
          label: 'Transfer Report',
          icon: 'ArrowRightLeft',
          path: `${basePath}?view=transfer-report`,
          roles: ['manager', 'admin', 'admin_viewer']
        },
        {
          id: 'outstanding',
          label: 'Outstanding Report',
          icon: 'AlertCircle',
          path: `${basePath}?view=outstanding`,
          roles: ['manager', 'admin', 'admin_viewer']
        },
        {
          id: 'referrals',
          label: 'Referrals Report',
          icon: 'UserPlus',
          path: `${basePath}?view=referrals`,
          roles: ['manager', 'admin', 'admin_viewer']
        },
        {
          id: 'service-revenue',
          label: 'Service Revenue',
          icon: 'PieChart',
          path: `${basePath}?view=service-revenue`,
          roles: ['manager', 'admin', 'admin_viewer']
        },
      ]
    },
    {
      id: 'staff-mgmt',
      label: 'Staff',
      icon: 'UserCog',
      roles: ['manager', 'admin', 'admin_viewer'],
      children: [
        {
          id: 'therapists',
          label: staffLabelPlural,
          icon: 'Users',
          path: `${basePath}?view=therapists`,
          roles: ['manager', 'admin', 'admin_viewer']
        },
        {
          id: 'attendance',
          label: 'Attendance',
          icon: 'Clock',
          path: `${basePath}?view=attendance`,
          roles: ['manager', 'admin', 'admin_viewer'],
          overallHidden: true
        },
      ]
    },
    {
      id: 'payroll',
      label: 'Payroll',
      icon: 'Wallet',
      path: `${basePath}?view=payroll`,
      roles: ['admin', 'admin_viewer'],
    },
    ...(MEMBERSHIP_ENABLED ? [{
      id: 'memberships',
      label: 'Memberships',
      icon: 'CreditCard',
      roles: ['manager', 'admin'],
      children: [
        {
          id: 'all-memberships',
          label: 'All Memberships',
          icon: 'CreditCard',
          path: `${basePath}?view=memberships`,
          roles: ['manager', 'admin'],
        },
        {
          id: 'membership-collection',
          label: 'Collection',
          icon: 'PiggyBank',
          path: `${basePath}?view=membership-collection`,
          roles: ['manager', 'admin'],
        },
        {
          id: 'wallet-usage',
          label: 'Wallet Usage',
          icon: 'Wallet',
          path: `${basePath}?view=wallet-usage`,
          roles: ['manager', 'admin'],
        },
      ],
    }] : []),
    {
      id: 'infrastructure',
      label: 'Setup',
      icon: 'Settings',
      roles: ['manager', 'admin', 'admin_viewer'],
      children: [
        // Only show rooms/locations for industries that use them
        ...(enableRooms ? [{
          id: 'rooms',
          label: locationLabelPlural,
          icon: 'DoorOpen',
          path: `${basePath}?view=rooms`,
          roles: ['manager', 'admin', 'admin_viewer'],
          overallHidden: true
        }] : []),
        {
          id: 'services',
          label: 'Services',
          icon: 'Sparkles',
          path: `${basePath}?view=services`,
          roles: ['manager', 'admin', 'admin_viewer'],
          overallHidden: true
        },
        {
          id: 'categories',
          label: 'Categories',
          icon: 'Tags',
          path: `${basePath}?view=categories`,
          roles: ['manager', 'admin', 'admin_viewer'],
          overallHidden: true
        },
        {
          id: 'payment-methods',
          label: 'Payment Methods',
          icon: 'CreditCard',
          path: `${basePath}?view=payment-methods`,
          roles: ['admin'],
          overallHidden: true
        },
        {
          id: 'audit',
          label: 'Audit Log',
          icon: 'History',
          path: `${basePath}?view=audit`,
          roles: ['manager', 'admin', 'admin_viewer']
        },
      ]
    },
  ];

  // Filter items by role (and, in the Overall aggregate view, hide write/creation items
  // that have no single target branch).
  const isVisible = (item) =>
    item.roles.includes(userRole) && !(isOverall && item.overallHidden);

  const filterByRole = (items) => {
    return items
      .filter(isVisible)
      .map(item => {
        if (item.children) {
          return {
            ...item,
            children: item.children.filter(isVisible)
          };
        }
        return item;
      })
      .filter(item => !item.children || item.children.length > 0);
  };

  const filteredNavItems = filterByRole(navigationItems);

  // Flatten for mobile nav. Tag each child with its parent group label so the
  // "More" sheet can render section headers (e.g. Reports, Staff, Setup).
  const flattenNav = (items) => {
    const result = [];
    items.forEach(item => {
      if (item.children) {
        // A group can also be a direct link itself (e.g. Memberships) — keep
        // it reachable from mobile nav alongside its children.
        if (item.path) {
          result.push({ id: item.id, label: item.label, icon: item.icon, path: item.path, groupLabel: null });
        }
        item.children.forEach(child => result.push({ ...child, groupLabel: item.label }));
      } else if (item.path) {
        result.push({ ...item, groupLabel: null });
      }
    });
    return result;
  };

  const flatNavItems = flattenNav(filteredNavItems);
  // Pull New Booking out into its own floating FAB; everything else feeds the pill nav + "More" sheet.
  const newBookingItem = flatNavItems.find(item => item.id === 'new-booking');
  const mainNavItems = flatNavItems.filter(item => item.id !== 'new-booking');
  const mobilePrimaryItems = mainNavItems.slice(0, 4);
  const mobileOverflowItems = mainNavItems.slice(4);

  const isActive = (path) => {
    if (path.includes('?')) {
      return `${location.pathname}${location.search}` === path;
    }
    return location.pathname === path && !location.search;
  };

  const isParentActive = (item) => {
    if (item.path && isActive(item.path)) return true;
    if (item.children) {
      return item.children.some(child => isActive(child.path));
    }
    return false;
  };

  const getActiveChildIndex = (children) => {
    return children.findIndex(child => isActive(child.path));
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className={`fixed left-0 top-0 h-full z-staff-sidebar bg-surface-sidebar flex flex-col transition-all duration-200 ${
        isCollapsed ? 'w-16' : 'w-60'
      } hidden lg:flex`}>
        {/* Header */}
        <div className="px-5 py-3 h-[52px] flex items-center justify-between">
          {!isCollapsed && (
            <Link to={basePath} className="flex items-center gap-3">
              <div className="relative">
                <div className={`w-8 h-8 bg-primary rounded-full flex items-center justify-center ${showWorldCupKick ? 'zenly-wc-bubble' : ''}`}>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    className={`text-white ${showWorldCupKick ? 'zenly-wc-star' : ''}`}
                  >
                    <path
                      d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z"
                      fill="currentColor"
                    />
                    <circle cx="12" cy="19" r="2" fill="currentColor" opacity="0.7"/>
                  </svg>
                </div>
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
              <div>
                <h1 className="text-sm font-semibold text-gray-900">Zennly</h1>
                <p className="text-xs text-gray-500">Staff Portal</p>
              </div>
            </Link>
          )}
          <button
            onClick={() => {
              const next = !isCollapsed;
              setIsCollapsed(next);
              onCollapseChange?.(next);
            }}
            className="p-2 rounded-md hover:bg-background transition-colors"
          >
            <Icon
              name={isCollapsed ? "ChevronRight" : "ChevronLeft"}
              size={16}
              className="text-gray-500"
            />
          </button>
        </div>

        {/* Navigation — collapsible groups (Agentic Commerce style) */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {filteredNavItems.map((item) => {
            const hasChildren = item.children && item.children.length > 0;
            const isExpanded = expandedItems.includes(item.id);
            const parentActive = isParentActive(item);

            // Collapsible group
            if (hasChildren) {
              return (
                <div key={item.id}>
                  {/* Parent item — a plain toggle button, unless it also has its own
                      path (e.g. Memberships), in which case the label navigates and
                      a separate chevron control expands/collapses the children. */}
                  {item.path ? (
                    <div
                      className={`w-full flex items-center gap-1 rounded-md text-sm font-medium transition-colors ${
                        parentActive
                          ? 'bg-background text-gray-900'
                          : 'text-gray-500 hover:bg-background hover:text-gray-900'
                      } ${isCollapsed ? 'justify-center' : ''}`}
                    >
                      <Link
                        to={item.path}
                        onClick={() => {
                          // Expand immediately (synchronous local state) instead of
                          // waiting on the route change + page data fetch to settle.
                          if (!isExpanded) toggleExpand(item.id);
                        }}
                        className={`flex-1 flex items-center gap-3 px-3 py-2 rounded-md ${isCollapsed ? 'justify-center' : ''}`}
                      >
                        <Icon name={item.icon} size={18} className="flex-shrink-0" />
                        {!isCollapsed && <span>{item.label}</span>}
                      </Link>
                      {!isCollapsed && (
                        <button
                          onClick={() => toggleExpand(item.id)}
                          aria-label={isExpanded ? `Collapse ${item.label}` : `Expand ${item.label}`}
                          className="px-2.5 py-2 rounded-md hover:bg-background/80 flex-shrink-0"
                        >
                          <Icon
                            name="ChevronDown"
                            size={16}
                            className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          />
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => toggleExpand(item.id)}
                      className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        parentActive
                          ? 'bg-background text-gray-900'
                          : 'text-gray-500 hover:bg-background hover:text-gray-900'
                      } ${isCollapsed ? 'justify-center' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon name={item.icon} size={18} className="flex-shrink-0" />
                        {!isCollapsed && <span>{item.label}</span>}
                      </div>
                      {!isCollapsed && (
                        <Icon
                          name="ChevronDown"
                          size={16}
                          className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        />
                      )}
                    </button>
                  )}

                  {/* Children (expanded state) */}
                  {isExpanded && !isCollapsed && (() => {
                    const activeIndex = getActiveChildIndex(item.children);

                    return (
                      <div className="relative mt-1">
                        {/* Vertical line from parent to active item */}
                        {activeIndex >= 0 && (
                          <div
                            className="absolute bg-gray-300"
                            style={{
                              left: '20px',
                              top: '-4px',
                              width: '1.5px',
                              height: `calc(${activeIndex} * 32px + 4px)`
                            }}
                          />
                        )}

                        {item.children.map((child, index) => {
                          const isChildActive = index === activeIndex;

                          return (
                            <div key={child.id} className="relative flex items-center pl-3 h-[32px]">
                              {/* Corner connector for active item */}
                              {isChildActive && (
                                <>
                                  {/* Curved corner */}
                                  <div
                                    className="absolute"
                                    style={{
                                      left: '19.25px',
                                      top: 0,
                                      height: 'calc(50% + 1px)',
                                      width: '12px',
                                      borderLeft: '1.5px solid #d1d5db',
                                      borderBottom: '1.5px solid #d1d5db',
                                      borderBottomLeftRadius: '6px'
                                    }}
                                  />
                                  {/* Arrow */}
                                  <div
                                    className="absolute text-gray-300 text-xs"
                                    style={{
                                      left: '30px',
                                      top: '50%',
                                      transform: 'translateY(-50%)'
                                    }}
                                  >
                                    →
                                  </div>
                                </>
                              )}

                              {/* Spacer for alignment */}
                              <div className="w-[38px] shrink-0" />

                              <Link
                                to={child.path}
                                className={`flex-1 px-2 py-1.5 rounded-md text-sm transition-colors ${
                                  isChildActive
                                    ? 'text-gray-900 font-medium bg-background'
                                    : 'text-gray-500 hover:text-gray-900'
                                }`}
                              >
                                {child.label}
                              </Link>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              );
            }

            // Regular nav item (no children)
            const showBadge = item.id === 'dashboard' && pendingApprovals > 0;
            return (
              <Link
                key={item.id}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive(item.path)
                    ? 'bg-background text-gray-900'
                    : 'text-gray-500 hover:bg-background hover:text-gray-900'
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
                    {pendingApprovals > 99 ? '99+' : pendingApprovals}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

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
            const showBadge = item.id === 'dashboard' && pendingApprovals > 0;
            return (
              <Link
                key={item.id}
                to={item.path}
                aria-label={item.label}
                className={`relative flex flex-col items-center justify-center rounded-full transition-all duration-200 ${
                  isScrolling ? 'px-2 py-1 gap-0.5' : 'px-2.5 py-1.5 gap-0.5'
                } ${
                  isActive(item.path)
                    ? 'bg-primary/10 text-primary'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-background'
                }`}
              >
                <Icon name={item.icon} size={isScrolling ? 19 : 20} />
                <span className="text-[10px] leading-none font-medium">{item.label}</span>
                {showBadge && (
                  <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 text-[10px] font-semibold text-white bg-error rounded-full">
                    {pendingApprovals > 9 ? '9+' : pendingApprovals}
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
                const key = item.groupLabel || 'Other';
                if (!groupMap.has(key)) {
                  const group = { label: key, items: [] };
                  groupMap.set(key, group);
                  groups.push(group);
                }
                groupMap.get(key).items.push(item);
              });
              return groups.map(group => (
                <div key={group.label} className="border-b border-border last:border-b-0">
                  {group.label !== 'Other' && (
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
                        isActive(item.path) ? 'bg-background' : 'hover:bg-background'
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
      {newBookingItem && (
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
