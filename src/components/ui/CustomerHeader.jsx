import React from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import Icon from '../AppIcon';
import { useTenant } from 'contexts/TenantContext';
import { useCustomerAuth } from 'contexts/CustomerAuthContext';

const CustomerHeader = () => {
  const location = useLocation();
  const { orgSlug } = useParams();

  // Try to get tenant context, but don't fail if not available
  let tenantData = { orgName: 'Zennly', isCleaning: false, isSalon: false };
  try {
    tenantData = useTenant();
  } catch {
    // TenantContext not available, use defaults
  }

  const { orgName, isCleaning, isSalon } = tenantData;

  // Try to get customer auth context, but don't fail if not available
  let customerAuth = { customer: null, customerProfile: null };
  try {
    customerAuth = useCustomerAuth();
  } catch {
    // CustomerAuthContext not available, use defaults
  }

  const { customer, customerProfile } = customerAuth;
  const loginPath = orgSlug ? `/${orgSlug}/customer-login` : '/login';
  const accountPath = orgSlug ? `/${orgSlug}/account` : '/';

  // Build tenant-aware paths
  const bookingPath = orgSlug ? `/${orgSlug}` : '/';
  const managePath = orgSlug ? `/${orgSlug}/manage` : '/';

  const isBookingFlow = location.pathname === bookingPath || location.pathname === `/${orgSlug}`;
  const isManagementPortal = location.pathname === managePath || location.pathname === `/${orgSlug}/manage`;

  // Industry-specific tagline
  const getTagline = () => {
    if (isCleaning) return 'Professional Cleaning';
    if (isSalon) return 'Beauty & Style';
    return 'Wellness & Relaxation';
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-customer-header bg-surface border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to={bookingPath} className="flex items-center space-x-2 group">
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center spa-transition-fast group-hover:bg-primary/90">
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
                {orgName || 'Zennly'}
              </span>
              <span className="font-caption font-caption-normal text-xs text-text-secondary -mt-1">
                {getTagline()}
              </span>
            </div>
          </Link>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center space-x-8">
            <Link
              to={bookingPath}
              className={`font-body font-body-normal text-sm spa-transition-fast hover:text-primary ${
                isBookingFlow ? 'text-primary' : 'text-text-secondary'
              }`}
            >
              Book Service
            </Link>
            <Link
              to={managePath}
              className={`font-body font-body-normal text-sm spa-transition-fast hover:text-primary ${
                isManagementPortal ? 'text-primary' : 'text-text-secondary'
              }`}
            >
              Manage Booking
            </Link>
          </nav>

          {/* Contact & Support */}
          <div className="flex items-center space-x-4">
            {/* Phone Contact */}
            <a 
              href="tel:+977-1-4441234"
              className="hidden sm:flex items-center space-x-2 px-3 py-2 rounded-spa bg-background hover:bg-border/50 spa-transition-fast group"
            >
              <Icon 
                name="Phone" 
                size={16} 
                className="text-primary group-hover:text-primary/80" 
              />
              <span className="font-body font-body-medium text-sm text-text-primary">
                +977-1-4441234
              </span>
            </a>

            {/* Login / Account */}
            <Link
              to={customer && customerProfile ? accountPath : loginPath}
              className="flex items-center space-x-2 px-4 py-2 rounded-spa border border-border hover:bg-background spa-transition-fast spa-touch-target"
            >
              <Icon name="User" size={16} className="text-text-primary" />
              <span className="font-body font-body-medium text-sm text-text-primary">
                {customer && customerProfile ? customerProfile.full_name.split(' ')[0] : 'Login'}
              </span>
            </Link>

            {/* Support Button */}
            <button className="flex items-center space-x-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-spa spa-transition-fast spa-touch-target">
              <Icon name="MessageCircle" size={16} />
              <span className="font-body font-body-medium text-sm">Support</span>
            </button>

            {/* Mobile Menu */}
            <div className="md:hidden">
              <button className="p-2 rounded-spa hover:bg-background spa-transition-fast spa-touch-target">
                <Icon name="Menu" size={20} className="text-text-primary" />
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation */}
        <div className="md:hidden border-t border-border bg-surface">
          <nav className="flex items-center justify-around py-3">
            <Link
              to={bookingPath}
              className={`flex flex-col items-center space-y-1 px-3 py-2 rounded-spa spa-transition-fast ${
                isBookingFlow ? 'text-primary bg-primary/5' : 'text-text-secondary hover:text-primary'
              }`}
            >
              <Icon name="Calendar" size={20} />
              <span className="font-caption font-caption-normal text-xs">Book</span>
            </Link>
            <Link
              to={managePath}
              className={`flex flex-col items-center space-y-1 px-3 py-2 rounded-spa spa-transition-fast ${
                isManagementPortal ? 'text-primary bg-primary/5' : 'text-text-secondary hover:text-primary'
              }`}
            >
              <Icon name="Settings" size={20} />
              <span className="font-caption font-caption-normal text-xs">Manage</span>
            </Link>
            <a 
              href="tel:+977-1-4441234"
              className="flex flex-col items-center space-y-1 px-3 py-2 rounded-spa text-text-secondary hover:text-primary spa-transition-fast"
            >
              <Icon name="Phone" size={20} />
              <span className="font-caption font-caption-normal text-xs">Call</span>
            </a>
          </nav>
        </div>
      </div>
    </header>
  );
};

export default CustomerHeader;