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

  const userRole = profile?.role || propRole || 'staff';
  const userName = profile?.full_name || propName || 'Staff Member';
  const branchName = contextBranchName || profile?.branches?.name || propBranch || 'Main Branch';
  const isManagerOrAdmin = ['manager', 'admin'].includes(userRole);

  const handleLogout = async () => {
    await signOut();
  };

  // Grouped navigation sections
  const navigationSections = [
    {
      id: 'core',
      label: null, // No section label for core items
      items: [
        {
          id: 'dashboard',
          label: 'Home',
          icon: 'Home',
          path: isManagerOrAdmin ? '/branch-manager-dashboard' : '/branch-staff-dashboard',
          roles: ['staff', 'manager', 'admin']
        },
        {
          id: 'bookings',
          label: 'Bookings',
          icon: 'ClipboardList',
          path: isManagerOrAdmin ? '/branch-manager-dashboard?view=bookings' : '/branch-staff-dashboard?view=bookings',
          roles: ['staff', 'manager', 'admin']
        },
        {
          id: 'calendar',
          label: 'Calendar',
          icon: 'Calendar',
          path: isManagerOrAdmin ? '/branch-manager-dashboard?view=calendar' : '/branch-staff-dashboard?view=calendar',
          roles: ['staff', 'manager', 'admin']
        },
        {
          id: 'new-booking',
          label: 'New Booking',
          icon: 'PlusCircle',
          path: isManagerOrAdmin ? '/branch-manager-dashboard?view=new-booking' : '/branch-staff-dashboard?view=new-booking',
          roles: ['staff', 'manager', 'admin']
        },
      ]
    },
    {
      id: 'customers',
      label: 'Customers',
      items: [
        {
          id: 'customers',
          label: 'Customers',
          icon: 'Users',
          path: '/branch-manager-dashboard?view=customers',
          roles: ['manager', 'admin']
        },
      ]
    },
    {
      id: 'staff',
      label: 'Staff',
      items: [
        {
          id: 'attendance',
          label: 'Attendance',
          icon: 'ClipboardCheck',
          path: '/branch-manager-dashboard?view=attendance',
          roles: ['manager', 'admin']
        },
        {
          id: 'performance',
          label: 'Performance',
          icon: 'Award',
          path: '/branch-manager-dashboard?view=performance',
          roles: ['manager', 'admin']
        },
      ]
    },
    {
      id: 'analytics',
      label: 'Analytics',
      items: [
        {
          id: 'reports',
          label: 'Reports',
          icon: 'BarChart3',
          path: '/branch-manager-dashboard?view=reports',
          roles: ['manager', 'admin']
        },
        {
          id: 'audit',
          label: 'Audit Log',
          icon: 'Shield',
          path: '/branch-manager-dashboard?view=audit',
          roles: ['manager', 'admin']
        },
      ]
    },
    {
      id: 'setup',
      label: 'Setup',
      items: [
        {
          id: 'rooms',
          label: 'Rooms',
          icon: 'DoorOpen',
          path: '/branch-manager-dashboard?view=rooms',
          roles: ['manager', 'admin']
        },
        {
          id: 'services',
          label: 'Services',
          icon: 'Sparkles',
          path: '/branch-manager-dashboard?view=services',
          roles: ['admin']
        },
        {
          id: 'therapists',
          label: 'Therapists',
          icon: 'UserCog',
          path: '/branch-manager-dashboard?view=therapists',
          roles: ['manager', 'admin']
        },
      ]
    },
  ];

  // Filter sections and items by role
  const filteredSections = navigationSections
    .map(section => ({
      ...section,
      items: section.items.filter(item => item.roles.includes(userRole))
    }))
    .filter(section => section.items.length > 0);

  // Flat list for mobile
  const allNavItems = filteredSections.flatMap(s => s.items);
  const mobilePrimaryItems = allNavItems.slice(0, 4);
  const mobileOverflowItems = allNavItems.slice(4);

  const isActive = (path) => {
    if (path.includes('?')) {
      return `${location.pathname}${location.search}` === path;
    }
    return location.pathname === path && !location.search;
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <aside style={{ backgroundColor: '#FAFAFA' }} className={`fixed left-0 top-0 h-full z-staff-sidebar spa-transition-slow ${
        isCollapsed ? 'w-16' : 'w-64'
      } hidden lg:block`}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4">
            {!isCollapsed && (
              <Link to="/branch-staff-dashboard" className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    className="text-primary-foreground"
                  >
                    <path
                      d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z"
                      fill="currentColor"
                    />
                    <circle cx="12" cy="19" r="2" fill="currentColor" opacity="0.7"/>
                  </svg>
                </div>
                <div className="flex flex-col">
                  <span className="font-heading font-heading-semibold text-sm text-text-primary">
                    BookSpa
                  </span>
                  <span className="font-caption font-caption-normal text-xs text-text-secondary -mt-0.5">
                    Staff Portal
                  </span>
                </div>
              </Link>
            )}
            <button
              onClick={() => {
                const next = !isCollapsed;
                setIsCollapsed(next);
                onCollapseChange?.(next);
              }}
              className="p-2 rounded-spa hover:bg-background spa-transition-fast"
            >
              <Icon
                name={isCollapsed ? "ChevronRight" : "ChevronLeft"}
                size={16}
                className="text-text-secondary"
              />
            </button>
          </div>

          {/* Navigation — grouped sections */}
          <nav className="flex-1 overflow-y-auto sidebar-scroll px-3 pt-1 pb-3">
            {filteredSections.map((section, sIdx) => (
              <div key={section.id} className={sIdx > 0 ? 'mt-4' : ''}>
                {/* Section label */}
                {section.label && !isCollapsed && (
                  <div className="px-3 mb-1">
                    <span className="font-caption font-caption-normal text-xs text-text-secondary uppercase tracking-wider">
                      {section.label}
                    </span>
                  </div>
                )}
                {section.label && isCollapsed && (
                  <div className="mx-2 mb-1 border-t border-border" />
                )}
                <div className="space-y-0.5">
                  {section.items.map((item) => (
                    <Link
                      key={item.id}
                      to={item.path}
                      className={`flex items-center space-x-3 px-3 py-2 rounded-spa spa-transition-fast spa-touch-target ${
                        isActive(item.path)
                          ? 'bg-[rgba(0,0,23,0.043)] border border-[rgba(0,0,29,0.075)] text-text-primary'
                          : 'text-text-secondary hover:text-text-primary hover:bg-background border border-transparent'
                      } ${isCollapsed ? 'justify-center' : ''}`}
                    >
                      <Icon name={item.icon} size={20} />
                      {!isCollapsed && (
                        <span className="font-body font-body-medium text-sm">
                          {item.label}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {/* Footer Actions */}
          <div className="p-4 border-t border-border space-y-2">
            <button className={`flex items-center space-x-3 px-3 py-2 rounded-spa text-text-secondary hover:text-text-primary hover:bg-background spa-transition-fast w-full spa-touch-target ${
              isCollapsed ? 'justify-center' : ''
            }`}>
              <Icon name="Settings" size={20} />
              {!isCollapsed && (
                <span className="font-body font-body-medium text-sm">Settings</span>
              )}
            </button>
            <button
              onClick={handleLogout}
              className={`flex items-center space-x-3 px-3 py-2 rounded-spa text-error hover:bg-error/10 spa-transition-fast w-full spa-touch-target ${
                isCollapsed ? 'justify-center' : ''
              }`}
            >
              <Icon name="LogOut" size={20} />
              {!isCollapsed && (
                <span className="font-body font-body-medium text-sm">Logout</span>
              )}
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Bottom Navigation */}
      <nav style={{ backgroundColor: '#FAFAFA' }} className="lg:hidden fixed bottom-0 left-0 right-0 border-t border-border z-staff-sidebar">
        <div className="flex items-center justify-around py-2">
          {mobilePrimaryItems.map((item) => (
            <Link
              key={item.id}
              to={item.path}
              className={`flex flex-col items-center space-y-1 px-3 py-2 rounded-spa spa-transition-fast spa-touch-target ${
                isActive(item.path)
                  ? 'text-text-primary bg-[rgba(0,0,23,0.043)] border border-[rgba(0,0,29,0.075)]'
                  : 'text-text-secondary hover:text-primary border border-transparent'
              }`}
            >
              <Icon name={item.icon} size={20} />
              <span className="font-caption font-caption-normal text-xs">
                {item.label}
              </span>
            </Link>
          ))}
          {mobileOverflowItems.length > 0 && (
            <button
              onClick={() => setMobileMoreOpen(!mobileMoreOpen)}
              className={`flex flex-col items-center space-y-1 px-3 py-2 rounded-spa spa-transition-fast spa-touch-target ${
                mobileMoreOpen ? 'text-primary bg-primary/5' : 'text-text-secondary hover:text-primary'
              }`}
            >
              <Icon name="MoreHorizontal" size={20} />
              <span className="font-caption font-caption-normal text-xs">More</span>
            </button>
          )}
        </div>

        {/* Mobile overflow sheet */}
        {mobileMoreOpen && (
          <>
            <div
              className="fixed inset-0 bg-text-primary/30 z-modal-overlay"
              onClick={() => setMobileMoreOpen(false)}
            />
            <div className="absolute bottom-full left-0 right-0 bg-surface border-t border-border rounded-t-spa-lg shadow-spa-modal z-modal animate-slide-in">
              <div className="p-4 space-y-1">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-heading font-heading-medium text-sm text-text-primary">More</span>
                  <button onClick={() => setMobileMoreOpen(false)} className="p-1 rounded-spa hover:bg-background">
                    <Icon name="X" size={16} className="text-text-secondary" />
                  </button>
                </div>
                {mobileOverflowItems.map((item) => (
                  <Link
                    key={item.id}
                    to={item.path}
                    onClick={() => setMobileMoreOpen(false)}
                    className={`flex items-center space-x-3 px-3 py-2.5 rounded-spa spa-transition-fast ${
                      isActive(item.path)
                        ? 'bg-[rgba(0,0,23,0.043)] border border-[rgba(0,0,29,0.075)] text-text-primary'
                        : 'text-text-secondary hover:text-text-primary hover:bg-background border border-transparent'
                    }`}
                  >
                    <Icon name={item.icon} size={20} />
                    <span className="font-body font-body-medium text-sm">{item.label}</span>
                  </Link>
                ))}
                <div className="border-t border-border mt-2 pt-2">
                  <button
                    onClick={() => { setMobileMoreOpen(false); handleLogout(); }}
                    className="flex items-center space-x-3 px-3 py-2.5 rounded-spa text-error hover:bg-error/10 spa-transition-fast w-full"
                  >
                    <Icon name="LogOut" size={20} />
                    <span className="font-body font-body-medium text-sm">Logout</span>
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