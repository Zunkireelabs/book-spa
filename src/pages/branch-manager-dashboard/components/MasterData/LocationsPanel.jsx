import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import TimeBoxInput from '../../../../components/ui/TimeBoxInput';
import {
  fetchBranchesForManagement,
  createBranch,
  updateBranchDetails,
  fetchBranchOpeningHours,
  upsertBranchOpeningHours,
} from '../../../../services/api';

const DEFAULT_HOURS = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  dayLabel: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][dayOfWeek],
  startTime: null,
  endTime: null,
  isDayOff: true,
}));

// No breaks concept here — branch_working_hours (migration-308) has no sibling breaks
// table, unlike therapist_working_hours. Toggle-per-day + two time inputs only.
const BranchHoursEditor = ({ rows, onChange }) => {
  const updateRow = (dayOfWeek, patch) => {
    onChange(rows.map(r => (r.dayOfWeek === dayOfWeek ? { ...r, ...patch } : r)));
  };

  const toggleWorking = (row) => {
    const nowOpen = row.isDayOff;
    updateRow(row.dayOfWeek, nowOpen
      ? { isDayOff: false, startTime: row.startTime || '09:00', endTime: row.endTime || '17:00' }
      : { isDayOff: true });
  };

  return (
    <div className="divide-y divide-border">
      {rows.map(row => {
        const open = !row.isDayOff;
        return (
          <div key={row.dayOfWeek} className="py-3 first:pt-0 last:pb-0 flex items-center gap-3">
            <button
              type="button"
              onClick={() => toggleWorking(row)}
              title={open ? 'Mark as closed' : 'Mark as open'}
              className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center spa-transition-fast ${open ? 'bg-primary' : 'bg-border'}`}
            >
              {open && <Icon name="Check" size={14} className="text-white" />}
            </button>
            <span className="w-24 flex-shrink-0 font-body font-body-medium text-sm text-text-primary">{row.dayLabel}</span>
            {open ? (
              <div className="flex items-center gap-2">
                <TimeBoxInput value={row.startTime} onChange={(v) => updateRow(row.dayOfWeek, { startTime: v })} />
                <span className="font-caption text-xs text-text-tertiary">to</span>
                <TimeBoxInput value={row.endTime} onChange={(v) => updateRow(row.dayOfWeek, { endTime: v })} />
              </div>
            ) : (
              <span className="font-caption text-sm text-text-tertiary">Closed</span>
            )}
          </div>
        );
      })}
    </div>
  );
};

const LocationsPanel = ({ orgId }) => {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showModal, setShowModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState(null);
  const [formName, setFormName] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formMapsUrl, setFormMapsUrl] = useState('');
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [hoursLoading, setHoursLoading] = useState(false);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadBranches = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    const result = await fetchBranchesForManagement(orgId);
    if (result.error) {
      setError(result.error.message || 'Failed to load locations.');
    } else {
      setBranches(result.data || []);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => { loadBranches(); }, [loadBranches]);

  const handleOpenCreate = () => {
    setEditingBranch(null);
    setFormName('');
    setFormAddress('');
    setFormPhone('');
    setFormMapsUrl('');
    setHours(DEFAULT_HOURS);
    setFormError(null);
    setShowModal(true);
  };

  const handleOpenEdit = async (branch) => {
    setEditingBranch(branch);
    setFormName(branch.name || '');
    setFormAddress(branch.address || '');
    setFormPhone(branch.phone || '');
    setFormMapsUrl(branch.maps_url || '');
    setFormError(null);
    setShowModal(true);
    setHoursLoading(true);
    const result = await fetchBranchOpeningHours(branch.id);
    setHours(result.data || DEFAULT_HOURS);
    setHoursLoading(false);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      setFormError('Location name is required.');
      return;
    }
    setSaving(true);
    setFormError(null);

    const details = {
      name: formName.trim(),
      address: formAddress.trim() || null,
      phone: formPhone.trim() || null,
      mapsUrl: formMapsUrl.trim() || null,
    };

    let result;
    let branchId;
    if (editingBranch) {
      result = await updateBranchDetails({ branchId: editingBranch.id, ...details });
      branchId = editingBranch.id;
    } else {
      result = await createBranch(details);
      branchId = result.data?.id;
    }

    if (result.error) {
      setFormError(result.error.message || 'Operation failed.');
      setSaving(false);
      return;
    }

    const hoursResult = await upsertBranchOpeningHours(branchId, hours);
    if (hoursResult.error) {
      setFormError(hoursResult.error.message || 'Saved location, but failed to save hours.');
      setSaving(false);
      return;
    }

    setShowModal(false);
    await loadBranches();
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        <p className="text-sm text-text-secondary">Loading locations...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Locations</h3>
          <p className="font-body text-sm text-text-secondary">{branches.length} location{branches.length === 1 ? '' : 's'} configured</p>
        </div>
        <Button variant="primary" size="sm" iconName="Plus" onClick={handleOpenCreate}>
          Add Location
        </Button>
      </div>

      {error && (
        <div className="p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm flex items-center gap-2">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={14} /></button>
        </div>
      )}

      <div className="bg-surface border border-border rounded-spa overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-background border-b border-border">
              <th className="text-left px-4 py-3 text-sm text-text-secondary">Name</th>
              <th className="text-left px-4 py-3 text-sm text-text-secondary">Address</th>
              <th className="text-left px-4 py-3 text-sm text-text-secondary">Phone</th>
              <th className="text-left px-4 py-3 text-sm text-text-secondary">Status</th>
              <th className="text-right px-4 py-3 text-sm text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {branches.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-secondary text-sm">
                  No locations found.
                </td>
              </tr>
            ) : (
              branches.map((branch) => (
                <tr key={branch.id} className="border-b border-border last:border-b-0 hover:bg-background/50">
                  <td className="px-4 py-3 font-medium text-sm">{branch.name}</td>
                  <td className="px-4 py-3 text-sm text-text-secondary">{branch.address || '—'}</td>
                  <td className="px-4 py-3 text-sm text-text-secondary">{branch.phone || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={"px-2 py-0.5 rounded text-xs " + (branch.is_active ? 'bg-success/10 text-success' : 'bg-gray-100 text-gray-500')}>
                      {branch.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleOpenEdit(branch)} className="p-1 hover:text-primary"><Icon name="Pencil" size={16} /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-surface rounded-spa-lg w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">{editingBranch ? 'Edit' : 'Add'} Location</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <Input value={formName} onChange={e => setFormName(e.target.value)} autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Address</label>
                <Input value={formAddress} onChange={e => setFormAddress(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Phone</label>
                <Input value={formPhone} onChange={e => setFormPhone(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Map Link</label>
                <Input value={formMapsUrl} onChange={e => setFormMapsUrl(e.target.value)} placeholder="https://maps.google.com/..." />
              </div>

              <div className="pt-2 border-t border-border">
                <label className="block text-sm font-medium mb-2">Weekly Opening Hours</label>
                {hoursLoading ? (
                  <div className="text-center py-6">
                    <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto" />
                  </div>
                ) : (
                  <BranchHoursEditor rows={hours} onChange={setHours} />
                )}
              </div>

              {formError && (
                <div className="p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
                  {formError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="ghost" onClick={() => setShowModal(false)}>Cancel</Button>
                <Button variant="primary" onClick={handleSave} loading={saving}>Save</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LocationsPanel;
