import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { fetchServicesForTherapist, toggleTherapistServiceEligibility, excludeTherapistFromService, excludeTherapistFromServices } from '../../../services/api';

// Every service shows a checkbox. Restricted services (ones with an
// existing eligibility allow-list) toggle this therapist in/out of that
// list directly. Unrestricted services ("All staff") start checked;
// unchecking one calls excludeTherapistFromService, which materializes an
// allow-list covering every other branch therapist so the service stays
// open to everyone else and only excludes this one — see that function's
// comment for why a plain toggle would be wrong here.
const StaffServicesSection = ({ therapistId, branchId }) => {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [bulkToggling, setBulkToggling] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!therapistId || !branchId) return;
    setLoading(true);
    setError(null);
    const result = await fetchServicesForTherapist(therapistId, branchId);
    if (result.error) {
      setError(result.error.message || 'Failed to load services.');
    } else {
      setServices(result.data || []);
    }
    setLoading(false);
  }, [therapistId, branchId]);

  useEffect(() => { load(); }, [load]);

  if (!therapistId) return null;

  // Unrestricted services don't have an eligibility row to flip — unchecking
  // one must materialize the rest-of-branch allow-list (excludeTherapistFromService),
  // while re-checking it (now restricted) is a normal toggle back in.
  const toggleOne = async (service, nextEligible) => {
    if (service.isRestricted || nextEligible) {
      return toggleTherapistServiceEligibility(service.id, therapistId, nextEligible);
    }
    return excludeTherapistFromService(service.id, branchId, therapistId);
  };

  const handleToggle = async (service) => {
    const nextEligible = !service.isEligible;
    setTogglingId(service.id);
    const result = await toggleOne(service, nextEligible);
    if (!result.error) {
      setServices(prev => prev.map(s => s.id === service.id ? { ...s, isRestricted: true, isEligible: nextEligible } : s));
    } else {
      setError(result.error.message || 'Failed to update service.');
    }
    setTogglingId(null);
  };

  const filteredServices = services.filter(s => s.name.toLowerCase().includes(search.trim().toLowerCase()));
  const allFilteredEligible = filteredServices.length > 0 && filteredServices.every(s => s.isEligible);

  // Batches the "exclude from unrestricted services" path into one query +
  // one upsert covering every target service, instead of firing a separate
  // branch-therapist fetch per service (what toggleOne does one at a time) —
  // matters here since "Select all" can target dozens of services at once.
  const handleSelectAll = async () => {
    if (filteredServices.length === 0 || bulkToggling) return;
    const nextEligible = !allFilteredEligible;
    setBulkToggling(true);

    const targets = filteredServices.filter(s => s.isEligible !== nextEligible);
    const toExclude = nextEligible ? [] : targets.filter(s => !s.isRestricted);
    const toToggle = targets.filter(s => !toExclude.includes(s));

    const [excludeResult, ...toggleResults] = await Promise.all([
      toExclude.length > 0
        ? excludeTherapistFromServices(toExclude.map(s => s.id), branchId, therapistId)
        : Promise.resolve({ data: [], error: null }),
      ...toToggle.map(s => toggleTherapistServiceEligibility(s.id, therapistId, nextEligible)),
    ]);

    if (excludeResult.error) {
      setError(excludeResult.error.message || 'Failed to update services.');
    }
    const failedToggle = toggleResults.find(r => r.error);
    if (failedToggle) {
      setError(failedToggle.error.message || 'Failed to update services.');
    }

    const succeededIds = new Set([
      ...(excludeResult.error ? [] : toExclude.map(s => s.id)),
      ...toToggle.filter((_, i) => !toggleResults[i].error).map(s => s.id),
    ]);
    setServices(prev => prev.map(s => succeededIds.has(s.id) ? { ...s, isRestricted: true, isEligible: nextEligible } : s));
    setBulkToggling(false);
  };

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="py-6 text-center">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto" />
        </div>
      ) : services.length === 0 ? (
        <p className="font-caption text-xs text-text-tertiary">No active services in this branch yet.</p>
      ) : (
        <>
          <div className="relative">
            <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search services..."
              className="w-full pl-8 pr-3 py-2 rounded-spa border border-border bg-surface font-body text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="border border-border rounded-spa divide-y divide-border max-h-[280px] overflow-y-auto">
            <label
              className={`sticky top-0 z-10 flex items-center gap-3 px-3 py-2 bg-surface border-b border-border ${filteredServices.length > 0 ? 'cursor-pointer hover:bg-background' : 'cursor-default opacity-50'}`}
            >
              <input
                type="checkbox"
                checked={allFilteredEligible}
                disabled={filteredServices.length === 0 || bulkToggling}
                onChange={handleSelectAll}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30 cursor-pointer"
              />
              <span className="font-body font-body-medium text-sm text-text-primary">Select all</span>
            </label>

            {filteredServices.length === 0 ? (
              <p className="px-3 py-3 font-caption text-xs text-text-tertiary">No services match your search.</p>
            ) : (
              filteredServices.map(service => (
                <label
                  key={service.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 cursor-pointer hover:bg-background"
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={service.isEligible}
                      disabled={togglingId === service.id}
                      onChange={() => handleToggle(service)}
                      className="flex-shrink-0 w-4 h-4 rounded border-border text-primary focus:ring-primary/30 cursor-pointer"
                    />
                    <span className="font-body text-sm text-text-primary truncate">{service.name}</span>
                  </span>
                  {!service.isRestricted && (
                    <span className="flex-shrink-0 font-caption text-[10px] uppercase tracking-wide text-text-tertiary">All staff</span>
                  )}
                </label>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default StaffServicesSection;

