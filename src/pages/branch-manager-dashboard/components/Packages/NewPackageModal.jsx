import React, { useEffect, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import CountryCodeSelect from '../../../../components/ui/CountryCodeSelect';
import CustomerAutocomplete from '../../../../components/ui/CustomerAutocomplete';
import { useBranch } from '../../../../contexts/BranchContext';
import { useAuth } from '../../../../contexts/AuthContext';
import { useOrg } from '../../../../contexts/OrgContext';
import { fetchPackageTypes, issuePackage } from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

// Manager/admin only — issues a new session package via issue_package()
// (migration-141). Unlike NewVoucherModal, there's no manual code entry
// (package_code is left NULL — issue_package has no p_package_code param)
// and no tender/payment-method collection: packages just record paid_amount
// as a single number, they don't post rows to `payments` at issuance time.
const NewPackageModal = ({ onClose, onIssued }) => {
  const { branchId, branchName, isOverall } = useBranch();
  const { profile } = useAuth();
  const { orgId } = useOrg();

  const [types, setTypes] = useState([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [packageTypeId, setPackageTypeId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [linkedCustomerId, setLinkedCustomerId] = useState(null);
  const [guestCountryCode, setGuestCountryCode] = useState('+977');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestOtherInfo, setGuestOtherInfo] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [sessionsTotal, setSessionsTotal] = useState('');
  const [issuedDate, setIssuedDate] = useState(() => toDateInputValue(new Date()));
  const [expiryDate, setExpiryDate] = useState('');
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [remarks, setRemarks] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [issued, setIssued] = useState(null); // the issued package row, shown as a success state

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: fetchError } = await fetchPackageTypes();
      if (cancelled) return;
      if (fetchError) {
        setLoadError(fetchError.message || 'Failed to load package types.');
        setLoadingTypes(false);
        return;
      }
      setTypes(data || []);
      if (data && data.length > 0) {
        applyType(data[0], issuedDate);
      }
      setLoadingTypes(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const selectedType = types.find((t) => t.id === packageTypeId);

  // Fills sessions/price/expiry from the package type's defaults — mirrors
  // NewVoucherModal.handleTypeChange's price auto-fill. Expiry only auto-fills
  // while the staff member hasn't manually edited it (same "auto-fill +
  // override" pattern as the voucher's discount field).
  const applyType = (type, fromIssuedDate) => {
    if (!type) return;
    setPackageTypeId(type.id);
    setSessionsTotal(type.default_sessions != null ? String(type.default_sessions) : '');
    setPaidAmount(type.standard_price != null ? String(type.standard_price) : '');
    if (!expiryTouched) {
      const base = fromIssuedDate ? new Date(fromIssuedDate) : new Date();
      base.setDate(base.getDate() + (type.validity_days || 365));
      setExpiryDate(toDateInputValue(base));
    }
  };

  const handleTypeChange = (id) => {
    const t = types.find((x) => x.id === id);
    applyType(t, issuedDate);
  };

  const handleIssuedDateChange = (value) => {
    setIssuedDate(value);
    if (!expiryTouched && selectedType) {
      const base = new Date(value);
      base.setDate(base.getDate() + (selectedType.validity_days || 365));
      setExpiryDate(toDateInputValue(base));
    }
  };

  const paidAmountNum = Number(paidAmount) || 0;
  const sessionsTotalNum = Number(sessionsTotal) || 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (isOverall || !branchId) { setError('Select a specific branch before issuing a package.'); return; }
    if (!packageTypeId) { setError('Please select a package type.'); return; }
    if (!linkedCustomerId && !guestName.trim()) { setError('Guest name is required.'); return; }
    if (paidAmountNum < 0) { setError('Paid amount cannot be negative.'); return; }
    if (!Number.isFinite(sessionsTotalNum) || sessionsTotalNum <= 0) { setError('Sessions must be greater than zero.'); return; }
    if (!issuedDate || !expiryDate) { setError('Issued and expiry dates are required.'); return; }
    if (expiryDate < issuedDate) { setError('Expiry date cannot be before the issued date.'); return; }

    setSubmitting(true);
    // Guest Info is one column — a phone number takes priority (same
    // convention as NewVoucherModal's guest_info column).
    const guestPhoneDigits = guestPhone.replace(/\D/g, '');
    const { data, error: rpcError } = await issuePackage({
      orgId,
      branchId,
      packageTypeId,
      customerId: linkedCustomerId,
      guestName: guestName.trim() || null,
      guestInfo: guestPhoneDigits ? `${guestCountryCode}${guestPhoneDigits}` : (guestOtherInfo.trim() || null),
      issuedDate,
      expiryDate,
      paidAmount: paidAmountNum,
      sessionsTotal: sessionsTotalNum,
      remarks: remarks.trim() || null,
    });
    setSubmitting(false);

    if (rpcError) {
      setError(rpcError.message || 'Failed to issue package.');
      return;
    }
    setIssued(data);
  };

  const handleDone = () => {
    onIssued(issued);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-modal" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed inset-0 z-modal-overlay flex items-start justify-center overflow-y-auto p-4 pt-10 sm:pt-16"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-package-title"
      >
        {issued ? (
          <div className="bg-surface rounded-spa-lg border border-border shadow-spa-modal w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-3">
              <Icon name="CheckCircle2" size={24} className="text-success" />
            </div>
            <h2 className="font-heading font-heading-semibold text-base text-text-primary mb-1">Package issued</h2>
            <p className="font-data font-data-medium text-lg text-primary tracking-wide mb-1">
              {issued.sessions_total} session{issued.sessions_total !== 1 ? 's' : ''}
            </p>
            <p className="font-body text-sm text-text-secondary mb-5">
              {formatNPR(issued.paid_amount)} for {guestName.trim() || 'linked customer'}
            </p>
            <button
              type="button"
              onClick={handleDone}
              className="w-full px-3 py-2 rounded-spa bg-primary text-white text-sm font-body font-body-medium hover:bg-primary/90 spa-transition-fast"
            >
              Done
            </button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-surface rounded-spa-lg border border-border shadow-spa-modal w-full max-w-lg max-h-[90vh] overflow-y-auto"
          >
            <div className="sticky top-0 bg-surface border-b border-border px-5 py-3 flex items-center justify-between z-header">
              <h2 id="new-package-title" className="font-heading font-heading-semibold text-base text-text-primary">
                New package
              </h2>
              <button type="button" onClick={onClose} className="p-1.5 rounded-spa hover:bg-background spa-transition-fast">
                <Icon name="X" size={16} className="text-text-secondary" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {isOverall && (
                <div className="bg-amber-50 border border-amber-200 rounded-spa px-3 py-2 flex items-start space-x-2">
                  <Icon name="AlertTriangle" size={14} className="text-amber-700 flex-shrink-0 mt-0.5" />
                  <p className="font-body text-xs text-amber-900">
                    Switch to a specific branch (not "Overall") before issuing a package — it needs one branch to issue against.
                  </p>
                </div>
              )}
              {!isOverall && (
                <p className="font-caption text-xs text-text-tertiary">
                  Issuing branch: <span className="font-body font-body-medium text-text-secondary">{branchName}</span>
                </p>
              )}
              {profile?.full_name && (
                <p className="font-caption text-xs text-text-tertiary">
                  Issued by: <span className="font-body font-body-medium text-text-secondary">{profile.full_name}</span>
                </p>
              )}

              {loadError && (
                <div className="bg-error/5 border border-error/20 rounded-spa px-3 py-2 flex items-start space-x-2">
                  <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0 mt-0.5" />
                  <p className="font-body text-xs text-error">{loadError}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">
                    Guest name
                    {linkedCustomerId && (
                      <span className="ml-1.5 text-primary font-caption text-[10px]">· linked to account</span>
                    )}
                  </label>
                  <CustomerAutocomplete
                    value={guestName}
                    onChange={(val) => {
                      setGuestName(val);
                      setLinkedCustomerId(null);
                    }}
                    onSelect={(customer) => {
                      setGuestName(customer.full_name);
                      setLinkedCustomerId(customer.id);
                      if (customer.phone) setGuestPhone(customer.phone.replace(/\D/g, '').slice(-10));
                    }}
                    branchId={branchId}
                    searchBy="name"
                    placeholder="Full name"
                    inputClassName="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
                <div className="min-w-0">
                  <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Phone number (optional)</label>
                  <div className="flex">
                    <CountryCodeSelect value={guestCountryCode} onChange={setGuestCountryCode} />
                    <input
                      type="tel"
                      value={guestPhone}
                      onChange={(e) => setGuestPhone(e.target.value)}
                      placeholder="9841234567"
                      className="flex-1 min-w-0 h-10 px-3 text-sm border border-border rounded-r-spa rounded-l-none bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Guest Info (optional)</label>
                <input
                  type="text"
                  value={guestOtherInfo}
                  onChange={(e) => setGuestOtherInfo(e.target.value)}
                  placeholder="Company or club name..."
                  className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>

              <div>
                <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Package type</label>
                <CustomSelect
                  value={packageTypeId}
                  onChange={handleTypeChange}
                  options={types.map((t) => ({
                    value: t.id,
                    label: `${t.name} — ${t.service?.name || 'service'}${t.default_sessions ? ` (${t.default_sessions} sessions)` : ''}${t.standard_price != null ? ` — ${formatNPR(t.standard_price)}` : ''}`,
                  }))}
                  placeholder={loadingTypes ? 'Loading...' : 'Select package type'}
                  disabled={loadingTypes || types.length === 0}
                />
                {selectedType?.service && (
                  <p className="mt-1.5 font-caption text-xs text-text-tertiary">
                    Redeemable against {selectedType.service.name}
                    {selectedType.service.duration_minutes ? ` (${selectedType.service.duration_minutes} min)` : ''} only.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Sessions</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={sessionsTotal}
                    onChange={(e) => setSessionsTotal(e.target.value)}
                    className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Paid amount (NPR)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Issued date</label>
                  <input
                    type="date"
                    value={issuedDate}
                    onChange={(e) => handleIssuedDateChange(e.target.value)}
                    className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Expiry date</label>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => { setExpiryDate(e.target.value); setExpiryTouched(true); }}
                    className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
              </div>

              <div className="bg-background border border-border rounded-spa px-3 py-2 flex items-center justify-between">
                <span className="font-body text-xs text-text-secondary">Paid amount</span>
                <span className="font-data font-data-semibold text-sm text-primary">{formatNPR(paidAmountNum)}</span>
              </div>

              <div>
                <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Remarks (optional)</label>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={2}
                  placeholder="Anything to remember for this package..."
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
                disabled={submitting || loadingTypes || isOverall}
                className="px-3 py-2 rounded-spa bg-primary text-white text-sm font-body font-body-medium hover:bg-primary/90 disabled:opacity-50 spa-transition-fast inline-flex items-center space-x-1.5"
              >
                {submitting && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                <span>Issue package</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
};

export default NewPackageModal;
