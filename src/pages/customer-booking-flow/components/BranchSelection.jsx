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

// Per-branch entrance photos (Nuad Thai Spa) — keyed by exact branch name,
// falling back to the generic industry stock photo for any branch (or org)
// that doesn't have a custom one yet.
const BRANCH_IMAGES = {
  Bhaisepati: '/assets/images/branches/bhaisepati.webp',
  Lazimpat: '/assets/images/branches/lazimpat.webp',
  Sanepa: '/assets/images/branches/sanepa.webp',
  Thamel: '/assets/images/branches/thamel.webp',
};
const DEFAULT_OPEN_HOURS = '10:00 AM - 8:00 PM';

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

        const fallbackImage = INDUSTRY_IMAGES[industryType] || DEFAULT_IMAGE;
        const activeBranches = (data || []).map((b) => ({
          ...b,
          openHours: DEFAULT_OPEN_HOURS,
          image: BRANCH_IMAGES[b.name] || fallbackImage,
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
    // Mirrors the real card's structure/height exactly (image block + text rows
    // below it) rather than a single placeholder box — a skeleton with a
    // different height than the real card causes a layout jump the instant the
    // branches finish loading. That jump is most visible on a cold page load
    // (slow, uncached branch + image fetches leave the skeleton on screen for a
    // while) and easy to miss on a warm one (e.g. re-entering this step already
    // has the data cached), which made it look like the crop only happened
    // "sometimes."
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 pt-2 sm:pt-3 animate-pulse">
        {[1, 2].map(i => (
          <div key={i} className="bg-surface rounded-spa-lg border-2 border-border overflow-hidden">
            <div className="h-40 sm:h-56 bg-border/40" />
            <div className="p-3 sm:p-5 space-y-1.5 sm:space-y-3">
              <div className="space-y-1.5">
                <div className="h-4 sm:h-5 w-2/3 bg-border/40 rounded" />
                <div className="h-3 w-1/2 bg-border/40 rounded" />
              </div>
              <div className="flex items-center justify-between pt-1.5 sm:pt-2 border-t border-border/50">
                <div className="h-3 w-1/3 bg-border/40 rounded" />
                <div className="h-3 w-16 bg-border/40 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 pt-2 sm:pt-3">
      {branches.map((branch) => {
        const isSelected = selectedBranch?.id === branch.id;
        return (
          <div
            key={branch.id}
            onClick={() => onBranchSelect(branch)}
            // No `scroll-reveal` here: these cards render above the fold on the
            // very first paint, before the branch images have loaded and settled
            // the page's scroll range — the animation-timeline: view() animation
            // used elsewhere gets stuck mid-transition in that case, showing a
            // cropped-looking card until the component remounts.
            className={"bg-surface rounded-spa-lg border-2 cursor-pointer transition-all " +
              (isSelected ? 'border-primary bg-primary/5 shadow-md' : 'border-border hover:border-primary/50')}
          >
            <div className="relative h-40 sm:h-56 overflow-hidden rounded-t-spa-lg">
              <Image
                src={branch.image}
                alt={branch.name}
                className="w-full h-full object-cover"
                loading="eager"
                fetchpriority="high"
              />
              {isSelected && (
                <div className="absolute top-2 right-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                  <Icon name="Check" size={14} className="text-white" />
                </div>
              )}
            </div>

            <div className="p-3 sm:p-5 space-y-1.5 sm:space-y-3">
              <div>
                <h3 className="font-heading font-semibold text-sm sm:text-lg text-text-primary">{branch.name}</h3>
                <p className="text-xs text-text-secondary flex items-center gap-1">
                  <Icon name="MapPin" size={12} /> {branch.address}
                </p>
              </div>

              <div className="flex items-center justify-between pt-1.5 sm:pt-2 border-t border-border/50">
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