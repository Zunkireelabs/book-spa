import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { fetchOrganizationBySlug } from '../../services/api';
import { supabase } from '../../lib/supabase';

const OrgFinder = () => {
  const navigate = useNavigate();
  const { user, profile, loading: authLoading } = useAuth();
  const [orgInput, setOrgInput] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState('checking');

  // Check Supabase connection status
  useEffect(() => {
    const checkConnection = async () => {
      try {
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

  // If already logged in with a profile, redirect to their org dashboard
  useEffect(() => {
    if (!authLoading && user && profile?.organizations?.slug) {
      navigate(`/${profile.organizations.slug}/dashboard`, { replace: true });
    }
  }, [authLoading, user, profile, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const slug = orgInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (!slug) {
      setError('Please enter an organization name or ID');
      return;
    }

    setIsLoading(true);

    const { data: org, error: fetchError } = await fetchOrganizationBySlug(slug);

    if (fetchError || !org) {
      setError('Organization not found. Please check the name and try again.');
      setIsLoading(false);
      return;
    }

    // Organization found - redirect to its login page
    navigate(`/${org.slug}/login`);
  };

  // Show loading while auth is checking
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center animate-pulse">
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
              <circle cx="12" cy="19" r="2" fill="currentColor" opacity="0.7" />
            </svg>
          </div>
          <p className="text-sm text-text-secondary">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
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
            Zenly
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
            Welcome to Zenly
          </h1>
          <p className="text-[15px] text-text-secondary mb-8 text-center">
            Enter your organization name to continue
          </p>

          {/* Form */}
          <div className="w-full">
            {/* Error Message */}
            {error && (
              <div className="mb-4 p-3 bg-error/10 text-error rounded-[10px] text-sm font-medium">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <input
                  type="text"
                  value={orgInput}
                  onChange={(e) => {
                    setOrgInput(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="e.g., nuad-thai-spa"
                  disabled={isLoading}
                  className="w-full px-3.5 py-3 text-sm bg-surface border border-border rounded-[10px] text-text-primary placeholder:text-text-secondary outline-none transition-all duration-150 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-background disabled:cursor-not-allowed"
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 px-5 bg-primary text-primary-foreground rounded-[10px] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Finding...' : 'Continue'}
              </button>
            </form>

            {/* Help Text */}
            <p className="mt-5 text-center text-sm text-text-secondary">
              Don't know your organization ID?{' '}
              <button
                type="button"
                className="text-text-primary font-medium underline underline-offset-2 hover:opacity-80 transition-opacity"
              >
                Contact admin
              </button>
            </p>
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
          <span>&copy; {new Date().getFullYear()} Zenly</span>
        </div>
      </footer>
    </div>
  );
};

export default OrgFinder;
