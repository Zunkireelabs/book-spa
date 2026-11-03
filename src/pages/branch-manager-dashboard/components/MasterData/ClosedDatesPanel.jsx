import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import { useOrg } from '../../../../contexts/OrgContext';
import {
  fetchClosedDateRanges,
  createClosedDateRange,
  deleteClosedDateRange,
} from '../../../../services/api';

function toLocalISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatRangeLabel(startDate, endDate) {
  const start = new Date(startDate + 'T00:00:00');
  const startLabel = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  if (startDate === endDate) return startLabel;
  const end = new Date(endDate + 'T00:00:00');
  const endLabel = end.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  return `${startLabel} – ${endLabel}`;
}

// "Closed dates" — a dedicated per-branch business-closure list (public holidays,
// maintenance days, etc.), built on top of the Calendar's existing whole-location
// manual-block primitive. See fetchClosedDateRanges/createClosedDateRange in api.js
// for how a range maps onto manual_blocks' recurrence columns — no new table.
const ClosedDatesPanel = ({ branchId }) => {
  const { orgId } = useOrg();

  const [ranges, setRanges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [removingId, setRemovingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchErr } = await fetchClosedDateRanges(branchId);
    if (fetchErr) setError(fetchErr.message || 'Failed to load closed dates.');
    else setRanges(data || []);
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const openAddModal = () => {
    const today = toLocalISO(new Date());
    setEditingId(null);
    setStartDate(today);
    setEndDate(today);
    setDescription('');
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (range) => {
    setEditingId(range.blockId);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
    setDescription(range.description || '');
    setFormError(null);
    setModalOpen(true);
  };

  const closeModal = () => { if (!saving) setModalOpen(false); };

  const handleSave = async () => {
    if (!startDate) { setFormError('Start date is required.'); return; }
    if (endDate < startDate) { setFormError('End date must be on or after the start date.'); return; }
    if (!description.trim()) { setFormError('Description is required.'); return; }

    setSaving(true);
    setFormError(null);

    // No in-place edit for a block's recurrence span — editing a range deletes the old
    // entry and creates a fresh one with the new dates (see api.js's deleteClosedDateRange
    // comment for why).
    if (editingId) {
      const { error: delErr } = await deleteClosedDateRange(editingId);
      if (delErr) { setFormError(delErr.message || 'Failed to update closed date.'); setSaving(false); return; }
    }

    const { error: createErr } = await createClosedDateRange({
      orgId, branchId, startDate, endDate, description: description.trim(),
    });
    if (createErr) {
      setFormError(createErr.message || 'Failed to save closed date.');
      setSaving(false);
      return;
    }

    setSaving(false);
    setModalOpen(false);
    load();
  };

  const handleDelete = async (range) => {
    if (!window.confirm(`Remove the closed date for ${formatRangeLabel(range.startDate, range.endDate)}?`)) return;
    setRemovingId(range.blockId);
    // Let the fade-out play before the row actually leaves the list.
    setTimeout(async () => {
      const { error: delErr } = await deleteClosedDateRange(range.blockId);
      if (delErr) {
        setError(delErr.message || 'Failed to remove closed date.');
        setRemovingId(null);
        return;
      }
      setRanges(prev => prev.filter(r => r.blockId !== range.blockId));
      setRemovingId(null);
    }, 180);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-accent text-3xl text-text-primary leading-tight">Closed dates</h3>
          <p className="font-body text-sm text-text-secondary mt-1 max-w-xl">
            List the dates your business is closed for public holidays, maintenance, or any other reason.
            Customers won't be able to place online bookings during these dates.
          </p>
        </div>
        <button
          type="button"
          onClick={openAddModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-spa bg-primary text-white text-sm font-body font-body-semibold shadow-spa-resting hover:shadow-spa-elevated hover:bg-primary/90 spa-transition-fast"
        >
          <Icon name="Plus" size={15} />
          <span>Add closed date</span>
        </button>
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
        <p className="font-body text-xs text-text-secondary">Online bookings can't be placed during closed dates.</p>
      </div>

      <div className="space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded-spa-lg border border-border bg-background animate-pulse" />
          ))
        ) : ranges.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center border border-dashed border-border rounded-spa-lg animate-fade-in">
            <div className="w-12 h-12 rounded-full bg-background flex items-center justify-center mb-3">
              <Icon name="CalendarX2" size={22} className="text-text-tertiary" />
            </div>
            <p className="font-body font-body-medium text-sm text-text-primary">No closed dates yet</p>
            <p className="font-caption text-xs text-text-secondary mt-1">Add one for your next holiday or maintenance day.</p>
          </div>
        ) : (
          ranges.map((range, i) => (
            <div
              key={range.blockId}
              className={`flex items-center gap-4 p-5 border border-border rounded-spa-lg bg-surface shadow-spa-resting hover:shadow-spa-elevated spa-transition-fast animate-slide-in ${
                removingId === range.blockId ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
              }`}
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms`, transition: 'opacity 180ms ease, transform 180ms ease, box-shadow 150ms ease' }}
            >
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-slate-700 text-white flex items-center justify-center">
                <Icon name="Lock" size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-body font-body-semibold text-lg text-text-primary">
                  {formatRangeLabel(range.startDate, range.endDate)}
                </div>
                <div className="font-caption text-xs text-text-secondary mt-0.5">
                  {range.days} day{range.days === 1 ? '' : 's'} · Business closed
                  {range.description && <span className="text-text-tertiary"> — {range.description}</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => openEditModal(range)}
                className="px-3 py-1.5 rounded-spa border border-border text-sm font-body font-body-medium text-text-primary hover:border-primary hover:text-primary spa-transition-fast"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => handleDelete(range)}
                title="Remove"
                className="w-9 h-9 flex items-center justify-center rounded-spa bg-error/10 text-error hover:bg-error hover:text-white spa-transition-fast"
              >
                <Icon name="Trash2" size={15} />
              </button>
            </div>
          ))
        )}
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-modal-overlay bg-text-primary/50 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
          onClick={closeModal}
        >
          <div
            className="bg-surface rounded-spa-lg shadow-spa-modal w-full max-w-xl animate-settle-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-7 py-5 border-b border-border">
              <h4 className="font-accent text-2xl text-text-primary">
                {editingId ? 'Edit closed date' : 'Add closed date'}
              </h4>
              <button onClick={closeModal} className="p-1.5 rounded hover:bg-background spa-transition-fast">
                <Icon name="X" size={20} className="text-text-secondary" />
              </button>
            </div>

            <div className="px-7 py-6 space-y-5">
              <div className="flex items-start gap-3 p-3.5 bg-background border border-border rounded-spa">
                <Icon name="Info" size={17} className="text-text-secondary flex-shrink-0 mt-0.5" />
                <p className="font-body text-sm text-text-secondary">Online bookings can't be placed during closed dates.</p>
              </div>

              {formError && (
                <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
                  <Icon name="AlertCircle" size={16} className="flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block font-body font-body-medium text-base text-text-primary">
                    Start date <span className="text-error">*</span>
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => { setStartDate(e.target.value); if (endDate < e.target.value) setEndDate(e.target.value); }}
                    className="w-full h-12 px-3.5 text-base border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block font-body font-body-medium text-base text-text-primary">
                    End date <span className="text-error">*</span>
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    min={startDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full h-12 px-3.5 text-base border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block font-body font-body-medium text-base text-text-primary">
                  Description <span className="text-error">*</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="e.g. Dashain holiday, deep cleaning..."
                  className="w-full px-3.5 py-3 text-base border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-7 py-5 border-t border-border">
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="px-5 py-2.5 rounded-spa border border-border text-base font-body font-body-medium text-text-secondary hover:bg-background spa-transition-fast disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-spa bg-primary text-white text-base font-body font-body-semibold hover:bg-primary/90 spa-transition-fast disabled:opacity-60"
              >
                {saving && <Icon name="Loader2" size={16} className="animate-spin" />}
                <span>{saving ? 'Saving…' : 'Save'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClosedDatesPanel;
