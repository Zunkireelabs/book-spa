import React from 'react';
import { useTenant } from '../../contexts/TenantContext';
import Icon from '../../components/AppIcon';
import ProviderProfileFlow from '../provider-profile-flow';

const CustomerBookingFlowV2 = () => {
  const { loading: tenantLoading, error: tenantError } = useTenant();

  if (tenantError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center p-8">
          <Icon name="AlertCircle" size={48} className="text-error mx-auto mb-4" />
          <h1 className="font-heading font-heading-semibold text-2xl text-text-primary mb-2">
            Organization Not Found
          </h1>
          <p className="font-body font-body-normal text-text-secondary mb-4">
            The booking page you're looking for doesn't exist or is no longer available.
          </p>
          <a
            href="https://www.zunkireelabs.com/products/ai-booking-engine/"
            className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground rounded-spa font-body font-body-medium text-sm hover:bg-primary/90"
          >
            Learn More About Zennly
          </a>
        </div>
      </div>
    );
  }

  if (tenantLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    );
  }

  return <ProviderProfileFlow />;
};

export default CustomerBookingFlowV2;
