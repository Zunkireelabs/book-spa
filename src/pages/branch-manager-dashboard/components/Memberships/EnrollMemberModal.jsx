import React, { useState, useEffect, useMemo } from 'react';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import { useAuth } from '../../../../contexts/AuthContext';
import { useBranch } from '../../../../contexts/BranchContext';
import {
  fetchMembershipTiers,
  fetchCustomersLightweight,
  findOrCreateCustomer,
  enrollMember,
  MEMBERSHIP_DEPOSIT_MODES,
} from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function normalizePhone(v) {
  return String(v || '').replace(/\D/g, '');
}

const EnrollMemberModal = ({ onClose, onEnrolled }) => {
  const { profile } = useAuth();
  const { branchId } = useBranch();
  const orgId = profile?.org_id;

  const [tiers, setTiers] = useState([]);
  const [tierId, setTierId] = useState('');
  const [existingCustomers, setExistingCustomers] = useState([]);

  // Customer details (typed by staff). If `lockedCustomer` is set the fields are
  // disabled and the membership is enrolled against that existing row.
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [lockedCustomer, setLockedCustomer] = useState(null);

  const [deposit, setDeposit] = useState('');
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Load tier list + org customers (for inline suggestions) on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [tRes, cRes] = await Promise.all([
        fetchMembershipTiers(orgId),
        branchId ? fetchCustomersLightweight(branchId) : Promise.resolve({ data: [] }),
      ]);
      if (cancelled) return;
      if (tRes.error) {
        setError(tRes.error.message || 'Failed to load tiers.');
        return;
      }
      setTiers(tRes.data || []);
      if (tRes.data && tRes.data.length > 0) setTierId(tRes.data[0].id);
      if (!cRes.error && cRes.data) setExistingCustomers(cRes.data);
    })();
    return () => { cancelled = true; };
  }, [orgId, branchId]);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Suggestions: match by name (substring) OR phone (prefix). Hide when locked.
  const suggestions = useMemo(() => {
    if (lockedCustomer) return [];
    const nameTerm = name.trim().toLowerCase();
    const phoneTerm = normalizePhone(phone);
    if (nameTerm.length < 2 && phoneTerm.length < 3) return [];
    return existingCustomers
      .filter((c) => {
        const matchName = nameTerm.length >= 2 && (c.full_name || '').toLowerCase().includes(nameTerm);
        const matchPhone = phoneTerm.length >= 3 && (c.phone || '').includes(phoneTerm);
        return matchName || matchPhone;
      })
      .slice(0, 6);
  }, [name, phone, existingCustomers, lockedCustomer]);

  // If staff types a phone that EXACTLY matches an existing customer, surface a
  // gentler "use existing" hint so they don't accidentally create a duplicate.
  const exactPhoneMatch = useMemo(() => {
    const p = normalizePhone(phone);
    if (!p || p.length < 6 || lockedCustomer) return null;
    return existingCustomers.find((c) => (c.phone || '') === p) || null;
  }, [phone, existingCustomers, lockedCustomer]);

  const handlePickExisting = (c) => {
    setLockedCustomer(c);
    setName(c.full_name || '');
    setPhone(c.phone || '');
    setEmail(''); // lightweight payload doesn't include email; leave blank
  };

  const handleUnlock = () => {
    setLockedCustomer(null);
  };

  const selectedTier = tiers.find((t) => t.id === tierId);
  const depositNum = Number(deposit) || 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) { setError('Please enter the customer name.'); return; }
    if (!normalizePhone(phone)) { setError('Phone number is required.'); return; }
    if (!tierId) { setError('Please select a tier.'); return; }
    if (depositNum <= 0) { setError('Initial deposit must be greater than zero.'); return; }

    setSubmitting(true);

    let customerId = lockedCustomer?.id || null;
    if (!customerId) {
      const { data: cust, error: custErr } = await findOrCreateCustomer({
        orgId,
        branchId,
        fullName: name.trim(),
        phone: normalizePhone(phone),
        email: email.trim() || null,
      });
      if (custErr) {
        setSubmitting(false);
        setError(custErr.message || 'Failed to find or create the customer.');
        return;
      }
      customerId = cust?.customerId;
    }

    const { data, error: rpcError } = await enrollMember({
      customerId,
      tierId,
      initialDeposit: depositNum,
      paymentMode,
      notes: notes.trim() || null,
    });
    setSubmitting(false);

    if (rpcError) {
      setError(rpcError.message || 'Failed to enroll member.');
      return;
    }
    onEnrolled(data?.membershipId || null);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-modal" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed inset-0 z-modal-overlay flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="enroll-member-title"
      >
        <form
          onSubmit={handleSubmit}
          className="bg-surface rounded-spa-lg border border-border shadow-spa-modal w-full max-w-md max-h-[90vh] overflow-y-auto"
        >
          <div className="sticky top-0 bg-surface border-b border-border px-5 py-3 flex items-center justify-between z-header">
            <h2 id="enroll-member-title" className="font-heading font-heading-semibold text-base text-text-primary">
              Enroll new member
            </h2>
            <button type="button" onClick={onClose} className="p-1.5 rounded-spa hover:bg-background spa-transition-fast">
              <Icon name="X" size={16} className="text-text-secondary" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            {/* Customer section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-body font-body-medium text-xs text-text-secondary">Customer</span>
                {lockedCustomer && (
                  <span className="inline-flex items-center space-x-1 text-[11px] font-caption text-success">
                    <Icon name="CheckCircle2" size={11} />
                    <span>Existing customer linked</span>
                    <button type="button" onClick={handleUnlock} className="ml-1 underline">change</button>
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 relative">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  disabled={!!lockedCustomer}
                  className="h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:bg-background"
                />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone (98XXXXXXXX)"
                  disabled={!!lockedCustomer}
                  className="h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:bg-background"
                />

                {suggestions.length > 0 && (
                  <div className="col-span-2 absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-50 py-1 max-h-48 overflow-y-auto">
                    {suggestions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handlePickExisting(c)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between gap-2"
                      >
                        <span className="min-w-0 truncate">
                          <span className="font-medium text-text-primary">{c.full_name}</span>
                          {c.phone && <span className="ml-2 text-text-secondary">{c.phone}</span>}
                        </span>
                        {c.primaryMembership && (
                          <span className="flex-shrink-0 inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-800">
                            <Icon name="AlertTriangle" size={10} />
                            <span className="font-mono tracking-wide">{c.primaryMembership.membershipNumber}</span>
                            <span>· already a member</span>
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email (optional)"
                disabled={!!lockedCustomer}
                className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:bg-background"
              />

              {!lockedCustomer && exactPhoneMatch && (
                <div className="bg-amber-50 border border-amber-200 rounded-spa px-3 py-2 flex items-start space-x-2">
                  <Icon name="Info" size={14} className="text-amber-700 flex-shrink-0 mt-0.5" />
                  <p className="font-body text-xs text-amber-900">
                    A customer with this phone already exists: <span className="font-body-medium">{exactPhoneMatch.full_name}</span>.
                    <button type="button" onClick={() => handlePickExisting(exactPhoneMatch)} className="ml-1 underline">Use this customer</button>
                  </p>
                </div>
              )}

              {!lockedCustomer && !exactPhoneMatch && name.trim() && normalizePhone(phone) && (
                <p className="font-caption text-[11px] text-text-tertiary">
                  No existing match — a new customer record will be created on enrollment.
                </p>
              )}
            </div>

            {/* Tier */}
            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Tier</label>
              <CustomSelect
                value={tierId}
                onChange={setTierId}
                options={tiers.map((t) => ({
                  value: t.id,
                  label: `${t.name} — ${formatNPR(t.advance_amount)} advance`,
                }))}
                placeholder="Select tier"
              />
              {selectedTier && (
                <p className="mt-1.5 font-caption text-xs text-text-tertiary">
                  Advance threshold: <span className="font-data font-data-medium text-text-secondary">{formatNPR(selectedTier.advance_amount)}</span>
                  {' · '}Valid for {selectedTier.validity_days} days from activation.
                </p>
              )}
            </div>

            {/* Deposit + mode */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Initial deposit (NPR)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                  placeholder="e.g. 50000"
                  className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
              <div>
                <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Payment mode</label>
                <CustomSelect
                  value={paymentMode}
                  onChange={setPaymentMode}
                  options={MEMBERSHIP_DEPOSIT_MODES.map((m) => ({ value: m, label: m }))}
                />
              </div>
            </div>

            {selectedTier && depositNum > 0 && (
              <div className="bg-background border border-border rounded-spa px-3 py-2">
                <p className="font-caption text-xs text-text-tertiary">
                  {depositNum >= Number(selectedTier.advance_amount) ? (
                    <>
                      <Icon name="CheckCircle2" size={12} className="inline text-success mr-1" />
                      Deposit hits the threshold — membership will <span className="font-body font-body-medium text-text-secondary">activate</span> immediately.
                    </>
                  ) : (
                    <>
                      <Icon name="Clock" size={12} className="inline text-amber-600 mr-1" />
                      Deposit is below the threshold — membership starts as <span className="font-body font-body-medium text-text-secondary">pending</span>. Top up to {formatNPR(Number(selectedTier.advance_amount) - depositNum)} to activate.
                    </>
                  )}
                </p>
              </div>
            )}

            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Anything to remember for this member..."
                className="w-full px-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
              />
            </div>

            {error && (
              <div className="bg-error/5 border border-error/20 rounded-spa px-3 py-2 flex items-start space-x-2">
                <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0 mt-0.5" />
                <p className="font-body text-xs text-error">{error}</p>
              </div>
            )}
          </div>

          <div className="sticky bottom-0 bg-surface border-t border-border px-5 py-3 flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-spa border border-border text-sm font-body font-body-medium text-text-secondary hover:bg-background spa-transition-fast"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-3 py-2 rounded-spa bg-primary text-white text-sm font-body font-body-medium hover:bg-primary/90 disabled:opacity-50 spa-transition-fast inline-flex items-center space-x-1.5"
            >
              {submitting && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              <span>Enroll member</span>
            </button>
          </div>
        </form>
      </div>
    </>
  );
};

export default EnrollMemberModal;
