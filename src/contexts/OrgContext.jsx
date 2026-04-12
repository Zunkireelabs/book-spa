import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

const OrgContext = createContext(null);

export const OrgProvider = ({ children }) => {
  const { profile, loading: authLoading } = useAuth();
  const [org, setOrg] = useState(null);
  const [industry, setIndustry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch organization data
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
          .select('id, name, code, slug, timezone, currency, is_active, settings, industry_type')
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

  // Fetch industry data when org loads
  useEffect(() => {
    const fetchIndustry = async () => {
      if (!org?.industry_type) {
        setIndustry(null);
        return;
      }

      try {
        const { data, error: fetchError } = await supabase
          .from('industries')
          .select('*')
          .eq('id', org.industry_type)
          .single();

        if (fetchError) {
          console.error('[OrgContext] Error fetching industry:', fetchError.message);
          // Don't set error - industry is optional, fall back to defaults
        } else {
          setIndustry(data);
        }
      } catch (err) {
        console.error('[OrgContext] Unexpected error fetching industry:', err.message);
      }
    };

    fetchIndustry();
  }, [org?.industry_type]);

  const value = {
    // Existing org values
    org,
    orgId: profile?.org_id || null,
    orgName: org?.name || null,
    orgCode: org?.code || null,
    orgTimezone: org?.timezone || 'Asia/Kathmandu',
    orgCurrency: org?.currency || 'NPR',
    orgSettings: org?.settings || {},
    loading: authLoading || loading,
    error,

    // Industry data
    industry,
    industryType: org?.industry_type || 'spa',

    // Terminology (with spa defaults)
    staffLabel: industry?.staff_label || 'Therapist',
    staffLabelPlural: industry?.staff_label_plural || 'Therapists',
    locationLabel: industry?.location_label || 'Room',
    locationLabelPlural: industry?.location_label_plural || 'Rooms',
    sessionLabel: industry?.session_label || 'Session',
    sessionLabelPlural: industry?.session_label_plural || 'Sessions',

    // Feature flags (default to spa behavior: all enabled)
    enableRooms: industry?.enable_rooms !== false,
    enableStaffGender: industry?.enable_staff_gender !== false,
    enableSpecialties: industry?.enable_specialties !== false,
    enableCustomerGender: industry?.enable_customer_gender !== false,

    // Industry default categories
    defaultCategories: industry?.default_categories || [],
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
