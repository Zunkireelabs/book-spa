import React, { createContext, useContext, useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { fetchOrganizationBySlug } from '../services/api';

const TenantContext = createContext(null);

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
};

export const TenantProvider = ({ children }) => {
  const { orgSlug } = useParams();
  const [org, setOrg] = useState(null);
  const [industry, setIndustry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadTenant() {
      if (!orgSlug) {
        setError('No organization specified');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await fetchOrganizationBySlug(orgSlug);

      if (fetchError || !data) {
        setError('Organization not found');
        setLoading(false);
        return;
      }

      setOrg(data);
      setIndustry(data.industries || null);
      setLoading(false);
    }

    loadTenant();
  }, [orgSlug]);

  // Industry-based terminology
  const staffLabel = industry?.staff_label || 'Therapist';
  const staffLabelPlural = industry?.staff_label_plural || 'Therapists';
  const locationLabel = industry?.location_label || 'Room';
  const locationLabelPlural = industry?.location_label_plural || 'Rooms';
  const enableRooms = industry?.enable_rooms !== false;
  const enableStaffGender = industry?.enable_staff_gender !== false;

  // Industry checks
  const isSpa = org?.industry_type === 'spa';
  const isCleaning = org?.industry_type === 'cleaning';
  const isSalon = org?.industry_type === 'salon';

  // Booking flow text based on industry
  const getBookingJourneyText = () => {
    if (isCleaning) return 'Complete your cleaning service booking';
    if (isSalon) return 'Complete your salon booking';
    return 'Complete your spa booking journey';
  };

  const value = {
    // Organization data
    org,
    orgId: org?.id,
    orgName: org?.name,
    orgSlug: org?.slug,
    orgPhone: org?.owner_email, // Could add phone to org later
    industryType: org?.industry_type || 'spa',

    // Industry config
    industry,
    staffLabel,
    staffLabelPlural,
    locationLabel,
    locationLabelPlural,
    enableRooms,
    enableStaffGender,

    // Industry checks
    isSpa,
    isCleaning,
    isSalon,

    // Helper text
    getBookingJourneyText,

    // Loading state
    loading,
    error,
  };

  return (
    <TenantContext.Provider value={value}>
      {children}
    </TenantContext.Provider>
  );
};

export default TenantContext;
