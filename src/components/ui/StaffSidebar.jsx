import React, { useState, useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import Icon from '../AppIcon';
import { useAuth } from 'contexts/AuthContext';
import { useBranch } from 'contexts/BranchContext';
import { useIndustry } from 'hooks/useIndustry';
import { fetchPendingApprovalCount } from 'services/api';

const StaffSidebar = ({ userRole: propRole, userName: propName, branchName: propBranch, onCollapseChange }) => {
  const location = useLocation();
  const { orgSlug: urlOrgSlug } = useParams();
  const { profile, signOut } = useAuth();
  const { branchName: contextBranchName, branchId, isOverall } = useBranch();
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const { staffLabelPlural, locationLabelPlural, enableRooms } = useIndustry();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [expandedItems, setExpandedItems] = useState(['operations']); // Default expanded

  // World Cup 2026 — show the logo-kicks-football animation through July 20, 2026 (Nepal time).
  const showWorldCupKick = new Date() < new Date('2026-07-21T00:00:00+05:45');
  const userRole = profile?.role || propRole || 'staff';
  const userName = profile?.full_name || propName || 'Staff Member';
  const branchName = contextBranchName || profile?.branches?.name || propBranch || 'Main Branch';
  const isManagerOrAdmin = ['manager', 'admin'].includes(userRole);

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
      roles: ['staff', 'manager', 'admin']
    },
    {
      id: 'operations',
      label: 'Operations',
      icon: 'ClipboardList',
      roles: ['staff', 'manager', 'admin'],
      children: [
        {
          id: 'bookings',
          label: 'Bookings',
          path: `${basePath}?view=bookings`,
          roles: ['staff', 'manager', 'admin']
        },
        {
          id: 'calendar',
          label: 'Calendar',
          path: `${basePath}?view=calendar`,
          roles: ['staff', 'manager', 'admin']
        },
        {
          id: 'new-booking',
          label: 'New Booking',
          path: `${basePath}?view=new-booking`,
          roles: ['staff', 'manager', 'admin'],
          overallHidden: true
        },
      ]
    },
    {
      id: 'customers',
      label: 'Customers',
      icon: 'Users',
      path: `${basePath}?view=customers`,
      roles: ['manager', 'admin']
    },
    {
      id: 'insights',
      label: 'Reports',
      icon: 'BarChart3',
      roles: ['manager', 'admin'],
      children: [
        {
          id: 'reports',
          label: 'Daily Report',
          path: `${basePath}?view=reports`,
          roles: ['manager', 'admin']
        },
        {
          id: 'performance',
          label: 'Performance',
          path: `${basePath}?view=performance`,
          roles: ['manager', 'admin']
        },
        {
          id: 'discounts',
          label: 'Discounts Report',
          path: `${basePath}?view=discounts`,
          roles: ['manager', 'admin']
        },
        {
          id: 'attendance-report',
          label: 'Attendance Report',
          path: `${basePath}?view=attendance-report`,
          roles: ['manager', 'admin']
        },
        {
          id: 'attendance-calendar',
          label: 'Attendance Calendar',
          path: orgSlug ? `/${orgSlug}/attendance-calendar` : '/attendance-calendar',
          roles: ['manager', 'admin']
        },
        {
          id: 'transfer-report',
          label: 'Transfer Report',
          path: `${basePath}?view=transfer-report`,
          roles: ['manager', 'admin']
        },
        {
          id: 'outstanding',
          label: 'Outstanding Report',
          path: `${basePath}?view=outstanding`,
          roles: ['manager', 'admin']
        },
        {
          id: 'referrals',
          label: 'Referrals Report',
          path: `${basePath}?view=referrals`,
          roles: ['manager', 'admin']
        },
      ]
    },
    {
      id: 'staff-mgmt',
      label: 'Staff',
      icon: 'UserCog',
      roles: ['manager', 'admin'],
      children: [
        {
          id: 'therapists',
          label: staffLabelPlural,
          path: `${basePath}?view=therapists`,
          roles: ['manager', 'admin']
        },
        {
          id: 'attendance',
          label: 'Attendance',
          path: `${basePath}?view=attendance`,
          roles: ['manager', 'admin'],
          overallHidden: true
        },
      ]
    },
    {
      id: 'payroll',
      label: 'Payroll',
      icon: 'Wallet',
      path: `${basePath}?view=payroll`,
      roles: ['admin'],
    },
    {
      id: 'memberships',
      label: 'Memberships',
      icon: 'CreditCard',
      path: `${basePath}?view=memberships`,
      roles: ['manager', 'admin'],
    },
    {
      id: 'infrastructure',
      label: 'Setup',
      icon: 'Settings',
      roles: ['manager', 'admin'],
      children: [
        // Only show rooms/locations for industries that use them
        ...(enableRooms ? [{
          id: 'rooms',
          label: locationLabelPlural,
          path: `${basePath}?view=rooms`,
          roles: ['manager', 'admin'],
          overallHidden: true
        }] : []),
        {
          id: 'services',
          label: 'Services',
          path: `${basePath}?view=services`,
          roles: ['admin'],
          overallHidden: true
        },
        {
          id: 'categories',
          label: 'Categories',
          path: `${basePath}?view=categories`,
          roles: ['admin'],
          overallHidden: true
        },
        {
          id: 'audit',
          label: 'Audit Log',
          path: `${basePath}?view=audit`,
          roles: ['manager', 'admin']
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

  // Flatten for mobile nav
  const flattenNav = (items) => {
    const result = [];
    items.forEach(item => {
      if (item.children) {
        item.children.forEach(child => result.push(child));
      } else if (item.path) {
        result.push(item);
      }
    });
    return result;
  };

  const flatNavItems = flattenNav(filteredNavItems);
  const mobilePrimaryItems = flatNavItems.slice(0, 4);
  const mobileOverflowItems = flatNavItems.slice(4);

  const isActive = (path) => {
    if (path.includes('?')) {
      return `${location.pathname}${location.search}` === path;
    }
    return location.pathname === path && !location.search;
  };

  const isParentActive = (item) => {
    if (item.children) {
      return item.children.some(child => isActive(child.path));
    }
    return item.path && isActive(item.path);
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
                        {/* Colors come from CSS (currentColor = Zenly green) */}
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
                <h1 className="text-sm font-semibold text-gray-900">Zenly</h1>
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
                  {/* Parent item (button) */}
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

      {/* Mobile Bottom Navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-surface-sidebar border-t border-gray-200 z-staff-sidebar">
        <div className="flex items-center justify-around py-2">
          {mobilePrimaryItems.map((item) => {
            const showBadge = item.id === 'dashboard' && pendingApprovals > 0;
            return (
              <Link
                key={item.id}
                to={item.path}
                className={`flex flex-col items-center gap-1 px-3 py-2 rounded-md transition-colors ${
                  isActive(item.path)
                    ? 'text-gray-900 bg-background'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                <div className="relative">
                  <Icon name={item.icon} size={18} />
                  {showBadge && (
                    <span className="absolute -top-1.5 -right-2 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 text-[10px] font-semibold text-white bg-error rounded-full">
                      {pendingApprovals > 99 ? '99+' : pendingApprovals}
                    </span>
                  )}
                </div>
                <span className="text-xs font-medium">{item.label}</span>
              </Link>
            );
          })}
          {mobileOverflowItems.length > 0 && (
            <button
              onClick={() => setMobileMoreOpen(!mobileMoreOpen)}
              className={`flex flex-col items-center gap-1 px-3 py-2 rounded-md transition-colors ${
                mobileMoreOpen ? 'text-gray-900 bg-background' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <Icon name="MoreHorizontal" size={18} />
              <span className="text-xs font-medium">More</span>
            </button>
          )}
        </div>

        {/* Mobile overflow sheet */}
        {mobileMoreOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/30 z-modal-overlay"
              onClick={() => setMobileMoreOpen(false)}
            />
            <div className="absolute bottom-full left-0 right-0 bg-surface-sidebar border-t border-gray-200 rounded-t-xl shadow-lg z-modal animate-slide-in">
              <div className="p-4 space-y-1">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-gray-900">More</span>
                  <button onClick={() => setMobileMoreOpen(false)} className="p-1 rounded-md hover:bg-background">
                    <Icon name="X" size={16} className="text-gray-500" />
                  </button>
                </div>
                {mobileOverflowItems.map((item) => (
                  <Link
                    key={item.id}
                    to={item.path}
                    onClick={() => setMobileMoreOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                      isActive(item.path)
                        ? 'bg-background text-gray-900'
                        : 'text-gray-500 hover:bg-background hover:text-gray-900'
                    }`}
                  >
                    <Icon name={item.icon} size={18} />
                    <span>{item.label}</span>
                  </Link>
                ))}
                <div className="border-t border-gray-200 mt-2 pt-2">
                  <button
                    onClick={() => { setMobileMoreOpen(false); handleLogout(); }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-red-600 hover:bg-red-50 transition-colors w-full"
                  >
                    <Icon name="LogOut" size={18} />
                    <span>Logout</span>
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </nav>
    </>
  );
};

export default StaffSidebar;
