import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';
import { useTenant } from '../../../contexts/TenantContext';
import { fetchBranchesByOrgId } from '../../../services/api';

// Industry-specific default images
const INDUSTRY_IMAGES = {
  spa: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=400&h=300&fit=crop',
  cleaning: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=400&h=300&fit=crop',
  salon: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=400&h=300&fit=crop',
};
const DEFAULT_IMAGE = INDUSTRY_IMAGES.spa;
const DEFAULT_OPEN_HOURS = '9:00 AM - 9:00 PM';

const BranchSelection = ({ selectedBranch, onBranchSelect }) => {
  const { orgId, industryType, loading: tenantLoading, error: tenantError } = useTenant();
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadBranches() {
      // Wait for tenant to finish loading
      if (tenantLoading) {
        return;
      }

      // If no orgId after tenant loaded, something went wrong
      if (!orgId) {
        setLoading(false);
        setError('Unable to load organization data.');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const { data, error: fetchError } = await fetchBranchesByOrgId(orgId);

        if (fetchError) {
          console.error('[BranchSelection] Fetch error:', fetchError);
          setError('Failed to load branches. Please try again.');
          setLoading(false);
          return;
        }

        const branchImage = INDUSTRY_IMAGES[industryType] || DEFAULT_IMAGE;
        const activeBranches = (data || [])
          .map((b) => ({
            ...b,
            openHours: DEFAULT_OPEN_HOURS,
            image: branchImage,
          }));

        setBranches(activeBranches);

        // Auto-select if only one branch exists
        if (activeBranches.length === 1 && !selectedBranch) {
          onBranchSelect(activeBranches[0]);
        }

        setLoading(false);
      } catch (err) {
        console.error('[BranchSelection] Unexpected error:', err);
        setError('An unexpected error occurred.');
        setLoading(false);
      }
    }

    loadBranches();
  }, [orgId, tenantLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show tenant error
  if (tenantError) {
    return (
      <div className="space-y-4">
        <div className="bg-surface rounded-spa-lg border-2 border-error/30 p-8 text-center">
          <Icon name="AlertCircle" size={40} className="text-error mx-auto mb-4" />
          <p className="font-body font-body-medium text-text-primary mb-2">
            {tenantError}
          </p>
        </div>
      </div>
    );
  }

  if (loading || tenantLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="bg-surface rounded-spa-lg border-2 border-border animate-pulse"
            >
              <div className="w-full h-48 bg-background rounded-t-spa-lg" />
              <div className="p-6 space-y-4">
                <div className="h-5 bg-background rounded w-3/4" />
                <div className="h-4 bg-background rounded w-1/2" />
                <div className="h-4 bg-background rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="bg-surface rounded-spa-lg border-2 border-error/30 p-8 text-center">
          <Icon name="AlertCircle" size={40} className="text-error mx-auto mb-4" />
          <p className="font-body font-body-medium text-text-primary mb-2">
            {error}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-spa font-body font-body-medium text-sm hover:bg-primary/90 spa-transition-fast"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (branches.length === 0) {
    return (
      <div className="space-y-4">
        <div className="bg-surface rounded-spa-lg border-2 border-border p-8 text-center">
          <Icon name="MapPin" size={40} className="text-text-secondary mx-auto mb-4" />
          <p className="font-body font-body-medium text-text-primary">
            No branches are currently available.
          </p>
          <p className="font-body font-body-normal text-sm text-text-secondary mt-1">
            Please check back later or contact us for assistance.
          </p>
        </div>
      </div>
    );
  }

  const gridClass = branches.length === 1
    ? 'grid grid-cols-1 max-w-lg mx-auto gap-6'
    : 'grid grid-cols-1 md:grid-cols-2 gap-6';

  return (
    <div className="space-y-4">
      <div className={gridClass}>
        {branches.map((branch) => (
          <div
            key={branch.id}
            onClick={() => onBranchSelect(branch)}
            className={`bg-surface rounded-spa-lg border-2 cursor-pointer spa-transition-fast hover:spa-shadow-elevated ${
              selectedBranch?.id === branch.id
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50'
            }`}
          >
            <div className="relative overflow-hidden rounded-t-spa-lg">
              <Image
                src={branch.image}
                alt={branch.name}
                className="w-full h-48 object-cover"
              />
            </div>

            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="font-heading font-heading-medium text-lg text-text-primary mb-1">
                    {branch.name}
                  </h3>
                  {branch.address && (
                    <div className="flex items-center space-x-2 text-text-secondary mb-2">
                      <Icon name="MapPin" size={14} />
                      <span className="font-body font-body-normal text-sm">
                        {branch.address}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center space-x-2 text-text-secondary">
                    <Icon name="Clock" size={14} />
                    <span className="font-body font-body-normal text-sm">
                      {branch.openHours}
                    </span>
                  </div>
                </div>
                {selectedBranch?.id === branch.id && (
                  <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                    <Icon name="Check" size={14} className="text-primary-foreground" />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                {branch.phone ? (
                  <a
                    href={`tel:${branch.phone}`}
                    className="flex items-center space-x-2 text-primary hover:text-primary/80 spa-transition-fast"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Icon name="Phone" size={14} />
                    <span className="font-body font-body-medium text-sm">
                      {branch.phone}
                    </span>
                  </a>
                ) : (
                  <span />
                )}
                <div className="flex items-center space-x-1 text-success">
                  <div className="w-2 h-2 bg-success rounded-full"></div>
                  <span className="font-caption font-caption-normal text-xs">
                    Open Now
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BranchSelection;
