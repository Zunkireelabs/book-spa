import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import CustomerAutocomplete from '../../../../components/ui/CustomerAutocomplete';
import CountryCodeSelect, { parsePhone } from '../../../../components/ui/CountryCodeSelect';
import TimeBoxInput from '../../../../components/ui/TimeBoxInput';
import { fetchWaitlist, addToWaitlist, updateWaitlistEntry, removeFromWaitlist } from '../../../../services/api';
import { to12h } from '../../../../services/bookingTransformers';

const SORT_OPTIONS = [
  { value: 'oldest', label: 'Oldest first' },
  { value: 'newest', label: 'Newest first' },
];

// Deterministic colour bar per service — Timely's reference shows one, and
// there's no services.color column to key off, so a stable hash over the
// service id stands in for one rather than adding a schema column for a
// cosmetic detail.
const SERVICE_COLORS = ['#2D5A27', '#8B4513', '#DAA520', '#1D7874', '#A6416B', '#6B5CA5'];
function colorForService(serviceId) {
  if (!serviceId) return '#8A938E';
  let hash = 0;
  for (let i = 0; i < serviceId.length; i++) hash = (hash * 31 + serviceId.charCodeAt(i)) >>> 0;
  return SERVICE_COLORS[hash % SERVICE_COLORS.length];
}

const EMPTY_FORM = {
  customerId: '', customerName: '', customerPhone: '', customerCountryCode: '+977',
  serviceId: '', preferredDate: '', preferredTime: '', preferredTherapistId: '', notes: '',
};

const WaitlistEntryForm = ({ initial, services, therapists, branchId, onCancel, onSaved }) => {
  const [form, setForm] = useState(initial || EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const isEdit = !!initial?.id;
  // "Any time" is the default and must stay reachable — migration-327 treats
  // a blank preferred_time as a real request, not a missing one. TimeBoxInput
  // itself has no empty state (parse24h('') renders a concrete 9:00 am), so
  // the boxes only mount once the admin explicitly opts into a specific time;
  // until then preferredTime stays '' rather than defaulting to a time nobody
  // chose. Fixed here in the form rather than in TimeBoxInput, which has four
  // other callers that all require a real time.
  const [useSpecificTime, setUseSpecificTime] = useState(!!initial?.preferredTime);

  const handleSave = async () => {
    if (!form.customerName.trim()) { setError('Customer name is required.'); return; }
    setSaving(true);
    setError(null);

    const fullPhone = form.customerPhone ? `${form.customerCountryCode}${form.customerPhone}` : '';
    const payload = {
      customerId: form.customerId || null,
      customerName: form.customerName,
      customerPhone: fullPhone || null,
      serviceId: form.serviceId || null,
      preferredDate: form.preferredDate || null,
      preferredTime: form.preferredTime || null,
      preferredTherapistId: form.preferredTherapistId || null,
      notes: form.notes || null,
    };

    const result = isEdit
      ? await updateWaitlistEntry({ id: initial.id, ...payload })
      : await addToWaitlist({ branchId, ...payload });

    setSaving(false);
    if (result.error) {
      setError(result.error.message || 'Could not save.');
      return;
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-surface rounded-spa-lg shadow-spa-modal w-full max-w-md p-6 space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h4 className="font-heading font-heading-semibold text-base text-text-primary">
          {isEdit ? 'Edit waitlist entry' : 'Add to waitlist'}
        </h4>

        {error && (
          <div className="flex items-center gap-2 p-2.5 bg-error/10 border border-error/20 rounded-spa text-error text-xs">
            <Icon name="AlertCircle" size={14} />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-1">
          <label className="block font-body font-body-medium text-sm text-text-primary">Customer name</label>
          <CustomerAutocomplete
            value={form.customerName}
            branchId={branchId}
            onChange={(val) => setForm((f) => ({ ...f, customerName: val, customerId: '' }))}
            onSelect={(customer) => {
              const { dial, national } = parsePhone(customer.phone || '');
              setForm((f) => ({ ...f, customerId: customer.id, customerName: customer.full_name, customerPhone: national, customerCountryCode: dial || '+977' }));
            }}
            placeholder="Search or type a name"
          />
        </div>

        <div className="space-y-1">
          <label className="block font-body font-body-medium text-sm text-text-primary">Phone (optional)</label>
          <div className="flex">
            <CountryCodeSelect value={form.customerCountryCode} onChange={(dial) => setForm((f) => ({ ...f, customerCountryCode: dial }))} />
            <input
              type="tel"
              value={form.customerPhone}
              onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))}
              placeholder="98XXXXXXXX"
              className="flex-1 rounded-r-spa rounded-l-none border border-l-0 border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="block font-body font-body-medium text-sm text-text-primary">Service</label>
          <CustomSelect
            value={form.serviceId}
            onChange={(val) => setForm((f) => ({ ...f, serviceId: val }))}
            options={[{ value: '', label: 'Any service' }, ...services.map((s) => ({ value: s.id, label: s.name }))]}
            size="md"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="block font-body font-body-medium text-sm text-text-primary">Preferred date</label>
            <input
              type="date"
              value={form.preferredDate}
              onChange={(e) => setForm((f) => ({ ...f, preferredDate: e.target.value }))}
              className="w-full rounded-spa border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="block font-body font-body-medium text-sm text-text-primary">Preferred time</label>
            <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer py-2">
              <input
                type="checkbox"
                checked={!useSpecificTime}
                onChange={(e) => {
                  const anyTime = e.target.checked;
                  setUseSpecificTime(!anyTime);
                  if (anyTime) {
                    setForm((f) => ({ ...f, preferredTime: '' }));
                  } else if (!form.preferredTime) {
                    // Starting point to edit from once they opt into a specific
                    // time — not a default applied before they asked for one.
                    setForm((f) => ({ ...f, preferredTime: '09:00' }));
                  }
                }}
              />
              Any time
            </label>
            {useSpecificTime && (
              <TimeBoxInput
                value={form.preferredTime || '09:00'}
                onChange={(val) => setForm((f) => ({ ...f, preferredTime: val }))}
              />
            )}
          </div>
        </div>
        <p className="font-caption text-xs text-text-tertiary italic">Leave date blank for "any day".</p>

        <div className="space-y-1">
          <label className="block font-body font-body-medium text-sm text-text-primary">Preferred staff</label>
          <CustomSelect
            value={form.preferredTherapistId}
            onChange={(val) => setForm((f) => ({ ...f, preferredTherapistId: val }))}
            options={[{ value: '', label: 'Any staff' }, ...therapists.map((t) => ({ value: t.id, label: t.name }))]}
            size="md"
          />
        </div>

        <div className="space-y-1">
          <label className="block font-body font-body-medium text-sm text-text-primary">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={2}
            className="w-full rounded-spa border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-sm font-body-medium rounded-spa bg-primary text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add to waitlist'}
          </button>
        </div>
      </div>
    </div>
  );
};

const WaitlistPanel = ({ branchId, services = [], therapists = [], collapsed, onToggleCollapse, onBookIn, refreshToken, canViewCustomerDetails = true }) => {
  const [tab, setTab] = useState('waitlist'); // 'upcoming' | 'waitlist'
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState('oldest');
  const [openMenuId, setOpenMenuId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    const result = await fetchWaitlist(branchId, { sort });
    if (result.error) {
      setError(result.error.message || 'Failed to load waitlist.');
    } else {
      setEntries(result.data || []);
    }
    setLoading(false);
  }, [branchId, sort]);

  useEffect(() => { load(); }, [load, refreshToken]);

  const therapistName = useMemo(() => {
    const map = {};
    therapists.forEach((t) => { map[t.id] = t.name; });
    return map;
  }, [therapists]);

  const editInitialFor = (entry) => {
    const { dial, national } = parsePhone(entry.customer_phone || '');
    return {
      id: entry.id,
      customerId: entry.customer_id || '',
      customerName: entry.customer_name || '',
      customerPhone: national,
      customerCountryCode: dial || '+977',
      serviceId: entry.service_id || '',
      preferredDate: entry.preferred_date || '',
      preferredTime: entry.preferred_time ? entry.preferred_time.slice(0, 5) : '',
      preferredTherapistId: entry.preferred_therapist_id || '',
      notes: entry.notes || '',
    };
  };

  const handleRemove = async () => {
    if (!confirmRemove) return;
    setRemoving(true);
    const result = await removeFromWaitlist(confirmRemove.id);
    setRemoving(false);
    setConfirmRemove(null);
    if (result.error) {
      setError(result.error.message || 'Could not remove entry.');
      return;
    }
    load();
  };

  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapse}
        className="flex-shrink-0 w-9 border-l border-border bg-background hover:bg-primary/5 flex flex-col items-center justify-start pt-4 gap-2 text-text-secondary"
        title="Show waitlist"
      >
        <Icon name="ListPlus" size={16} />
        {entries.length > 0 && (
          <span className="text-[10px] font-bold bg-primary text-white rounded-full w-4 h-4 flex items-center justify-center">{entries.length}</span>
        )}
      </button>
    );
  }

  return (
    <div className="flex-shrink-0 w-80 border-l border-border bg-surface flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex gap-4">
          <button
            onClick={() => setTab('upcoming')}
            className={`text-sm font-body-medium pb-1 border-b-2 ${tab === 'upcoming' ? 'text-primary border-primary' : 'text-text-secondary border-transparent'}`}
          >
            Upcoming
          </button>
          <button
            onClick={() => setTab('waitlist')}
            className={`text-sm font-body-medium pb-1 border-b-2 ${tab === 'waitlist' ? 'text-primary border-primary' : 'text-text-secondary border-transparent'}`}
          >
            Waitlist
          </button>
        </div>
        <button onClick={onToggleCollapse} className="p-1 rounded hover:bg-background text-text-secondary" title="Hide">
          <Icon name="PanelRightClose" size={16} />
        </button>
      </div>

      {tab === 'upcoming' ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <p className="font-body text-sm text-text-tertiary">
            Upcoming bookings already show on the calendar grid — nothing new to show here yet.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <button
            onClick={() => { setEditingEntry(null); setFormOpen(true); }}
            className="w-full py-2 rounded-spa border border-border text-sm font-body-medium text-text-primary hover:bg-background"
          >
            Add to waitlist
          </button>

          <CustomSelect value={sort} onChange={setSort} options={SORT_OPTIONS} size="sm" />

          {error && (
            <div className="flex items-center gap-2 p-2 bg-error/10 border border-error/20 rounded-spa text-error text-xs">
              <Icon name="AlertCircle" size={13} />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto" />
            </div>
          ) : entries.length === 0 ? (
            <p className="text-center text-sm text-text-tertiary py-8">No one on the waitlist.</p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="border border-border rounded-spa p-3 relative">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-body-medium text-sm text-text-primary truncate">{entry.customer_name}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: colorForService(entry.service_id) }} />
                      <span className="text-xs text-text-secondary truncate">{entry.service?.name || 'Any service'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {(canViewCustomerDetails || entry.customer_id) && (
                      <button
                        onClick={() => onBookIn(entry)}
                        className="p-1.5 rounded border border-border hover:bg-primary/5 text-text-secondary hover:text-primary"
                        title="Book this person in"
                      >
                        <Icon name="CalendarPlus" size={15} />
                      </button>
                    )}
                    <div className="relative">
                      <button
                        onClick={() => setOpenMenuId(openMenuId === entry.id ? null : entry.id)}
                        className="p-1.5 rounded border border-border hover:bg-background text-text-secondary"
                      >
                        <Icon name="MoreVertical" size={15} />
                      </button>
                      {openMenuId === entry.id && (
                        <div className="absolute right-0 top-full mt-1 w-32 bg-surface border border-border rounded-spa shadow-spa-elevated z-dropdown py-1">
                          <button
                            onClick={() => { setEditingEntry(entry); setFormOpen(true); setOpenMenuId(null); }}
                            className="w-full text-left px-3 py-1.5 text-sm text-text-primary hover:bg-background"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => { setConfirmRemove(entry); setOpenMenuId(null); }}
                            className="w-full text-left px-3 py-1.5 text-sm text-error hover:bg-error/5"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-2 text-sm text-text-primary italic">
                  {entry.preferred_date || entry.preferred_time
                    ? [entry.preferred_date, entry.preferred_time ? to12h(entry.preferred_time) : null].filter(Boolean).join(' · ')
                    : 'Any time'}
                  {entry.preferred_therapist_id && therapistName[entry.preferred_therapist_id] && (
                    <span className="not-italic text-text-tertiary"> · with {therapistName[entry.preferred_therapist_id]}</span>
                  )}
                </div>

                <p className="mt-1 text-xs text-text-tertiary">
                  Created: {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                </p>
              </div>
            ))
          )}
        </div>
      )}

      {formOpen && (
        <WaitlistEntryForm
          initial={editingEntry ? editInitialFor(editingEntry) : null}
          services={services}
          therapists={therapists}
          branchId={branchId}
          onCancel={() => { setFormOpen(false); setEditingEntry(null); }}
          onSaved={() => { setFormOpen(false); setEditingEntry(null); load(); }}
        />
      )}

      {confirmRemove && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => !removing && setConfirmRemove(null)}>
          <div className="bg-surface rounded-spa-lg shadow-spa-modal w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-heading font-heading-semibold text-text-primary">Remove from waitlist?</h3>
            <p className="font-body text-sm text-text-secondary">
              "{confirmRemove.customer_name}" will be removed from the queue. This can't be undone from here.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmRemove(null)} disabled={removing} className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
              <button onClick={handleRemove} disabled={removing} className="px-4 py-1.5 text-sm font-body-medium rounded-spa bg-error text-white hover:bg-error/90 disabled:opacity-60">
                {removing ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WaitlistPanel;
