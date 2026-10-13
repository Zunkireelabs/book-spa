import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { fetchServicesForTherapist, toggleTherapistServiceEligibility } from '../../../services/api';

// Restricted services (ones with an existing eligibility allow-list, set up
// via the Services page) can be toggled per-therapist here. Unrestricted
// services show as "All staff" and aren't togglable from this page — see
// fetchServicesForTherapist's comment for why.
const StaffServicesSection = ({ therapistId, branchId }) => {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

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

  const handleToggle = async (service) => {
    if (!service.isRestricted) return;
    setTogglingId(service.id);
    const result = await toggleTherapistServiceEligibility(service.id, therapistId, !service.isEligible);
    if (!result.error) {
      setServices(prev => prev.map(s => s.id === service.id ? { ...s, isEligible: !s.isEligible } : s));
    } else {
      setError(result.error.message || 'Failed to update service.');
    }
    setTogglingId(null);
  };

  return (
    <div className="bg-surface border border-border rounded-spa-lg p-5 space-y-3">
      <div>
        <h3 className="font-heading font-heading-semibold text-base text-text-primary">Services</h3>
        <p className="font-caption text-xs text-text-secondary mt-0.5">
          Which services this staff member can be assigned to. Services with no restriction are open to all staff — manage those from the Services page.
        </p>
      </div>

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
        <div className="border border-border rounded-spa divide-y divide-border max-h-[280px] overflow-y-auto">
          {services.map(service => (
            <label
              key={service.id}
              className={`flex items-center justify-between px-3 py-2 ${service.isRestricted ? 'cursor-pointer hover:bg-background' : 'cursor-default'}`}
            >
              <span className="font-body text-sm text-text-primary">{service.name}</span>
              {service.isRestricted ? (
                <button
                  type="button"
                  disabled={togglingId === service.id}
                  onClick={() => handleToggle(service)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full spa-transition-fast ${
                    service.isEligible ? 'bg-success' : 'bg-border'
                  } ${togglingId === service.id ? 'opacity-50' : ''}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white spa-transition-fast transform ${
                    service.isEligible ? 'translate-x-4' : 'translate-x-1'
                  }`} />
                </button>
              ) : (
                <span className="font-caption text-[10px] uppercase tracking-wide text-text-tertiary">All staff</span>
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

export default StaffServicesSection;
