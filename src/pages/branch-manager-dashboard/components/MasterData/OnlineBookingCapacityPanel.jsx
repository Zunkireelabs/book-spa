import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import { fetchBranchOnlineCapacity, updateBranchOnlineCapacity } from '../../../../services/api';

// Per-branch cap on how many bookings customers can place online without a specific staff
// member assigned (branches.online_booking_capacity, migration-138). The real enforcement is
// the check_branch_online_capacity() DB trigger — it holds an advisory lock, so it is
// race-safe. This panel only lets an admin see and change the number; the customer-facing
// date/time picker reads the same value (migration-301) to grey out slots already at the cap
// instead of letting a customer submit into a rejection.
//
// Only mounted for orgs with show_staff_selection off — when customers pick a specific person,
// every online booking carries a therapist_id and the trigger exempts it, so the cap is dead.
const OnlineBookingCapacityPanel = ({ branchId }) => {
  const [branch, setBranch] = useState(null);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchErr } = await fetchBranchOnlineCapacity(branchId);
    if (fetchErr) setError(fetchErr.message || 'Failed to load the online booking limit.');
    else {
      setBranch(data);
      setValue(data?.online_booking_capacity == null ? '' : String(data.online_booking_capacity));
    }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const currentCapacity = branch?.online_booking_capacity ?? null;
  const parsed = value.trim() === '' ? null : Number(value);
  const isDirty = parsed !== currentCapacity;
  const isInvalid = parsed !== null && (!Number.isInteger(parsed) || parsed < 1);

  const handleSave = async () => {
    if (isInvalid) { setError('Enter a whole number of 1 or more, or leave it blank for no limit.'); return; }
    setSaving(true);
    setError(null);
    setSavedAt(null);
    const { error: saveErr } = await updateBranchOnlineCapacity(branchId, parsed);
    if (saveErr) {
      setError(saveErr.message || 'Failed to save the online booking limit.');
      setSaving(false);
      return;
    }
    setBranch((prev) => ({ ...prev, online_booking_capacity: parsed }));
    setSaving(false);
    setSavedAt(Date.now());
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-accent text-3xl text-text-primary leading-tight">Online booking limit</h3>
        <p className="font-body text-sm text-text-secondary mt-1 max-w-xl">
          Caps how many bookings customers can place online at the same time for{' '}
          {branch?.name ? <span className="font-body-semibold text-text-primary">{branch.name}</span> : 'this branch'},
          since they don't pick a staff member themselves. Leave it blank for no limit.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm animate-fade-in">
          <Icon name="AlertCircle" size={16} className="flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto flex-shrink-0"><Icon name="X" size={14} /></button>
        </div>
      )}

      <div className="flex items-start gap-2.5 p-3 bg-background border border-border rounded-spa">
        <Icon name="Info" size={15} className="text-text-secondary flex-shrink-0 mt-0.5" />
        <p className="font-body text-xs text-text-secondary">
          Only counts bookings customers made themselves online. Bookings your team creates from the
          dashboard or calendar are never limited by this number, even when no staff member is assigned yet.
        </p>
      </div>

      {loading ? (
        <div className="h-32 rounded-spa-lg border border-border bg-background animate-pulse" />
      ) : (
        <div className="p-5 border border-border rounded-spa-lg bg-surface shadow-spa-resting space-y-4 animate-fade-in">
          <div className="space-y-1.5 max-w-xs">
            <label htmlFor="online-capacity" className="block font-body font-body-medium text-base text-text-primary">
              Bookings allowed at the same time
            </label>
            <input
              id="online-capacity"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={value}
              onChange={(e) => { setValue(e.target.value); setSavedAt(null); }}
              placeholder="No limit"
              className={`w-full h-12 px-3.5 font-data text-base border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                isInvalid ? 'border-error focus:border-error' : 'border-border focus:border-primary'
              }`}
            />
            <p className="font-caption text-xs text-text-secondary">
              {currentCapacity == null
                ? 'Currently no limit — customers can book online as long as a room is free.'
                : `Currently ${currentCapacity} at a time.`}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !isDirty || isInvalid}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-spa bg-primary text-white text-base font-body font-body-semibold hover:bg-primary/90 spa-transition-fast disabled:opacity-50"
            >
              {saving && <Icon name="Loader2" size={16} className="animate-spin" />}
              <span>{saving ? 'Saving…' : 'Save'}</span>
            </button>
            {isDirty && !saving && (
              <button
                type="button"
                onClick={() => { setValue(currentCapacity == null ? '' : String(currentCapacity)); setError(null); }}
                className="px-4 py-2.5 rounded-spa border border-border text-base font-body font-body-medium text-text-secondary hover:bg-background spa-transition-fast"
              >
                Cancel
              </button>
            )}
            {savedAt && !isDirty && (
              <span className="inline-flex items-center gap-1.5 text-success font-body text-sm animate-fade-in">
                <Icon name="Check" size={15} />
                Saved
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default OnlineBookingCapacityPanel;
