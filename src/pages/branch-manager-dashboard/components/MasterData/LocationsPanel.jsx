import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import { fetchBranchesForManagement, fetchBranchOpeningHours } from '../../../../services/api';
import { summarizeHours } from '../../../location-detail/components/BranchHoursEditor';

const PRIMARY_BTN = 'h-10 max-lg:h-11 px-4 inline-flex items-center justify-center gap-1.5 rounded-spa bg-primary text-white text-[13px] font-body font-body-medium hover:bg-primary/90 spa-transition-fast';

// Settings → Locations (board B7): one card per location with the one-line hours summary and an Active / Inactive chip.
// The whole card opens the edit page; the empty state points at the single action that fixes it.
const LocationsPanel = ({ orgId }) => {
  const navigate = useNavigate();
  const { orgSlug } = useParams();
  const [branches, setBranches] = useState([]);
  const [hoursById, setHoursById] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadBranches = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    const result = await fetchBranchesForManagement(orgId);
    if (result.error) {
      setError(`Couldn't load your locations.`);
      setLoading(false);
      return;
    }
    const list = result.data || [];
    setBranches(list);
    setLoading(false);
    // Summaries load after the list is on screen; a failed one just reads "Hours not set".
    const entries = await Promise.all(list.map(async (b) => {
      const r = await fetchBranchOpeningHours(b.id);
      return [b.id, summarizeHours(r.data)];
    }));
    setHoursById(Object.fromEntries(entries));
  }, [orgId]);

  useEffect(() => { loadBranches(); }, [loadBranches]);

  const handleOpenCreate = () => navigate(`/${orgSlug}/locations/new`);
  const handleOpenEdit = (branch) => navigate(`/${orgSlug}/locations/${branch.id}`);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {!loading && !error && <p className="font-body text-[13px] text-text-secondary">{branches.length} {branches.length === 1 ? 'location' : 'locations'}</p>}
        </div>
        <button type="button" onClick={handleOpenCreate} className={PRIMARY_BTN}>
          <Icon name="Plus" size={14} />
          Add location
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-2 px-3 py-2 bg-error/10 border border-error/20 rounded-spa text-error text-[13px]">
          <span>{error}</span>
          <button type="button" onClick={loadBranches} className="underline font-body-medium h-9 max-lg:h-11 px-2">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2.5">{[0, 1].map(i => <div key={i} className="h-[84px] rounded-spa-lg bg-background animate-pulse" />)}</div>
      ) : branches.length === 0 && !error ? (
        <div className="border border-border rounded-spa-lg p-8 text-center">
          <p className="text-[13.5px] font-body-semibold text-text-primary">No locations yet</p>
          <p className="mt-1 text-xs text-text-secondary">Add your first location so customers can book and your team can be placed.</p>
          <button type="button" onClick={handleOpenCreate} className={`${PRIMARY_BTN} mt-4`}>
            <Icon name="Plus" size={14} /> Add location
          </button>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {branches.map((branch) => (
            <li key={branch.id}>
              <button
                type="button"
                onClick={() => handleOpenEdit(branch)}
                aria-label={`Edit ${branch.name}`}
                className="w-full text-left border border-border rounded-spa-lg bg-surface p-3.5 hover:bg-background/60 spa-transition-fast flex items-start gap-3 min-h-[44px]"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-body font-body-semibold text-[13.5px] text-text-primary">{branch.name}</p>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-body-medium ${branch.is_active ? 'bg-success/10 text-success' : 'bg-background text-text-secondary border border-border'}`}>
                      {branch.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary">{hoursById[branch.id] || 'Loading hours…'}</p>
                  <p className="text-xs text-text-secondary truncate">{[branch.address, branch.phone].filter(Boolean).join(' · ') || 'No address or phone yet'}</p>
                </div>
                <Icon name="ChevronRight" size={16} className="text-text-tertiary mt-1 flex-shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default LocationsPanel;
