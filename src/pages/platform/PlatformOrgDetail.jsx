import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import CustomSelect from 'components/ui/CustomSelect';
import PlatformNav from './components/PlatformNav';
import {
  listRates, listCollections, collectCommission, getOrgBookings,
  getOrgMembershipDeposits, getOrgVoucherSales,
  getRevenueRollup, formatNPR,
} from 'services/platformApi';
import { PERIOD_PRESETS, getPeriodRange, getTodayISO, toISO } from 'utils/periodPresets';

const BASIS_OPTIONS = [
  { value: 'vat_inclusive', label: 'VAT inclusive (rate on full amount)' },
  { value: 'vat_exclusive', label: 'VAT exclusive (back VAT out first)' },
];

// Same exclusion list as migration-116's platform_org_sales_base — these payment
// modes settle out of a wallet/membership balance, not new money, so they must be
// excluded here or they'd double-count against the Paid Memberships/Vouchers lists.
const WALLET_PAYMENT_MODES = ['Membership', 'ReferralWallet', 'VoucherWallet', 'ReferralVoucher'];

const nonWalletAmount = (booking) =>
  (booking.payments || [])
    .filter((p) => !WALLET_PAYMENT_MODES.includes(p.payment_mode))
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

const dayAfter = (isoDate) => {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return toISO(d);
};

const PlatformOrgDetail = () => {
  const { orgId } = useParams();
  const [preset, setPreset] = useState('monthly');
  const range = useMemo(() => getPeriodRange(preset), [preset]);

  const [rates, setRates] = useState([]);
  const [collections, setCollections] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [membershipDeposits, setMembershipDeposits] = useState([]);
  const [voucherSales, setVoucherSales] = useState([]);
  const [error, setError] = useState('');

  const [orgRollup, setOrgRollup] = useState(null);
  const [rollupLoading, setRollupLoading] = useState(true);

  const activeRate = rates.find((r) => !r.effective_to);
  const lastCollection = collections[0]; // platform_list_collections orders by collected_at DESC

  // Uncollected-since date: day after the latest recorded collection's period end,
  // else the oldest rate's start date, else today (nothing to collect on yet).
  const uncollectedSince = useMemo(() => {
    if (collections.length > 0) {
      const lastEnd = collections.reduce((max, c) => (c.period_end > max ? c.period_end : max), collections[0].period_end);
      return dayAfter(lastEnd);
    }
    if (rates.length > 0) {
      return rates.reduce((min, r) => (r.effective_from < min ? r.effective_from : min), rates[0].effective_from);
    }
    return getTodayISO();
  }, [collections, rates]);

  // Collect-commission wizard — period always defaults to "last collection's end
  // → today" so each cycle starts fresh from where the last one left off; the
  // dates stay editable for a custom-range override.
  const [wizFrom, setWizFrom] = useState(uncollectedSince);
  const [wizTo, setWizTo] = useState(getTodayISO());
  useEffect(() => {
    setWizFrom(uncollectedSince);
    setWizTo(getTodayISO());
  }, [uncollectedSince]);

  const [wizBasis, setWizBasis] = useState('vat_inclusive');
  const [wizVat, setWizVat] = useState('13');
  const [wizRate, setWizRate] = useState('');
  const [wizNotes, setWizNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [collecting, setCollecting] = useState(false);

  // Prefill the wizard's basis/VAT%/cut% from the last collection's snapshot
  // (what actually applied last cycle), falling back to the currently open
  // rate row for orgs that have a rate but no collection yet. Runs once, the
  // first time either list has data, so it never clobbers an in-progress edit.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current) return;
    const src = lastCollection?.rate_percent != null ? lastCollection : activeRate;
    if (!src) return;
    prefilledRef.current = true;
    setWizBasis(src.commission_basis);
    setWizVat(String(src.vat_rate_percent));
    setWizRate(String(src.rate_percent));
  }, [lastCollection, activeRate]);

  const effectiveFrom = wizFrom;
  const effectiveTo = wizTo;

  const reload = useCallback(() => {
    setError('');
    Promise.all([
      listRates(orgId), listCollections(orgId),
      getOrgBookings(orgId, range.startDate, range.endDate),
      getOrgMembershipDeposits(orgId, range.startDate, range.endDate),
      getOrgVoucherSales(orgId, range.startDate, range.endDate),
    ])
      .then(([r, c, b, md, vs]) => {
        setRates(r || []); setCollections(c || []); setBookings(b || []);
        setMembershipDeposits(md || []); setVoucherSales(vs || []);
      })
      .catch((e) => setError(e.message || 'Load failed'));
  }, [orgId, range.startDate, range.endDate]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    let alive = true;
    setRollupLoading(true);
    getRevenueRollup(effectiveFrom, effectiveTo)
      .then((rows) => { if (alive) setOrgRollup((rows || []).find((r) => r.org_id === orgId) || null); })
      .catch((e) => { if (alive) setError(e.message || 'Failed to load revenue'); })
      .finally(() => { if (alive) setRollupLoading(false); });
    return () => { alive = false; };
  }, [orgId, effectiveFrom, effectiveTo]);

  const paidBookings = useMemo(() =>
    bookings
      .filter((b) => b.payment_status === 'paid')
      .map((b) => ({ ...b, nonWalletAmount: nonWalletAmount(b) }))
      .filter((b) => b.nonWalletAmount > 0),
    [bookings]);

  const bookingRows = useMemo(() =>
    paidBookings.map((b) => ({
      key: `booking-${b.booking_id}`, type: 'Booking', date: b.date,
      branch_name: b.branch_name, description: b.service_name, amount: b.nonWalletAmount,
    })),
    [paidBookings]);

  const membershipRows = useMemo(() =>
    membershipDeposits.map((m, i) => ({
      key: `membership-${i}`, type: 'Membership', date: m.date, branch_name: m.branch_name,
      description: m.customer_name + (m.notes ? ` — ${m.notes}` : ''), amount: Number(m.amount || 0),
    })),
    [membershipDeposits]);

  const voucherRows = useMemo(() =>
    voucherSales.map((v, i) => ({
      key: `voucher-${i}`, type: 'Voucher', date: v.date, branch_name: v.branch_name,
      description: `${v.guest_name} (${v.voucher_code})`, amount: Number(v.amount || 0),
    })),
    [voucherSales]);

  const [drillFilter, setDrillFilter] = useState('all'); // 'all' | 'bookings' | 'memberships' | 'vouchers'
  const [branchFilter, setBranchFilter] = useState('all');

  const branchOptions = useMemo(() => {
    const names = new Set([...bookingRows, ...membershipRows, ...voucherRows].map((r) => r.branch_name));
    return [{ value: 'all', label: 'All branches' },
      ...[...names].sort().map((n) => ({ value: n, label: n }))];
  }, [bookingRows, membershipRows, voucherRows]);

  const drillRows = useMemo(() => {
    const rows = drillFilter === 'bookings' ? bookingRows
      : drillFilter === 'memberships' ? membershipRows
      : drillFilter === 'vouchers' ? voucherRows
      : [...bookingRows, ...membershipRows, ...voucherRows];
    return rows
      .filter((r) => branchFilter === 'all' || r.branch_name === branchFilter)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [drillFilter, branchFilter, bookingRows, membershipRows, voucherRows]);

  const drillSubtotal = drillRows.reduce((sum, r) => sum + r.amount, 0);

  const DRILL_PAGE_SIZE = 100;
  const [drillPage, setDrillPage] = useState(1);
  useEffect(() => { setDrillPage(1); }, [drillFilter, branchFilter, preset]);
  const drillPageCount = Math.max(1, Math.ceil(drillRows.length / DRILL_PAGE_SIZE));
  const drillPageRows = drillRows.slice((drillPage - 1) * DRILL_PAGE_SIZE, drillPage * DRILL_PAGE_SIZE);

  const DRILL_FILTERS = [
    { value: 'all', label: 'All' },
    { value: 'bookings', label: 'Paid Bookings' },
    { value: 'memberships', label: 'Paid Memberships' },
    { value: 'vouchers', label: 'Paid Vouchers' },
  ];

  const grossSales = Number(orgRollup?.gross_total || 0);
  const wizVatNum = Number(wizVat || 0);
  const wizRateNum = Number(wizRate || 0);
  const commissionBase = wizBasis === 'vat_exclusive' ? grossSales / (1 + wizVatNum / 100) : grossSales;
  const computedCommission = commissionBase * wizRateNum / 100;

  const submitCollect = async () => {
    setCollecting(true);
    try {
      await collectCommission({
        orgId, periodStart: wizFrom, periodEnd: wizTo,
        ratePercent: wizRateNum, basis: wizBasis, vatRatePercent: wizVatNum,
        collectedAt: getTodayISO(), notes: wizNotes,
      });
      setWizNotes('');
      setConfirming(false);
      reload();
    } catch (err) { setError(err.message); }
    finally { setCollecting(false); }
  };

  return (
    <div className="min-h-screen bg-background">
      <PlatformNav />
      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        <Link to="/platform/dashboard" className="font-body text-sm text-primary hover:underline">← All clients</Link>
        {error && <p className="font-body text-sm text-error">{error}</p>}

        {/* Collect Commission wizard */}
        <section className="bg-surface rounded-spa-lg shadow-spa-resting p-4 space-y-3">
          <h3 className="font-heading font-heading-semibold text-text-primary">Collect Commission</h3>

          <div className="flex flex-wrap items-end gap-3">
            <label className="font-body text-sm text-text-secondary">Period start
              <input type="date" value={wizFrom} onChange={(e) => setWizFrom(e.target.value)}
                className="block border border-border rounded-spa px-2 py-1" />
            </label>
            <label className="font-body text-sm text-text-secondary">Period end
              <input type="date" value={wizTo} onChange={(e) => setWizTo(e.target.value)}
                className="block border border-border rounded-spa px-2 py-1" />
            </label>
          </div>

          {rollupLoading ? (
            <p className="font-body text-sm text-text-secondary">Loading…</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 font-data text-sm pt-2 border-t border-border">
                <div>
                  <dt className="font-body text-xs text-text-secondary">Sales (period)</dt>
                  <dd className="text-text-primary">{formatNPR(grossSales)}</dd>
                </div>
                <div>
                  <dt className="font-body text-xs text-text-secondary">Owed to date</dt>
                  <dd className="text-text-primary">{orgRollup?.commission_owed_to_date == null ? '—' : formatNPR(orgRollup.commission_owed_to_date)}</dd>
                </div>
                <div>
                  <dt className="font-body text-xs text-text-secondary">Collected to date</dt>
                  <dd className="text-text-primary">{formatNPR(orgRollup?.collected_to_date)}</dd>
                </div>
                <div>
                  <dt className="font-body text-xs text-text-secondary">Net owed</dt>
                  <dd className="text-text-primary font-heading-semibold">{orgRollup?.net_owed == null ? '—' : formatNPR(orgRollup.net_owed)}</dd>
                </div>
              </dl>

              <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-border">
                <div className="w-64">
                  <span className="font-body text-sm text-text-secondary">Basis</span>
                  <CustomSelect value={wizBasis} onChange={setWizBasis} options={BASIS_OPTIONS} />
                </div>
                <label className="font-body text-sm text-text-secondary">VAT %
                  <input type="number" step="0.01" value={wizVat} onChange={(e) => setWizVat(e.target.value)}
                    className="block border border-border rounded-spa px-2 py-1 w-20" />
                </label>
                <label className="font-body text-sm text-text-secondary">Cut %
                  <input type="number" step="0.01" value={wizRate} onChange={(e) => setWizRate(e.target.value)}
                    className="block border border-border rounded-spa px-2 py-1 w-24" />
                </label>
                <label className="font-body text-sm text-text-secondary flex-1 min-w-[10rem]">Notes
                  <input value={wizNotes} onChange={(e) => setWizNotes(e.target.value)}
                    className="block border border-border rounded-spa px-2 py-1 w-full" />
                </label>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border">
                <div>
                  <p className="font-body text-xs text-text-secondary">Commission ({wizFrom} → {wizTo})</p>
                  <p className="font-data text-lg font-heading-semibold text-text-primary">{formatNPR(computedCommission)}</p>
                </div>
                {!confirming ? (
                  <button type="button" onClick={() => setConfirming(true)} disabled={!wizRateNum}
                    className="bg-primary text-white rounded-spa px-4 py-2 font-body text-sm disabled:opacity-40">
                    Collect Commission
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-body text-sm text-text-secondary">
                      Record {formatNPR(computedCommission)} at {wizRateNum}% · {wizBasis === 'vat_exclusive' ? `VAT-excl @ ${wizVatNum}%` : 'VAT-incl'}?
                    </span>
                    <button type="button" onClick={() => setConfirming(false)} disabled={collecting}
                      className="rounded-spa px-3 py-1.5 border border-border font-body text-sm text-text-secondary">
                      Cancel
                    </button>
                    <button type="button" onClick={submitCollect} disabled={collecting}
                      className="bg-primary text-white rounded-spa px-3 py-1.5 font-body text-sm disabled:opacity-40">
                      {collecting ? 'Collecting…' : 'Confirm & Collect'}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        {/* Collection history */}
        <section className="bg-surface rounded-spa-lg shadow-spa-resting p-4 space-y-3">
          <h3 className="font-heading font-heading-semibold text-text-primary">Collection history</h3>
          <ul className="space-y-1 font-data text-sm">
            {collections.map((c) => (
              <li key={c.id} className="text-text-primary">
                {formatNPR(c.amount_collected)} · {c.period_start} → {c.period_end} ·
                {' '}{c.rate_percent != null
                  ? `${c.rate_percent}% · ${c.commission_basis === 'vat_exclusive' ? `VAT-excl @ ${c.vat_rate_percent}%` : 'VAT-incl'}`
                  : '—'} ·
                {' '}collected {c.collected_at}
                {c.notes ? ` · ${c.notes}` : ''}
              </li>
            ))}
            {collections.length === 0 && <li className="text-text-secondary font-body">Nothing collected yet.</li>}
          </ul>
        </section>

        {/* Itemized paid drill-in */}
        <section className="bg-surface rounded-spa-lg shadow-spa-resting p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-heading font-heading-semibold text-text-primary">Paid Bookings, Memberships & Vouchers</h3>
            <div className="flex gap-2">
              <div className="w-48">
                <CustomSelect value={branchFilter} onChange={setBranchFilter} options={branchOptions} />
              </div>
              <div className="w-48">
                <CustomSelect value={preset} onChange={setPreset}
                  options={PERIOD_PRESETS.map((p) => ({ value: p.id, label: p.label }))} />
              </div>
            </div>
          </div>
          <p className="font-body text-xs text-text-secondary">
            Paid only. Unpaid/refunded bookings are excluded (not new money, or not money yet), and
            wallet-funded portions of a booking (membership/referral/voucher redemption) are excluded
            here since they're already counted in Paid Memberships/Vouchers. Totals here only match
            the "Sales (range)" figure above when this preset's range equals the calculator's
            selected range — the two are controlled independently.
          </p>

          <div className="flex gap-2 flex-wrap">
            {DRILL_FILTERS.map((f) => (
              <button key={f.value} type="button" onClick={() => setDrillFilter(f.value)}
                className={`font-body text-sm rounded-spa px-3 py-1 border ${drillFilter === f.value ? 'bg-primary text-white border-primary' : 'border-border text-text-secondary'}`}>
                {f.label}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto overflow-y-auto max-h-[28rem] border border-border rounded-spa">
            <table className="w-full text-sm font-data">
              <thead className="text-text-secondary border-b border-border sticky top-0 bg-surface z-10">
                <tr>
                  <th className="text-left px-3 py-2 font-body">Date</th>
                  <th className="text-left px-3 py-2 font-body">Type</th>
                  <th className="text-left px-3 py-2 font-body">Branch</th>
                  <th className="text-left px-3 py-2 font-body">Description</th>
                  <th className="text-right px-3 py-2 font-body">Amount</th>
                </tr>
              </thead>
              <tbody>
                {drillPageRows.map((r) => (
                  <tr key={r.key} className="border-b border-border">
                    <td className="px-3 py-1.5">{r.date}</td>
                    <td className="px-3 py-1.5">{r.type}</td>
                    <td className="px-3 py-1.5">{r.branch_name}</td>
                    <td className="px-3 py-1.5">{r.description}</td>
                    <td className="px-3 py-1.5 text-right">{formatNPR(r.amount)}</td>
                  </tr>
                ))}
                {drillRows.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center font-body text-text-secondary">Nothing in range.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {drillRows.length > 0 && (
            <div className="flex items-center justify-between font-body text-sm text-text-secondary">
              <div className="flex items-center gap-2">
                <button type="button" disabled={drillPage <= 1} onClick={() => setDrillPage((p) => p - 1)}
                  className="rounded-spa px-2 py-1 border border-border disabled:opacity-40">Prev</button>
                <span>Page {drillPage} of {drillPageCount}</span>
                <button type="button" disabled={drillPage >= drillPageCount} onClick={() => setDrillPage((p) => p + 1)}
                  className="rounded-spa px-2 py-1 border border-border disabled:opacity-40">Next</button>
              </div>
              <span>{drillRows.length} row{drillRows.length === 1 ? '' : 's'}</span>
            </div>
          )}

          <div className="sticky bottom-0 -mx-4 -mb-4 px-4 py-2 bg-surface border-t border-border shadow-spa-elevated flex items-center justify-between font-data font-body-semibold">
            <span className="font-body text-sm text-text-secondary">Subtotal</span>
            <span className="text-text-primary">{formatNPR(drillSubtotal)}</span>
          </div>
        </section>
      </main>
    </div>
  );
};

export default PlatformOrgDetail;
