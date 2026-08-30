import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';
import { useTenant } from '../../../contexts/TenantContext';
import { fetchBranchesByOrgId } from '../../../services/api';

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
      if (tenantLoading) return;
      if (!orgId) {
        setLoading(false);
        setError('Unable to load organization data.');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const { data, error: fetchError } = await fetchBranchesByOrgId(orgId);
        if (fetchError) { console.error("[DEBUG] fetchBranches error:", fetchError);
          setError('Failed to load branches.');
          setLoading(false);
          return;
        }

        const branchImage = INDUSTRY_IMAGES[industryType] || DEFAULT_IMAGE;
        const activeBranches = (data || []).map((b) => ({
          ...b,
          openHours: DEFAULT_OPEN_HOURS,
          image: branchImage,
        }));

        setBranches(activeBranches);

        if (activeBranches.length === 1 && !selectedBranch) {
          onBranchSelect(activeBranches[0]);
        }
        setLoading(false);
      } catch (err) {
        setError('An unexpected error occurred.');
        setLoading(false);
      }
    }
    loadBranches();
  }, [orgId, tenantLoading]);

  if (tenantError || error) {
    return (
      <div className="bg-surface rounded-spa-lg border-2 border-error/30 p-8 text-center">
        <Icon name="AlertCircle" size={40} className="text-error mx-auto mb-4" />
        <p className="font-body font-body-medium text-text-primary">{tenantError || error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-pulse">
        {[1, 2].map(i => <div key={i} className="h-64 bg-surface rounded-spa-lg border-2 border-border" />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {branches.map((branch) => {
        return (
          <div
            key={branch.id}
            onClick={() => onBranchSelect(branch)}
            className={"bg-surface rounded-spa-lg border-2 cursor-pointer transition-all " + (selectedBranch?.id === branch.id ? 'border-primary bg-primary/5 shadow-md' : 'border-border hover:border-primary/50')}
          >
            <div className="relative h-40 overflow-hidden rounded-t-spa-lg">
              <Image src={branch.image} alt={branch.name} className="w-full h-full object-cover" />
              {selectedBranch?.id === branch.id && (
                <div className="absolute top-2 right-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                  <Icon name="Check" size={14} className="text-white" />
                </div>
              )}
            </div>

            <div className="p-5 space-y-3">
              <div>
                <h3 className="font-heading font-semibold text-lg text-text-primary">{branch.name}</h3>
                <p className="text-xs text-text-secondary flex items-center gap-1">
                  <Icon name="MapPin" size={12} /> {branch.address}
                </p>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border/50">
                <span className="text-xs text-text-secondary flex items-center gap-1">
                  <Icon name="Clock" size={12} /> {branch.openHours}
                </span>
                <div className="flex items-center gap-1 text-success">
                  <div className="w-1.5 h-1.5 bg-success rounded-full animate-pulse" />
                  <span className="text-[10px] font-bold uppercase">Open Now</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default BranchSelection;