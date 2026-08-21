import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import CountryCodeSelect from '../../../../components/ui/CountryCodeSelect';
import CustomerAutocomplete from '../../../../components/ui/CustomerAutocomplete';
import PaymentMethodSelector from '../../../../components/ui/PaymentMethodSelector';
import { useBranch } from '../../../../contexts/BranchContext';
import { useAuth } from '../../../../contexts/AuthContext';
import { useOrg } from '../../../../contexts/OrgContext';
import { fetchVoucherTypes, issueVoucher, fetchMembershipForCustomer } from '../../../../services/api';
import { addTenderRow, removeTenderRow, updateTenderRow } from '../../../../utils/tenderRows';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

const DEFAULT_VALIDITY_DAYS = 90;

// Manager/admin only — issues a new voucher via issue_voucher() (migration-071).
// The voucher code is minted server-side (sequential per branch+type, e.g.
// "NT 4326-0001") — there's no code field here to type or clash on, unlike
// the old Excel workbook's pre-allocated master code list.
const NewVoucherModal = ({ onClose, onIssued }) => {
  const { branchId, branchName, isOverall } = useBranch();
  const { profile } = useAuth();
  const { paymentMethods } = useOrg();

  const [types, setTypes] = useState([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [voucherTypeId, setVoucherTypeId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [linkedCustomerId, setLinkedCustomerId] = useState(null);
  const [guestCountryCode, setGuestCountryCode] = useState('+977');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestOtherInfo, setGuestOtherInfo] = useState('');
  const [actualPrice, setActualPrice] = useState('');
  const [discountPercent, setDiscountPercent] = useState('0');
  const [issuedDate, setIssuedDate] = useState(() => toDateInputValue(new Date()));
  const [expiryDate, setExpiryDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + DEFAULT_VALIDITY_DAYS);
    return toDateInputValue(d);
  });
  const [remarks, setRemarks] = useState('');
  const [membership, setMembership] = useState(null);
  const [discountTouched, setDiscountTouched] = useState(false);
  const [tenders, setTenders] = useState([{ amount: '', paymentMode: 'Cash' }]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [issued, setIssued] = useState(null); // the issued voucher row, shown as a success state

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: fetchError } = await fetchVoucherTypes();
      if (cancelled) return;
      if (fetchError) {
        setLoadError(fetchError.message || 'Failed to load voucher types.');
        setLoadingTypes(false);
        return;
      }
      setTypes(data || []);
      if (data && data.length > 0) {
        setVoucherTypeId(data[0].id);
        setActualPrice(String(data[0].standard_price));
      }
      setLoadingTypes(false);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const selectedType = types.find((t) => t.id === voucherTypeId);
  const activeMembership = membership?.status === 'active' ? membership : null;
  const tierRateForType = (type, m = activeMembership) =>
    type && m ? m.tierDiscountRules?.[type.category] : undefined;

  // Auto-fills the discount from the guest's membership tier for the given
  // voucher type — only while the staff member hasn't typed into the
  // discount field themselves (option A from the voucher-improvements
  // brainstorm: auto-fill + override, matching how discounts work
  // everywhere else in the app rather than a server-enforced ceiling).
  const applyTierDiscount = (type, m = activeMembership, touched = discountTouched) => {
    if (touched) return;
    const rate = tierRateForType(type, m);
    setDiscountPercent(typeof rate === 'number' ? String(rate) : '0');
  };

  const handleTypeChange = (id) => {
    setVoucherTypeId(id);
    const t = types.find((x) => x.id === id);
    if (t) setActualPrice(String(t.standard_price));
    applyTierDiscount(t);
  };

  const actualPriceNum = Number(actualPrice) || 0;
  const discountNum = Number(discountPercent) || 0;
  const totalAmount = useMemo(
    () => Math.round((actualPriceNum - (actualPriceNum * discountNum) / 100) * 100) / 100,
    [actualPriceNum, discountNum]
  );

  const addTender = () => addTenderRow(setTenders, { amount: '', paymentMode: 'Cash' });
  const removeTender = (i) => removeTenderRow(setTenders, i);
  const updateTender = (i, patch) => updateTenderRow(setTenders, i, patch);

  // Round each tender to 2dp before summing — matches the RPC's per-tender
  // numeric(10,2) cast (rounds each amount, then sums), so a value like
  // 33.333 can't sum-then-round to a "Fully collected" state client-side
  // while the server's round-then-sum rejects the same tenders.
  const tenderTotal = useMemo(
    () => tenders.reduce((s, t) => {
      const amount = Math.round((Number(t.amount) || 0) * 100) / 100;
      return s + (amount > 0 ? amount : 0);
    }, 0),
    [tenders]
  );
  const tenderRemaining = useMemo(() => Math.round((totalAmount - tenderTotal) * 100) / 100, [totalAmount, tenderTotal]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (isOverall || !branchId) { setError('Select a specific branch before issuing a voucher.'); return; }
    if (!voucherTypeId) { setError('Please select a voucher type.'); return; }
    if (!guestName.trim()) { setError('Guest name is required.'); return; }
    if (actualPriceNum < 0) { setError('Price cannot be negative.'); return; }
    if (discountNum < 0 || discountNum > 100) { setError('Discount must be between 0 and 100.'); return; }
    if (!issuedDate || !expiryDate) { setError('Issued and expiry dates are required.'); return; }
    if (expiryDate < issuedDate) { setError('Expiry date cannot be before the issued date.'); return; }
    if (tenderRemaining !== 0) { setError('Payment amount must equal the voucher total.'); return; }

    setSubmitting(true);
    // Guest Info is one column — a phone number takes priority (it's what
    // makes the voucher searchable by phone at payment time, see
    // search_vouchers_for_payment/migration-085); the free-text Guest Info
    // field (company/club name, etc.) is used when there's no phone.
    const guestPhoneDigits = guestPhone.replace(/\D/g, '');
    const { data, error: rpcError } = await issueVoucher({
      branchId,
      voucherTypeId,
      guestName: guestName.trim(),
      guestInfo: guestPhoneDigits ? `${guestCountryCode}${guestPhoneDigits}` : (guestOtherInfo.trim() || null),
      discountPercent: discountNum,
      actualPrice: actualPriceNum,
      issuedDate,
      expiryDate,
      remarks: remarks.trim() || null,
      customerId: linkedCustomerId,
      tenders: tenders
        .map((t) => ({ amount: Math.round((Number(t.amount) || 0) * 100) / 100, paymentMode: t.paymentMode }))
        .filter((t) => t.amount > 0),
    });
    setSubmitting(false);

    if (rpcError) {
      setError(rpcError.message || 'Failed to issue voucher.');
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
        aria-labelledby="new-voucher-title"
      >
        {issued ? (
          <div className="bg-surface rounded-spa-lg border border-border shadow-spa-modal w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-3">
              <Icon name="CheckCircle2" size={24} className="text-success" />
            </div>
            <h2 className="font-heading font-heading-semibold text-base text-text-primary mb-1">Voucher issued</h2>
            <p className="font-data font-data-medium text-lg text-primary tracking-wide mb-1">{issued.voucher_code}</p>
            <p className="font-body text-sm text-text-secondary mb-5">
              {formatNPR(issued.total_amount_issued)} for {guestName.trim()}
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
              <h2 id="new-voucher-title" className="font-heading font-heading-semibold text-base text-text-primary">
                New voucher
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
                    Switch to a specific branch (not "Overall") before issuing a voucher — it needs one branch to issue against.
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
                      setMembership(null);
                      // Clearing a linked member drops their entitlement — an
                      // auto-filled discount left behind would look like a
                      // manual override for whoever the guest turns out to be.
                      // Only untouched (auto-filled) values are reset; a
                      // staff-typed discount is left alone.
                      applyTierDiscount(selectedType, null);
                    }}
                    onSelect={async (customer) => {
                      setGuestName(customer.full_name);
                      setLinkedCustomerId(customer.id);
                      if (customer.phone) setGuestPhone(customer.phone.replace(/\D/g, '').slice(-10));
                      // A newly-selected guest is a fresh context — their tier
                      // discount should apply even if a previous guest's
                      // discount was manually overridden in this same form.
                      setDiscountTouched(false);
                      const { data: m } = await fetchMembershipForCustomer(customer.id);
                      const active = m?.status === 'active' ? m : null;
                      setMembership(m);
                      applyTierDiscount(selectedType, active, false);
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
                <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Voucher type</label>
                <CustomSelect
                  value={voucherTypeId}
                  onChange={handleTypeChange}
                  options={types.map((t) => ({
                    value: t.id,
                    label: `${t.name}${t.is_wallet ? ' (wallet)' : ''} — ${formatNPR(t.standard_price)}`,
                  }))}
                  placeholder={loadingTypes ? 'Loading...' : 'Select voucher type'}
                  disabled={loadingTypes || types.length === 0}
                />
                {selectedType?.is_wallet && (
                  <p className="mt-1.5 font-caption text-xs text-text-tertiary">
                    Stored-value voucher — the guest can redeem it across multiple partial visits until the balance runs out.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Actual price (NPR)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={actualPrice}
                    onChange={(e) => setActualPrice(e.target.value)}
                    className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Discount (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={discountPercent}
                    onChange={(e) => { setDiscountPercent(e.target.value); setDiscountTouched(true); }}
                    className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
              </div>

              {activeMembership && typeof tierRateForType(selectedType) === 'number' && (
                <p className="font-caption text-xs text-primary flex items-center space-x-1">
                  <Icon name="BadgeCheck" size={12} />
                  <span>
                    {activeMembership.tierName} member — entitled to {tierRateForType(selectedType)}% off {selectedType?.category?.replace('_', ' ')} vouchers
                  </span>
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Issued date</label>
                  <input
                    type="date"
                    value={issuedDate}
                    onChange={(e) => setIssuedDate(e.target.value)}
                    className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Expiry date</label>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
              </div>

              <div className="bg-background border border-border rounded-spa px-3 py-2 flex items-center justify-between">
                <span className="font-body text-xs text-text-secondary">Total amount issued</span>
                <span className="font-data font-data-semibold text-sm text-primary">{formatNPR(totalAmount)}</span>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-body font-body-medium text-xs text-text-secondary">
                    Payment{tenders.length > 1 ? 's' : ''} collected
                  </label>
                  <button type="button" onClick={addTender} className="flex items-center gap-1 text-xs font-body font-body-medium text-primary hover:underline">
                    + Add method
                  </button>
                </div>
                {tenders.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-36 flex-shrink-0">
                      <PaymentMethodSelector
                        paymentMethods={paymentMethods}
                        value={t.paymentMode}
                        onChange={(v) => updateTender(i, { paymentMode: v })}
                        size="md"
                      />
                    </div>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-secondary">NPR</span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={t.amount}
                        onChange={(e) => updateTender(i, { amount: e.target.value })}
                        placeholder="0"
                        className="w-full h-10 pl-11 pr-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                      />
                    </div>
                    {tenders.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeTender(i)}
                        className="p-2 rounded-spa hover:bg-error/10 text-error spa-transition-fast"
                        aria-label="Remove method"
                      >
                        <Icon name="X" size={14} />
                      </button>
                    )}
                  </div>
                ))}
                <p className={`font-caption text-xs ${tenderRemaining === 0 ? 'text-success' : 'text-warning'}`}>
                  {tenderRemaining === 0 ? 'Fully collected.' : `Remaining to collect: ${formatNPR(tenderRemaining)}`}
                </p>
              </div>

              <div>
                <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Remarks (optional)</label>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={2}
                  placeholder="Anything to remember for this voucher..."
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
                disabled={submitting || loadingTypes || isOverall || tenderRemaining !== 0}
                className="px-3 py-2 rounded-spa bg-primary text-white text-sm font-body font-body-medium hover:bg-primary/90 disabled:opacity-50 spa-transition-fast inline-flex items-center space-x-1.5"
              >
                {submitting && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                <span>Issue voucher</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
};

export default NewVoucherModal;
