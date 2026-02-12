import React from 'react';
import SecurityHeader from './components/SecurityHeader';
import LoginForm from './components/LoginForm';
import TrustSignals from './components/TrustSignals';

const StaffLoginAuthentication = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Security Header */}
      <SecurityHeader />

      {/* Main Content */}
      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            {/* Left Column - Trust Signals & Branding */}
            <div className="order-2 lg:order-1">
              <TrustSignals />
            </div>

            {/* Right Column - Login Form */}
            <div className="order-1 lg:order-2">
              <div className="bg-surface rounded-spa-lg spa-shadow-elevated p-8">
                <LoginForm />
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-surface border-t border-border mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Company Info */}
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
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
                <span className="font-heading font-heading-semibold text-lg text-text-primary">
                  BookSpa
                </span>
              </div>
              <p className="font-body font-body-normal text-sm text-text-secondary">
                Nepal's premier spa booking management system serving wellness centers across the country.
              </p>
            </div>

            {/* Support */}
            <div className="space-y-4">
              <h3 className="font-heading font-heading-medium text-base text-text-primary">
                IT Support
              </h3>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <span className="font-body font-body-normal text-sm text-text-secondary">
                    Emergency: +977-1-4567890
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="font-body font-body-normal text-sm text-text-secondary">
                    Email: support@bookspa.com.np
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="font-body font-body-normal text-sm text-text-secondary">
                    Hours: 24/7 Support Available
                  </span>
                </div>
              </div>
            </div>

            {/* Security */}
            <div className="space-y-4">
              <h3 className="font-heading font-heading-medium text-base text-text-primary">
                Security & Compliance
              </h3>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <span className="font-body font-body-normal text-sm text-text-secondary">
                    SSL Certificate Active
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="font-body font-body-normal text-sm text-text-secondary">
                    GDPR Compliant
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="font-body font-body-normal text-sm text-text-secondary">
                    Nepal Business Licensed
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Bar */}
          <div className="flex flex-col md:flex-row items-center justify-between pt-8 mt-8 border-t border-border">
            <p className="font-caption font-caption-normal text-sm text-text-secondary">
              © {new Date().getFullYear()} BookSpa Nepal. All rights reserved.
            </p>
            <div className="flex items-center space-x-6 mt-4 md:mt-0">
              <button className="font-caption font-caption-normal text-sm text-text-secondary hover:text-primary spa-transition-fast">
                Privacy Policy
              </button>
              <button className="font-caption font-caption-normal text-sm text-text-secondary hover:text-primary spa-transition-fast">
                Terms of Service
              </button>
              <button className="font-caption font-caption-normal text-sm text-text-secondary hover:text-primary spa-transition-fast">
                Security Policy
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default StaffLoginAuthentication;