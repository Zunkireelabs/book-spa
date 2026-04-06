import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

const OrgContext = createContext(null);

export const OrgProvider = ({ children }) => {
  const { profile, loading: authLoading } = useAuth();
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchOrg = async () => {
      if (authLoading) return;

      if (!profile?.org_id) {
        setLoading(false);
        return;
      }

      try {
        const { data, error: fetchError } = await supabase
          .from('organizations')
          .select('id, name, code, slug, timezone, currency, is_active, settings')
          .eq('id', profile.org_id)
          .single();

        if (fetchError) {
          console.error('[OrgContext] Error fetching organization:', fetchError.message);
          setError(fetchError.message);
        } else {
          setOrg(data);
        }
      } catch (err) {
        console.error('[OrgContext] Unexpected error:', err.message);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchOrg();
  }, [profile?.org_id, authLoading]);

  const value = {
    org,
    orgId: profile?.org_id || null,
    orgName: org?.name || null,
    orgCode: org?.code || null,
    orgTimezone: org?.timezone || 'Asia/Kathmandu',
    orgCurrency: org?.currency || 'NPR',
    orgSettings: org?.settings || {},
    loading: authLoading || loading,
    error,
  };

  return (
    <OrgContext.Provider value={value}>
      {children}
    </OrgContext.Provider>
  );
};

export const useOrg = () => {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error('useOrg must be used within an OrgProvider');
  }
  return context;
};

export default OrgContext;
