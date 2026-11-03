import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import { fetchBranchAdvanceBookingWindow, updateBranchAdvanceBookingWindow } from '../../../../services/api';

const UNIT_OPTIONS = [
  { value: 'day', label: 'Day(s)' },
  { value: 'week', label: 'Week(s)' },
  { value: 'month', label: 'Month(s)' },
];

const toDays = (value, unit) => (unit === 'week' ? value * 7 : unit === 'month' ? value * 30 : value);

// How many days ahead customers can book online for this branch
// (branches.advance_booking_days, migration-303). Enforced server-side by
// check_branch_advance_booking_window() — this panel only lets an admin see and change
// the number; the customer-facing date picker reads the same value (DateTimeSelection.jsx)
// to only generate/offer chips within the window instead of letting a customer pick a date
// that would be rejected at submit.
//
// Only a raw day integer is persisted — on load this always displays in "Day" units
// (never tries to reverse-guess that a saved value of 14 was originally entered as "2
// Week"). Admins can freely re-enter in whichever unit is most convenient.
const AdvanceBookingWindowPanel = ({ branchId }) => {
  const [branch, setBranch] = useState(null);
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('day');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchErr } = await fetchBranchAdvanceBookingWindow(branchId);
    if (fetchErr) setError(fetchErr.message || 'Failed to load the advance booking window.');
    else {
      setBranch(data);
      setValue(data?.advance_booking_days == null ? '' : String(data.advance_booking_days));
      setUnit('day');
    }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const currentDays = branch?.advance_booking_days ?? null;
  const parsedValue = value.trim() === '' ? null : Number(value);
  const parsedDays = parsedValue === null ? null : toDays(parsedValue, unit);
  const isDirty = parsedDays !== currentDays;
  const isInvalid = parsedValue !== null && (!Number.isInteger(parsedValue) || parsedValue < 1);

  const handleSave = async () => {
    if (isInvalid) { setError('Enter a whole number of 1 or more, or leave it blank to use the default.'); return; }
    setSaving(true);
    setError(null);
    setSavedAt(null);
    const { error: saveErr } = await updateBranchAdvanceBookingWindow(branchId, parsedDays);
    if (saveErr) {
      setError(saveErr.message || 'Failed to save the advance booking window.');
      setSaving(false);
      return;
    }
    setBranch((prev) => ({ ...prev, advance_booking_days: parsedDays }));
    setSaving(false);
    setSavedAt(Date.now());
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-accent text-3xl text-text-primary leading-tight">Advance booking window</h3>
        <p className="font-body text-sm text-text-secondary mt-1 max-w-xl">
          How far ahead can customers book online for{' '}
          {branch?.name ? <span className="font-body-semibold text-text-primary">{branch.name}</span> : 'this branch'}.
          Leave it blank to use the default (30 days).
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
          Customers never see a date beyond this window in the online booking flow. It's also
          enforced by the system itself, so a booking can't be placed further out even by
          bypassing the app.
        </p>
      </div>

      {loading ? (
        <div className="h-32 rounded-spa-lg border border-border bg-background animate-pulse" />
      ) : (
        <div className="p-5 border border-border rounded-spa-lg bg-surface shadow-spa-resting space-y-4 animate-fade-in">
          <div className="space-y-1.5 max-w-sm">
            <label htmlFor="advance-booking-value" className="block font-body font-body-medium text-base text-text-primary">
              How far ahead can customers book online?
            </label>
            <div className="flex items-center gap-2">
              <input
                id="advance-booking-value"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={value}
                onChange={(e) => { setValue(e.target.value); setSavedAt(null); }}
                placeholder="30"
                className={`w-28 h-12 px-3.5 font-data text-base border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                  isInvalid ? 'border-error focus:border-error' : 'border-border focus:border-primary'
                }`}
              />
              <div className="w-36">
                <CustomSelect
                  value={unit}
                  onChange={(v) => { setUnit(v); setSavedAt(null); }}
                  options={UNIT_OPTIONS}
                  size="md"
                />
              </div>
            </div>
            <p className="font-caption text-xs text-text-secondary">
              {currentDays == null
                ? 'Currently 30 days (default) — not yet customized.'
                : `Currently ${currentDays} day${currentDays === 1 ? '' : 's'} ahead.`}
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
                onClick={() => {
                  setValue(currentDays == null ? '' : String(currentDays));
                  setUnit('day');
                  setError(null);
                }}
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

export default AdvanceBookingWindowPanel;
