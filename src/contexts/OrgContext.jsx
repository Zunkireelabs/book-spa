import { NEPAL_TZ } from '../utils/nepalTime';
import { friendlyError } from '../utils/friendlyError';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { getOrgPaymentMethods } from '../services/paymentMethods';
import { setIndustryTerms } from '../utils/industryTerms';

const OrgContext = createContext(null);

export const OrgProvider = ({ children }) => {
  const { profile, loading: authLoading } = useAuth();
  const [org, setOrg] = useState(null);
  const [industry, setIndustry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch organization data
  const loadOrg = useCallback(async () => {
    if (!profile?.org_id) {
      setLoading(false);
      return;
    }

    try {
      const { data, error: fetchError } = await supabase
        .from('organizations')
        .select('id, name, code, slug, timezone, currency, is_active, settings, industry_type, logo_url, hero_image_url, enforce_staff_availability, allow_staff_overlap, require_customer_phone, multi_service_bookings, extend_by_drag')
        .eq('id', profile.org_id)
        .single();

      if (fetchError) {
        console.error('[OrgContext] Error fetching organization:', fetchError.message);
        setError(friendlyError(fetchError));
      } else {
        setOrg(data);
      }
    } catch (err) {
      console.error('[OrgContext] Unexpected error:', err.message);
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }, [profile?.org_id]);

  useEffect(() => {
    if (authLoading) return;
    loadOrg();
  }, [authLoading, loadOrg]);

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

  // Plain modules (api.js messages, friendlyError) read the org's own words from here; idempotent, so safe in render.
  setIndustryTerms({
    staff: industry?.staff_label, staffPlural: industry?.staff_label_plural,
    room: industry?.location_label, roomPlural: industry?.location_label_plural,
    spa: (org?.industry_type || 'spa') === 'spa',
  });

  const value = {
    // Existing org values
    org,
    orgId: profile?.org_id || null,
    orgName: org?.name || null,
    orgLogoUrl: org?.logo_url || null, // ZNLY-410: the bill shows it when there is one (no business has uploaded one yet)
    orgCode: org?.code || null,
    orgTimezone: org?.timezone || NEPAL_TZ,
    orgCurrency: org?.currency || 'NPR',
    orgSettings: org?.settings || {},
    paymentMethods: getOrgPaymentMethods(org?.settings),
    enforceStaffAvailability: org?.enforce_staff_availability === true,
    // ZNLY-389: this org lets one staff member hold overlapping bookings (default off: the database refuses a double booking).
    allowStaffOverlap: org?.allow_staff_overlap === true,
    // ZNLY-402: "several services in one booking" = the visit model (default off: every behaviour as before; also while the org is loading).
    multiServiceBookings: org?.multi_service_bookings === true,
    // ZNLY-407: staff may make an appointment longer. The org's own choice wins; unset = beauty ON, every other industry OFF (same rule as org_can_extend() in the database).
    canExtend: org?.extend_by_drag ?? (org?.industry_type === 'beauty'),
    extendByDragSetting: org?.extend_by_drag ?? null,
    // ZNLY-390: a customer's phone is required unless the org switched that off (default on; also while the org is loading).
    requireCustomerPhone: org?.require_customer_phone !== false,
    showStaffSelection: org?.settings?.show_staff_selection === true,
    enableStaffRatings: org?.settings?.enable_staff_ratings === true,
    // Opposite default from the two toggles above — see TenantContext.jsx's matching
    // field for why (group booking is already live for every tenant via the env flag
    // alone; defaulting this to false would silently disable it on ship).
    enableGroupBooking: org?.settings?.enable_group_booking !== false,
    refreshOrg: loadOrg,
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

    // Products (migration-345): the page title ('Products' / 'Supplies'), starter categories, and whether items are sold by default
    productLabel: industry?.product_label || 'Products',
    defaultProductCategories: industry?.default_product_categories || [],
    productsSoldByDefault: industry?.products_sold_by_default !== false,
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
