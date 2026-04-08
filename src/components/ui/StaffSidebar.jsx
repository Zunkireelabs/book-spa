import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon from '../AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';

const StaffSidebar = ({ userRole: propRole, userName: propName, branchName: propBranch, onCollapseChange }) => {
  const location = useLocation();
  const { profile, signOut } = useAuth();
  const { branchName: contextBranchName } = useBranch();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [expandedItems, setExpandedItems] = useState(['operations']); // Default expanded
  const userRole = profile?.role || propRole || 'staff';
  const userName = profile?.full_name || propName || 'Staff Member';
  const branchName = contextBranchName || profile?.branches?.name || propBranch || 'Main Branch';
  const isManagerOrAdmin = ['manager', 'admin'].includes(userRole);

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
      path: isManagerOrAdmin ? '/branch-manager-dashboard' : '/branch-staff-dashboard',
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
          path: isManagerOrAdmin ? '/branch-manager-dashboard?view=bookings' : '/branch-staff-dashboard?view=bookings',
          roles: ['staff', 'manager', 'admin']
        },
        {
          id: 'calendar',
          label: 'Calendar',
          path: isManagerOrAdmin ? '/branch-manager-dashboard?view=calendar' : '/branch-staff-dashboard?view=calendar',
          roles: ['staff', 'manager', 'admin']
        },
        {
          id: 'new-booking',
          label: 'New Booking',
          path: isManagerOrAdmin ? '/branch-manager-dashboard?view=new-booking' : '/branch-staff-dashboard?view=new-booking',
          roles: ['staff', 'manager', 'admin']
        },
      ]
    },
    {
      id: 'customers',
      label: 'Customers',
      icon: 'Users',
      path: '/branch-manager-dashboard?view=customers',
      roles: ['manager', 'admin']
    },
    {
      id: 'insights',
      label: 'Insights',
      icon: 'BarChart3',
      roles: ['manager', 'admin'],
      children: [
        {
          id: 'reports',
          label: 'Reports',
          path: '/branch-manager-dashboard?view=reports',
          roles: ['manager', 'admin']
        },
        {
          id: 'performance',
          label: 'Performance',
          path: '/branch-manager-dashboard?view=performance',
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
          label: 'Therapists',
          path: '/branch-manager-dashboard?view=therapists',
          roles: ['manager', 'admin']
        },
        {
          id: 'attendance',
          label: 'Attendance',
          path: '/branch-manager-dashboard?view=attendance',
          roles: ['manager', 'admin']
        },
      ]
    },
    {
      id: 'infrastructure',
      label: 'Setup',
      icon: 'Settings',
      roles: ['manager', 'admin'],
      children: [
        {
          id: 'rooms',
          label: 'Rooms',
          path: '/branch-manager-dashboard?view=rooms',
          roles: ['manager', 'admin']
        },
        {
          id: 'services',
          label: 'Services',
          path: '/branch-manager-dashboard?view=services',
          roles: ['admin']
        },
        {
          id: 'categories',
          label: 'Categories',
          path: '/branch-manager-dashboard?view=categories',
          roles: ['admin']
        },
        {
          id: 'audit',
          label: 'Audit Log',
          path: '/branch-manager-dashboard?view=audit',
          roles: ['manager', 'admin']
        },
      ]
    },
  ];

  // Filter items by role (including children)
  const filterByRole = (items) => {
    return items
      .filter(item => item.roles.includes(userRole))
      .map(item => {
        if (item.children) {
          return {
            ...item,
            children: item.children.filter(child => child.roles.includes(userRole))
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
      <aside className={`fixed left-0 top-0 h-full z-staff-sidebar bg-[#ebebeb] flex flex-col transition-all duration-200 ${
        isCollapsed ? 'w-16' : 'w-60'
      } hidden lg:flex`}>
        {/* Header */}
        <div className="px-5 py-3 h-[52px] flex items-center justify-between">
          {!isCollapsed && (
            <Link to="/branch-staff-dashboard" className="flex items-center gap-3">
              <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="text-white"
                >
                  <path
                    d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z"
                    fill="currentColor"
                  />
                  <circle cx="12" cy="19" r="2" fill="currentColor" opacity="0.7"/>
                </svg>
              </div>
              <div>
                <h1 className="text-sm font-semibold text-gray-900">BookSpa</h1>
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
            className="p-2 rounded-md hover:bg-[#fafafa] transition-colors"
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
                        ? 'bg-[#fafafa] text-gray-900'
                        : 'text-gray-500 hover:bg-[#fafafa] hover:text-gray-900'
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
                                    ? 'text-gray-900 font-medium bg-[#fafafa]'
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
            return (
              <Link
                key={item.id}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive(item.path)
                    ? 'bg-[#fafafa] text-gray-900'
                    : 'text-gray-500 hover:bg-[#fafafa] hover:text-gray-900'
                } ${isCollapsed ? 'justify-center' : ''}`}
              >
                <Icon name={item.icon} size={18} className="flex-shrink-0" />
                {!isCollapsed && <span>{item.label}</span>}
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
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-[#ebebeb] border-t border-gray-200 z-staff-sidebar">
        <div className="flex items-center justify-around py-2">
          {mobilePrimaryItems.map((item) => (
            <Link
              key={item.id}
              to={item.path}
              className={`flex flex-col items-center gap-1 px-3 py-2 rounded-md transition-colors ${
                isActive(item.path)
                  ? 'text-gray-900 bg-[#fafafa]'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <Icon name={item.icon} size={18} />
              <span className="text-xs font-medium">{item.label}</span>
            </Link>
          ))}
          {mobileOverflowItems.length > 0 && (
            <button
              onClick={() => setMobileMoreOpen(!mobileMoreOpen)}
              className={`flex flex-col items-center gap-1 px-3 py-2 rounded-md transition-colors ${
                mobileMoreOpen ? 'text-gray-900 bg-[#fafafa]' : 'text-gray-500 hover:text-gray-900'
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
            <div className="absolute bottom-full left-0 right-0 bg-[#ebebeb] border-t border-gray-200 rounded-t-xl shadow-lg z-modal animate-slide-in">
              <div className="p-4 space-y-1">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-gray-900">More</span>
                  <button onClick={() => setMobileMoreOpen(false)} className="p-1 rounded-md hover:bg-[#fafafa]">
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
                        ? 'bg-[#fafafa] text-gray-900'
                        : 'text-gray-500 hover:bg-[#fafafa] hover:text-gray-900'
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