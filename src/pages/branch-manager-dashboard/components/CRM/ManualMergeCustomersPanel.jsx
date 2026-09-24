import React, { useState } from 'react';
import Icon from '../../../../components/AppIcon';
import Input from '../../../../components/ui/Input';
import Button from '../../../../components/ui/Button';
import CustomerAutocomplete from '../../../../components/ui/CustomerAutocomplete';
import { mergeCustomers, updateCustomerContact } from '../../../../services/api';
import { canSearchForMerge } from './manualMergeBranchGate';

// Picks the same customer twice would otherwise slip straight into merge_customers and come
// back as a raw SQL exception — caught client-side first for a clearer message.
const SLOT_LABELS = { 1: 'Customer 1', 2: 'Customer 2' };

const CustomerSlot = ({ slot, customer, branchId, onSelect, onClear }) => {
  const [query, setQuery] = useState('');

  if (customer) {
    return (
      <div className="flex-1 rounded-spa border-2 border-primary bg-primary/5 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-caption font-caption-normal text-[10px] text-text-tertiary uppercase tracking-wide mb-1">
              {SLOT_LABELS[slot]}
            </p>
            <p className="font-body font-body-medium text-sm text-text-primary truncate">{customer.full_name}</p>
            <p className="font-caption font-caption-normal text-xs text-text-secondary mt-0.5">{customer.phone || '—'}</p>
            {customer.email && (
              <p className="font-caption font-caption-normal text-xs text-text-secondary truncate">{customer.email}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClear}
            className="flex-shrink-0 text-text-tertiary hover:text-error spa-transition-fast"
            aria-label="Clear selection"
          >
            <Icon name="X" size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1">
      <p className="font-caption font-caption-normal text-[10px] text-text-tertiary uppercase tracking-wide mb-1">
        {SLOT_LABELS[slot]}
      </p>
      <CustomerAutocomplete
        value={query}
        onChange={setQuery}
        onSelect={(c) => { onSelect(c); setQuery(''); }}
        branchId={branchId}
        searchBy="name"
        placeholder="Search by name…"
      />
    </div>
  );
};

const ManualMergeCustomersPanel = ({ branchId, isOverall = false }) => {
  const [customerA, setCustomerA] = useState(null);
  const [customerB, setCustomerB] = useState(null);
  const [canonicalSlot, setCanonicalSlot] = useState(1);
  const [form, setForm] = useState(null); // { fullName, phone, email, notes } once both picked
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  if (!canSearchForMerge({ isOverall, branchId })) {
    return (
      <div className="bg-surface rounded-spa-lg border border-border text-center py-12">
        <Icon name="Building2" size={32} className="text-text-tertiary mx-auto mb-3" />
        <p className="font-body font-body-medium text-sm text-text-primary">Select a branch to use Manual Merge</p>
        <p className="font-caption text-xs text-text-tertiary mt-1">
          Switch out of "Overall" to a specific branch first — customer search needs one branch to resolve the organization.
        </p>
      </div>
    );
  }

  const bothPicked = customerA && customerB;
  const samePerson = bothPicked && customerA.id === customerB.id;

  const canonical = canonicalSlot === 1 ? customerA : customerB;
  const duplicate = canonicalSlot === 1 ? customerB : customerA;

  const startReview = () => {
    setError(null);
    setForm({
      fullName: canonical.full_name || '',
      phone: canonical.phone || '',
      email: canonical.email || duplicate.email || '',
      notes: '',
    });
  };

  const reset = () => {
    setCustomerA(null);
    setCustomerB(null);
    setCanonicalSlot(1);
    setForm(null);
    setConfirming(false);
    setError(null);
    setDone(false);
  };

  const handleConfirmMerge = async () => {
    setSubmitting(true);
    setError(null);

    const { error: mergeError } = await mergeCustomers(canonical.id, duplicate.id);
    if (mergeError) {
      setSubmitting(false);
      setError(mergeError.message || 'Merge failed.');
      return;
    }

    // Only patch fields the staff actually changed from the canonical record's own values —
    // merge_customers already coalesced email/notes/gender/dob, this is purely for the
    // name/phone/email/notes the reviewer edited in the form above.
    const edited = {};
    if (form.fullName.trim() && form.fullName.trim() !== (canonical.full_name || '')) edited.fullName = form.fullName.trim();
    if (form.phone.trim() && form.phone.trim() !== (canonical.phone || '')) edited.phone = form.phone.trim();
    if (form.email.trim() && form.email.trim() !== (canonical.email || '')) edited.email = form.email.trim();
    if (form.notes.trim()) edited.notes = form.notes.trim();

    if (Object.keys(edited).length > 0) {
      const { error: updateError } = await updateCustomerContact(canonical.id, edited);
      if (updateError) {
        setSubmitting(false);
        setError(`Merged, but saving your edits failed: ${updateError.message || 'unknown error'}`);
        return;
      }
    }

    setSubmitting(false);
    setConfirming(false);
    setDone(true);
  };

  if (done) {
    return (
      <div className="bg-success/5 border border-success/20 rounded-spa-lg p-6 text-center">
        <Icon name="CheckCircle2" size={28} className="text-success mx-auto mb-2" />
        <p className="font-body font-body-medium text-sm text-text-primary">Customers merged</p>
        <p className="font-caption text-xs text-text-tertiary mt-1">
          All bookings, memberships, vouchers, packages, and history now belong to {canonical.full_name}.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 font-body font-body-medium text-sm text-primary hover:underline"
        >
          Merge another pair
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="font-caption font-caption-normal text-xs text-text-tertiary">
        Search for two customer records that are actually the same person (e.g. re-entered under a
        new phone number) and merge them — merging is irreversible.
      </p>

      <div className="bg-surface rounded-spa-lg border border-border p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <CustomerSlot slot={1} customer={customerA} branchId={branchId} onSelect={setCustomerA} onClear={() => { setCustomerA(null); setForm(null); }} />
          <CustomerSlot slot={2} customer={customerB} branchId={branchId} onSelect={setCustomerB} onClear={() => { setCustomerB(null); setForm(null); }} />
        </div>

        {samePerson && (
          <p className="font-body text-xs text-error mt-3">That's the same customer in both slots — pick a different second customer.</p>
        )}

        {bothPicked && !samePerson && !form && (
          <div className="mt-4 flex items-center justify-end">
            <Button variant="primary" size="sm" onClick={startReview}>
              Compare &amp; review
            </Button>
          </div>
        )}
      </div>

      {form && (
        <div className="bg-surface rounded-spa-lg border border-border p-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            {[1, 2].map((slot) => {
              const c = slot === 1 ? customerA : customerB;
              const isCanonical = canonicalSlot === slot;
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setCanonicalSlot(slot)}
                  className={`flex-1 text-left rounded-spa border-2 p-3 spa-transition-fast ${
                    isCanonical ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                  }`}
                >
                  <p className="font-caption font-caption-normal text-[10px] text-text-tertiary uppercase tracking-wide mb-1">
                    {SLOT_LABELS[slot]}{isCanonical ? ' · keep this one' : ''}
                  </p>
                  <p className="font-body font-body-medium text-sm text-text-primary">{c.full_name}</p>
                  <p className="font-caption font-caption-normal text-xs text-text-secondary mt-0.5">{c.phone || '—'}</p>
                  {c.email && <p className="font-caption font-caption-normal text-xs text-text-secondary">{c.email}</p>}
                </button>
              );
            })}
          </div>

          <p className="font-caption font-caption-normal text-xs text-text-tertiary">
            Review and edit the details that will survive on the merged record. Leave a field as-is
            to keep the canonical record's value.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Full name"
              value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
            />
            <Input
              label="Phone"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
            <Input
              label="Email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
            <Input
              label="Notes (appended)"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>

          {error && (
            <div className="bg-error/5 border border-error/20 rounded-spa p-3 flex items-center space-x-2">
              <Icon name="AlertCircle" size={16} className="text-error flex-shrink-0" />
              <p className="font-body text-sm text-error">{error}</p>
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={reset}
              className="font-body font-body-normal text-xs text-text-secondary hover:underline"
            >
              Cancel
            </button>
            <Button variant="primary" size="sm" onClick={() => setConfirming(true)}>
              <Icon name="GitMerge" size={12} className="mr-1.5" />
              Merge into {SLOT_LABELS[canonicalSlot]}
            </Button>
          </div>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal-overlay flex items-center justify-center p-4">
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-md animate-fade-in">
            <div className="flex items-center space-x-3 p-5 border-b border-border">
              <div className="w-10 h-10 bg-error/10 rounded-lg flex items-center justify-center">
                <Icon name="AlertTriangle" size={20} className="text-error" />
              </div>
              <h2 className="font-heading font-heading-semibold text-lg text-text-primary">Merge customers?</h2>
            </div>
            <div className="p-5">
              <p className="font-body text-sm text-text-secondary">
                <strong>{duplicate.full_name}</strong> ({duplicate.phone || 'no phone'}) will be
                merged into <strong>{form.fullName || canonical.full_name}</strong>. All bookings,
                memberships, vouchers, packages, and history move to the surviving record. This
                cannot be undone.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 p-5 border-t border-border">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setConfirming(false)}
                className="font-body font-body-medium text-sm text-text-secondary hover:text-text-primary disabled:opacity-50"
              >
                Cancel
              </button>
              <Button variant="primary" size="sm" disabled={submitting} onClick={handleConfirmMerge}>
                {submitting ? 'Merging…' : 'Merge'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManualMergeCustomersPanel;
