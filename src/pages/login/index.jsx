import React, { useState, useEffect } from 'react';
import { useTenant } from '../../contexts/TenantContext';
import LoginForm from './components/LoginForm';
import AuthSplitLayout from '../../components/auth/AuthSplitLayout';

const StaffLoginAuthentication = () => {
  const { organization } = useTenant();
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

  return (
    <AuthSplitLayout
      title="Welcome back"
      subtitle={organization?.name ? `Login to ${organization.name}` : 'Login to your Zennly account'}
      bottom={
        <>
          Don't have an account?{' '}
          <button type="button" className="font-medium text-[#111] hover:underline">
            Contact admin
          </button>
        </>
      }
    >
      {/* Service-unavailable banner: shown when the health probe can't reach
          the database, so staff aren't left guessing why login fails. */}
      {dbStatus === 'offline' && (
        <div className="mb-3.5 rounded-[10px] border border-warning/30 bg-warning/10 px-3.5 py-3 text-sm leading-snug text-warning">
          We're having trouble reaching the server. Login may not work right now — please try again shortly.
        </div>
      )}
      <LoginForm />
    </AuthSplitLayout>
  );
};

export default StaffLoginAuthentication;
