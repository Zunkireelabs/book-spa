import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTenant } from '../../contexts/TenantContext';
import LoginForm from './components/LoginForm';

const StaffLoginAuthentication = () => {
  const { orgSlug } = useParams();
  const { organization, loading: tenantLoading } = useTenant();
  const [dbStatus, setDbStatus] = useState('checking');

  // Check Supabase connection status
  useEffect(() => {
    const checkConnection = async () => {
      try {
        // Simple fetch to check if Supabase is reachable
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/`, {
          method: 'HEAD',
          headers: {
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        });
        setDbStatus(response.ok ? 'online' : 'offline');
      } catch {
        setDbStatus('offline');
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 30000);
    return () => clearInterval(interval);
  }, []);

  // Get org name for display
  const orgName = organization?.name || 'Zennly';

  return (
    <div className="login-page min-h-screen bg-background flex flex-col">
      {/* Minimal Header */}
      <header className="flex-shrink-0 px-6 md:px-8 py-5 flex justify-between items-center">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-primary rounded-md flex items-center justify-center">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              className="text-primary-foreground"
            >
              <path
                d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z"
                fill="currentColor"
              />
              <circle cx="12" cy="19" r="2" fill="currentColor" opacity="0.7" />
            </svg>
          </div>
          <span className="text-lg font-semibold text-text-primary tracking-tight">
            {orgName}
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <div
            className={`w-2 h-2 rounded-full ${
              dbStatus === 'online'
                ? 'bg-success'
                : dbStatus === 'offline'
                ? 'bg-error'
                : 'bg-text-secondary'
            }`}
          />
          <span className="hidden sm:inline">
            {dbStatus === 'online' && 'Connected'}
            {dbStatus === 'offline' && 'Offline'}
            {dbStatus === 'checking' && 'Checking...'}
          </span>
        </div>
      </header>

      {/* Main Content - Centered */}
      <main className="flex-1 flex flex-col items-center px-5 py-10 overflow-y-auto">
        <div className="w-full max-w-[380px] mx-auto flex flex-col items-center">
          {/* Large Logo Icon */}
          <div className="w-16 h-16 bg-primary rounded-xl flex items-center justify-center mb-6">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              className="text-primary-foreground"
            >
              <path
                d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z"
                fill="currentColor"
              />
              <circle cx="12" cy="19" r="2" fill="currentColor" opacity="0.7" />
            </svg>
          </div>

          {/* Title & Subtitle */}
          <h1 className="text-[28px] font-semibold text-text-primary mb-2 text-center tracking-tight">
            Sign in to {orgName}
          </h1>
          <p className="text-[15px] text-text-secondary mb-8 text-center">
            Access your staff portal
          </p>

          {/* Login Form Card */}
          <div className="w-full">
            <LoginForm />
          </div>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="flex-shrink-0 py-5 flex flex-col items-center gap-3">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="text-text-secondary">from</span>
          <img
            src="/zunkireelabs-icon.png"
            alt="Zunkireelabs"
            className="w-[18px] h-[18px]"
          />
          <span className="font-medium text-text-primary">zunkireelabs</span>
        </div>
        <div className="flex items-center gap-6 text-xs text-text-secondary">
          <a href="#" className="hover:text-text-primary transition-colors">
            Terms of service
          </a>
          <a href="#" className="hover:text-text-primary transition-colors">
            Privacy policy
          </a>
          <span>&copy; {new Date().getFullYear()} Zennly</span>
        </div>
      </footer>
    </div>
  );
};

export default StaffLoginAuthentication;
