import React from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../../components/AppIcon';

const SecurityHeader = () => {
  return (
    <header className="bg-surface border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/customer-booking-flow" className="flex items-center space-x-3">
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
                BooX
              </span>
              <span className="font-caption font-caption-normal text-xs text-text-secondary -mt-1">
                Staff Portal
              </span>
            </div>
          </Link>

          {/* Security Indicators */}
          <div className="flex items-center space-x-4">
            {/* SSL Badge */}
            <div className="hidden sm:flex items-center space-x-2 px-3 py-1 bg-success/10 rounded-spa">
              <Icon name="Shield" size={16} className="text-success" />
              <span className="font-caption font-caption-normal text-xs text-success">
                SSL Secured
              </span>
            </div>

            {/* Current Time */}
            <div className="hidden md:flex items-center space-x-2 text-text-secondary">
              <Icon name="Clock" size={16} />
              <span className="font-caption font-caption-normal text-sm">
                {new Date().toLocaleString('en-NP', {
                  timeZone: 'Asia/Kathmandu',
                  hour: '2-digit',
                  minute: '2-digit',
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric'
                })}
              </span>
            </div>

            {/* Customer Portal Link */}
            <Link
              to="/customer-booking-flow"
              className="flex items-center space-x-2 px-3 py-2 text-text-secondary hover:text-primary spa-transition-fast"
            >
              <Icon name="ArrowLeft" size={16} />
              <span className="font-body font-body-normal text-sm">
                Customer Portal
              </span>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
};

export default SecurityHeader;