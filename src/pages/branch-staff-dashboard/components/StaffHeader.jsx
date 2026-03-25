import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { useAuth } from '../../../contexts/AuthContext';

const StaffHeader = ({ userName: propName, branchName: propBranch, viewMode = 'dashboard', onViewChange }) => {
  const { profile, signOut } = useAuth();
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowProfileDropdown(false);
      }
    };
    if (showProfileDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showProfileDropdown]);

  const userName = profile?.full_name || propName || 'Staff Member';
  const branchName = profile?.branches?.name || propBranch || 'Main Branch';
  const userRole = profile?.role || 'staff';

  const handleLogout = async () => {
    await signOut();
  };

  const currentTime = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <header className="bg-surface border-b border-border sticky top-0 z-header">
      <div className="max-w-screen-2xl mx-auto px-6 lg:px-10">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Branch Info */}
          <div className="flex items-center space-x-4">
            <Link to="/branch-staff-dashboard" className="flex items-center space-x-2">
              <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
                <svg 
                  width="24" 
                  height="24" 
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
                <span className="font-heading font-heading-semibold text-lg text-text-primary">
                  BookSpa
                </span>
                <span className="font-caption font-caption-normal text-xs text-text-secondary -mt-1">
                  Staff Dashboard
                </span>
              </div>
            </Link>
            
            <div className="hidden md:block h-8 w-px bg-border"></div>
            
            <div className="hidden md:flex flex-col">
              <span className="font-body font-body-medium text-sm text-text-primary">
                {branchName}
              </span>
              <span className="font-caption font-caption-normal text-xs text-text-secondary">
                {currentDate}
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="hidden lg:flex items-center space-x-6">
            <button
              onClick={() => onViewChange?.('dashboard')}
              className={`flex items-center space-x-2 px-3 py-2 rounded-spa spa-transition-fast ${
                viewMode === 'dashboard'
                  ? 'text-primary bg-primary/5'
                  : 'text-text-secondary hover:text-primary hover:bg-background'
              }`}
            >
              <Icon name="LayoutDashboard" size={16} />
              <span className="font-body font-body-medium text-sm">Dashboard</span>
            </button>
            <button
              onClick={() => onViewChange?.('bookings')}
              className={`flex items-center space-x-2 px-3 py-2 rounded-spa spa-transition-fast ${
                viewMode === 'bookings'
                  ? 'text-primary bg-primary/5'
                  : 'text-text-secondary hover:text-primary hover:bg-background'
              }`}
            >
              <Icon name="ClipboardList" size={16} />
              <span className="font-body font-body-medium text-sm">Bookings</span>
            </button>
            <button
              onClick={() => onViewChange?.('calendar')}
              className={`flex items-center space-x-2 px-3 py-2 rounded-spa spa-transition-fast ${
                viewMode === 'calendar'
                  ? 'text-primary bg-primary/5'
                  : 'text-text-secondary hover:text-primary hover:bg-background'
              }`}
            >
              <Icon name="Calendar" size={16} />
              <span className="font-body font-body-medium text-sm">Calendar</span>
            </button>
            <button
              onClick={() => onViewChange?.('new-booking')}
              className={`flex items-center space-x-2 px-3 py-2 rounded-spa spa-transition-fast ${
                viewMode === 'new-booking'
                  ? 'text-primary bg-primary/5'
                  : 'text-text-secondary hover:text-primary hover:bg-background'
              }`}
            >
              <Icon name="Plus" size={16} />
              <span className="font-body font-body-medium text-sm">New Booking</span>
            </button>
          </nav>

          {/* Right Section */}
          <div className="flex items-center space-x-4">
            {/* Current Time */}
            <div className="hidden sm:flex items-center space-x-2 px-3 py-2 bg-background rounded-spa">
              <Icon name="Clock" size={16} className="text-primary" />
              <span className="font-data font-data-normal text-sm text-text-primary">
                {currentTime}
              </span>
            </div>

            {/* Notifications */}
            <button className="relative p-2 rounded-spa hover:bg-background spa-transition-fast">
              <Icon name="Bell" size={20} className="text-text-secondary" />
            </button>

            {/* Profile Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowProfileDropdown(!showProfileDropdown)}
                className="flex items-center space-x-3 px-3 py-2 rounded-spa hover:bg-background spa-transition-fast"
              >
                <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                  <Icon name="User" size={16} className="text-primary" />
                </div>
                <div className="hidden md:flex flex-col items-start">
                  <span className="font-body font-body-medium text-sm text-text-primary">
                    {userName}
                  </span>
                  <span className="font-caption font-caption-normal text-xs text-text-secondary capitalize">
                    {userRole}
                  </span>
                </div>
                <Icon name="ChevronDown" size={16} className="text-text-secondary" />
              </button>

              {/* Dropdown Menu */}
              {showProfileDropdown && (
                <div className="absolute right-0 mt-2 w-48 bg-surface rounded-spa spa-shadow-elevated border border-border z-dropdown">
                  <div className="p-3 border-b border-border">
                    <div className="font-body font-body-medium text-sm text-text-primary">
                      {userName}
                    </div>
                    <div className="font-caption font-caption-normal text-xs text-text-secondary">
                      {branchName}
                    </div>
                  </div>
                  <div className="py-2">
                    <button className="flex items-center space-x-2 w-full px-3 py-2 text-left hover:bg-background spa-transition-fast">
                      <Icon name="User" size={16} className="text-text-secondary" />
                      <span className="font-body font-body-normal text-sm text-text-primary">Profile</span>
                    </button>
                    <button className="flex items-center space-x-2 w-full px-3 py-2 text-left hover:bg-background spa-transition-fast">
                      <Icon name="Settings" size={16} className="text-text-secondary" />
                      <span className="font-body font-body-normal text-sm text-text-primary">Settings</span>
                    </button>
                    <button className="flex items-center space-x-2 w-full px-3 py-2 text-left hover:bg-background spa-transition-fast">
                      <Icon name="HelpCircle" size={16} className="text-text-secondary" />
                      <span className="font-body font-body-normal text-sm text-text-primary">Help</span>
                    </button>
                    <div className="border-t border-border my-2"></div>
                    <button 
                      onClick={handleLogout}
                      className="flex items-center space-x-2 w-full px-3 py-2 text-left hover:bg-error/10 text-error spa-transition-fast"
                    >
                      <Icon name="LogOut" size={16} />
                      <span className="font-body font-body-normal text-sm">Logout</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Mobile Menu */}
            <div className="lg:hidden">
              <button className="p-2 rounded-spa hover:bg-background spa-transition-fast">
                <Icon name="Menu" size={20} className="text-text-primary" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      <div className="lg:hidden border-t border-border bg-surface">
        <nav className="flex items-center justify-around py-3">
          <button
            onClick={() => onViewChange?.('dashboard')}
            className={`flex flex-col items-center space-y-1 px-3 py-2 rounded-spa spa-transition-fast ${
              viewMode === 'dashboard'
                ? 'text-primary bg-primary/5'
                : 'text-text-secondary hover:text-primary'
            }`}
          >
            <Icon name="LayoutDashboard" size={20} />
            <span className="font-caption font-caption-normal text-xs">Dashboard</span>
          </button>
          <button
            onClick={() => onViewChange?.('bookings')}
            className={`flex flex-col items-center space-y-1 px-3 py-2 rounded-spa spa-transition-fast ${
              viewMode === 'bookings'
                ? 'text-primary bg-primary/5'
                : 'text-text-secondary hover:text-primary'
            }`}
          >
            <Icon name="ClipboardList" size={20} />
            <span className="font-caption font-caption-normal text-xs">Bookings</span>
          </button>
          <button
            onClick={() => onViewChange?.('calendar')}
            className={`flex flex-col items-center space-y-1 px-3 py-2 rounded-spa spa-transition-fast ${
              viewMode === 'calendar'
                ? 'text-primary bg-primary/5'
                : 'text-text-secondary hover:text-primary'
            }`}
          >
            <Icon name="Calendar" size={20} />
            <span className="font-caption font-caption-normal text-xs">Calendar</span>
          </button>
          <button
            onClick={() => onViewChange?.('new-booking')}
            className={`flex flex-col items-center space-y-1 px-3 py-2 rounded-spa spa-transition-fast ${
              viewMode === 'new-booking'
                ? 'text-primary bg-primary/5'
                : 'text-text-secondary hover:text-primary'
            }`}
          >
            <Icon name="Plus" size={20} />
            <span className="font-caption font-caption-normal text-xs">New Booking</span>
          </button>
        </nav>
      </div>
    </header>
  );
};

export default StaffHeader;