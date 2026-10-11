import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTenant } from '../../contexts/TenantContext';
import LoginForm from './components/LoginForm';
import BrandMark from '../../components/ui/BrandMark';

const StaffLoginAuthentication = () => {
  const { orgSlug } = useParams();
  const { organization, loading: tenantLoading } = useTenant();
  const [dbStatus, setDbStatus] = useState('checking');

  // Check Supabase connection status
  useEffect(() => {
    const checkConnection = async () => {
      try {
        // Simple fetch to check if Supabase is reachable. Must hit a real
        // table, not the bare /rest/v1/ root: that root is PostgREST's
        // OpenAPI discovery endpoint, which Supabase's newer sb_publishable_/
        // sb_secret_ key format restricts to secret keys only — it 401s
        // unconditionally with a publishable/anon key regardless of whether
        // the database is actually reachable, which made this check a
        // permanent false positive once the anon key moved to that format.
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/organizations?select=id&limit=1`,
          {
            method: 'HEAD',
            headers: {
              'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
          }
        );
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
          <BrandMark className="h-7 w-auto" />
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
          {/* Title & Subtitle */}
          <h1 className="text-[28px] font-semibold text-text-primary mb-2 text-center tracking-tight">
            Sign in to {orgName}
          </h1>
          <p className="text-[15px] text-text-secondary mb-8 text-center">
            Access your staff portal
          </p>

          {/* Service-unavailable banner: shown when the health probe can't reach
              the database, so staff aren't left guessing why login fails. */}
          {dbStatus === 'offline' && (
            <div className="w-full mb-5 px-4 py-3 rounded-spa bg-warning/10 border border-warning/30 text-sm text-warning text-center">
              We're having trouble reaching the server. Login may not work right now — please try again shortly.
            </div>
          )}

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
