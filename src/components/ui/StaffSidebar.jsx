import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon from '../AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';

const StaffSidebar = ({ userRole: propRole, userName: propName, branchName: propBranch }) => {
  const location = useLocation();
  const { profile, signOut } = useAuth();
  const { branchName: contextBranchName } = useBranch();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const userRole = profile?.role || propRole || 'staff';
  const userName = profile?.full_name || propName || 'Staff Member';
  const branchName = contextBranchName || profile?.branches?.name || propBranch || 'Main Branch';

  const handleLogout = async () => {
    await signOut();
  };

  const navigationItems = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: 'LayoutDashboard',
      path: ['manager', 'admin'].includes(userRole) ? '/branch-manager-dashboard' : '/branch-staff-dashboard',
      roles: ['staff', 'manager', 'admin']
    },
    {
      id: 'bookings',
      label: 'Bookings',
      icon: 'ClipboardList',
      path: ['manager', 'admin'].includes(userRole) ? '/branch-manager-dashboard?view=bookings' : '/branch-staff-dashboard',
      roles: ['staff', 'manager', 'admin']
    },
    {
      id: 'calendar',
      label: 'Calendar',
      icon: 'Calendar',
      path: '/branch-manager-dashboard?view=calendar',
      roles: ['manager', 'admin']
    },
    {
      id: 'reports',
      label: 'Reports',
      icon: 'FileText',
      path: '/branch-manager-dashboard?view=reports',
      roles: ['manager', 'admin']
    },
    {
      id: 'customers',
      label: 'Customers',
      icon: 'Users',
      path: '/branch-manager-dashboard?view=customers',
      roles: ['manager', 'admin']
    },
    {
      id: 'new-booking',
      label: 'New Booking',
      icon: 'Plus',
      path: '/customer-booking-flow',
      roles: ['staff', 'manager', 'admin']
    },
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
    {
      id: 'infrastructure',
      label: 'Infrastructure',
      icon: 'Settings2',
      path: '/branch-manager-dashboard?view=infrastructure',
      roles: ['manager', 'admin']
    },
    {
      id: 'audit',
      label: 'Audit Log',
      icon: 'Shield',
      path: '/branch-manager-dashboard?view=audit',
      roles: ['manager', 'admin']
    }
  ];

  const filteredNavItems = navigationItems.filter(item => 
    item.roles.includes(userRole)
  );

  const isActive = (path) => {
    if (path.includes('?')) {
      return `${location.pathname}${location.search}` === path;
    }
    return location.pathname === path && !location.search;
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className={`fixed left-0 top-0 h-full bg-surface border-r border-border z-staff-sidebar spa-transition-slow ${
        isCollapsed ? 'w-16' : 'w-64'
      } hidden lg:block`}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
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
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-2 rounded-spa hover:bg-background spa-transition-fast"
            >
              <Icon 
                name={isCollapsed ? "ChevronRight" : "ChevronLeft"} 
                size={16} 
                className="text-text-secondary" 
              />
            </button>
          </div>

          {/* User Info */}
          {!isCollapsed && (
            <div className="p-4 border-b border-border">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                  <Icon name="User" size={20} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-body font-body-medium text-sm text-text-primary truncate">
                    {userName}
                  </p>
                  <p className="font-caption font-caption-normal text-xs text-text-secondary truncate">
                    {branchName}
                  </p>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal capitalize ${
                    userRole === 'admin'
                      ? 'bg-pink-100 text-pink-700'
                      : 'bg-accent/10 text-accent'
                  }`}>
                    {userRole === 'admin' ? 'Platform Admin' : userRole}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Navigation — scrollable when items overflow */}
          <nav className="flex-1 overflow-y-auto sidebar-scroll p-4 space-y-1">
            {filteredNavItems.map((item) => (
              <Link
                key={item.id}
                to={item.path}
                className={`flex items-center space-x-3 px-3 py-2 rounded-spa spa-transition-fast spa-touch-target ${
                  isActive(item.path)
                    ? 'bg-primary text-primary-foreground'
                    : 'text-text-secondary hover:text-text-primary hover:bg-background'
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
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-surface border-t border-border z-staff-sidebar">
        <div className="flex items-center justify-around py-2">
          {filteredNavItems.map((item) => (
            <Link
              key={item.id}
              to={item.path}
              className={`flex flex-col items-center space-y-1 px-3 py-2 rounded-spa spa-transition-fast spa-touch-target ${
                isActive(item.path)
                  ? 'text-primary bg-primary/5' :'text-text-secondary hover:text-primary'
              }`}
            >
              <Icon name={item.icon} size={20} />
              <span className="font-caption font-caption-normal text-xs">
                {item.label.split(' ')[0]}
              </span>
            </Link>
          ))}
          <button 
            onClick={handleLogout}
            className="flex flex-col items-center space-y-1 px-3 py-2 rounded-spa text-error hover:bg-error/10 spa-transition-fast spa-touch-target"
          >
            <Icon name="LogOut" size={20} />
            <span className="font-caption font-caption-normal text-xs">Logout</span>
          </button>
        </div>
      </nav>
    </>
  );
};

export default StaffSidebar;