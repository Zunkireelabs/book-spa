import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import CustomSelect from 'components/ui/CustomSelect';
import PlatformNav from './components/PlatformNav';
import {
  listRates, listCollections, collectCommission, getOrgBookings,
  getOrgMembershipDeposits, getOrgVoucherSales,
  getRevenueRollup, formatNPR,
} from 'services/platformApi';
import { getTodayISO, toISO } from 'utils/periodPresets';
import { exportRowsToExcel, exportSheetsToExcel } from 'utils/exportExcel';

const BASIS_OPTIONS = [
  { value: 'vat_inclusive', label: 'VAT inclusive (rate on full amount)' },
  { value: 'vat_exclusive', label: 'VAT exclusive (back VAT out first)' },
];

// Same exclusion list as migration-142's platform_org_sales_base (originally
// migration-116) — these payment modes settle out of a wallet/membership/package
// balance, not new money, so they must be excluded here or they'd double-count
// against the Paid Memberships/Vouchers lists (and, for SessionPackage, against
// the money already collected when the package itself was sold).
const WALLET_PAYMENT_MODES = ['Membership', 'ReferralWallet', 'VoucherWallet', 'ReferralVoucher', 'SessionPackage'];

const nonWalletAmount = (booking) =>
  (booking.payments || [])
    .filter((p) => !WALLET_PAYMENT_MODES.includes(p.payment_mode))
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

// Pure row-shapers, reused both for the currently-loaded period (via useMemo
// below) and for an on-demand per-period Detail export (a historical period
// whose itemized bookings/memberships/vouchers aren't already in state).
const toBookingRows = (bookings) =>
  bookings
    .filter((b) => b.payment_status === 'paid')
    .map((b) => ({ ...b, nonWalletAmount: nonWalletAmount(b) }))
    .filter((b) => b.nonWalletAmount > 0)
    .map((b) => ({
      key: `booking-${b.booking_id}`, type: 'Booking', date: b.date,
      branch_name: b.branch_name, description: b.service_name, amount: b.nonWalletAmount,
    }));

const toMembershipRows = (membershipDeposits) =>
  membershipDeposits.map((m, i) => ({
    key: `membership-${i}`, type: 'Membership', date: m.date, branch_name: m.branch_name,
    description: m.customer_name + (m.notes ? ` — ${m.notes}` : ''), amount: Number(m.amount || 0),
  }));

const toVoucherRows = (voucherSales) =>
  voucherSales.map((v, i) => ({
    key: `voucher-${i}`, type: 'Voucher', date: v.date, branch_name: v.branch_name,
    description: `${v.guest_name} (${v.voucher_code})`, amount: Number(v.amount || 0),
  }));

const dayAfter = (isoDate) => {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return toISO(d);
};

const ALL_TIME_FROM = '2000-01-01';

// Hard mathematical ceiling — matches the chk_vat_rate_sane DB constraint
// (migration-126). VAT backs out of gross sales as 1 + rate/100, so anything
// above 100 has no sane interpretation.
const VAT_RATE_MAX = 100;

const PlatformOrgDetail = () => {
  const { orgId } = useParams();

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
    return ALL_TIME_FROM;
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
  const [wizActualAmount, setWizActualAmount] = useState('');
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

  // Rates/collections aren't period-scoped (full history) — only refetch on
  // org change or after a commission is collected, never on a date edit.
  const reloadRatesAndCollections = useCallback(() => {
    setError('');
    Promise.all([listRates(orgId), listCollections(orgId)])
      .then(([r, c]) => { setRates(r || []); setCollections(c || []); })
      .catch((e) => setError(e.message || 'Load failed'));
  }, [orgId]);

  useEffect(() => { reloadRatesAndCollections(); }, [reloadRatesAndCollections]);

  // Bookings/memberships/vouchers ARE period-scoped — refetch whenever the
  // shared Period start/end changes.
  useEffect(() => {
    setError('');
    Promise.all([
      getOrgBookings(orgId, wizFrom, wizTo),
      getOrgMembershipDeposits(orgId, wizFrom, wizTo),
      getOrgVoucherSales(orgId, wizFrom, wizTo),
    ])
      .then(([b, md, vs]) => {
        setBookings(b || []); setMembershipDeposits(md || []); setVoucherSales(vs || []);
      })
      .catch((e) => setError(e.message || 'Load failed'));
  }, [orgId, wizFrom, wizTo]);

  useEffect(() => {
    let alive = true;
    setRollupLoading(true);
    getRevenueRollup(effectiveFrom, effectiveTo)
      .then((rows) => { if (alive) setOrgRollup((rows || []).find((r) => r.org_id === orgId) || null); })
      .catch((e) => { if (alive) setError(e.message || 'Failed to load revenue'); })
      .finally(() => { if (alive) setRollupLoading(false); });
    return () => { alive = false; };
  }, [orgId, effectiveFrom, effectiveTo]);

  const bookingRows = useMemo(() => toBookingRows(bookings), [bookings]);
  const membershipRows = useMemo(() => toMembershipRows(membershipDeposits), [membershipDeposits]);
  const voucherRows = useMemo(() => toVoucherRows(voucherSales), [voucherSales]);

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
  useEffect(() => { setDrillPage(1); }, [drillFilter, branchFilter, wizFrom, wizTo]);
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

  const buildCollectionSummaryRows = (list) => list.map((c) => {
    const vatExclBase = c.gross_sales == null ? null
      : c.commission_basis === 'vat_exclusive' ? c.gross_sales / (1 + Number(c.vat_rate_percent || 0) / 100)
      : c.gross_sales;
    return {
      'Period Start': c.period_start,
      'Period End': c.period_end,
      'Sales': c.gross_sales == null ? '' : Number(c.gross_sales),
      'VAT-excl. Base': vatExclBase == null ? '' : Number(vatExclBase),
      'Cut %': c.rate_percent == null ? '' : Number(c.rate_percent),
      'Amount To Be Collected': c.expected_amount == null ? '' : Number(c.expected_amount),
      'Amount Already Collected': Number(c.amount_collected),
      'Collected On': c.collected_at,
      'Notes': c.notes || '',
    };
  });

  // Whole-table summary export — every past collection period, one row each.
  const handleExportAllSummary = () => {
    exportRowsToExcel(`commission-collection-history-${orgId}`, buildCollectionSummaryRows(collections), 'Collection History');
  };

  // Single-period summary export — same shape, one row.
  const handleExportRowSummary = (c) => {
    exportRowsToExcel(`commission-summary-${orgId}-${c.period_start}_to_${c.period_end}`,
      buildCollectionSummaryRows([c]), 'Summary');
  };

  // Single-period detail export — itemized bookings/memberships/vouchers for
  // THAT historical period's own dates, fetched on demand (not already in
  // state, since only the currently-selected Period is loaded live).
  // Itemized bookings/memberships/vouchers for an arbitrary historical period
  // (not the currently-selected Period — fetched fresh for whatever dates a
  // past collection row covers).
  const fetchPeriodDetailRows = async (periodStart, periodEnd) => {
    const [b, md, vs] = await Promise.all([
      getOrgBookings(orgId, periodStart, periodEnd),
      getOrgMembershipDeposits(orgId, periodStart, periodEnd),
      getOrgVoucherSales(orgId, periodStart, periodEnd),
    ]);
    return [...toBookingRows(b || []), ...toMembershipRows(md || []), ...toVoucherRows(vs || [])]
      .sort((r1, r2) => (r1.date < r2.date ? 1 : r1.date > r2.date ? -1 : 0))
      .map((r) => ({ Date: r.date, Type: r.type, Branch: r.branch_name, Description: r.description, Amount: r.amount }));
  };

  const [detailExportingId, setDetailExportingId] = useState(null);
  const handleExportRowDetail = async (c) => {
    setDetailExportingId(c.id);
    try {
      const rows = await fetchPeriodDetailRows(c.period_start, c.period_end);
      exportRowsToExcel(`commission-detail-${orgId}-${c.period_start}_to_${c.period_end}`, rows, 'Detail');
    } catch (e) {
      setError(e.message || 'Detail export failed');
    } finally {
      setDetailExportingId(null);
    }
  };

  // Every period's itemized detail in one workbook — one sheet per period
  // (fetched in parallel) plus a Summary sheet up front for context.
  const [allDetailExporting, setAllDetailExporting] = useState(false);
  const handleExportAllDetail = async () => {
    setAllDetailExporting(true);
    try {
      const perPeriod = await Promise.all(
        collections.map(async (c) => ({
          name: `${c.period_start}_${c.period_end}`,
          rows: await fetchPeriodDetailRows(c.period_start, c.period_end),
        }))
      );
      exportSheetsToExcel(`commission-detail-all-${orgId}`, [
        { name: 'Summary', rows: buildCollectionSummaryRows(collections) },
        ...perPeriod,
      ]);
    } catch (e) {
      setError(e.message || 'Detail export failed');
    } finally {
      setAllDetailExporting(false);
    }
  };

  // Present-period export — the not-yet-collected numbers currently shown in
  // the Collect Commission panel, for whatever Period start/end is selected.
  const handleExportPresentPeriod = () => {
    exportRowsToExcel(`commission-present-period-${orgId}`, [{
      'Period Start': wizFrom,
      'Period End': wizTo,
      'Sales (Period)': grossSales,
      'Owed To Date': orgRollup?.commission_owed_to_date == null ? '' : Number(orgRollup.commission_owed_to_date),
      'Collected To Date': orgRollup?.collected_to_date == null ? '' : Number(orgRollup.collected_to_date),
      'Net Owed': orgRollup?.net_owed == null ? '' : Number(orgRollup.net_owed),
    }], 'Present Period');
  };

  const submitCollect = async () => {
    setCollecting(true);
    try {
      await collectCommission({
        orgId, periodStart: wizFrom, periodEnd: wizTo,
        ratePercent: wizRateNum, basis: wizBasis, vatRatePercent: wizVatNum,
        collectedAt: getTodayISO(), notes: wizNotes, actualAmount: wizActualAmount,
      });
      setWizNotes('');
      setWizActualAmount('');
      setConfirming(false);
      reloadRatesAndCollections();
    } catch (err) { setError(err.message); }
    finally { setCollecting(false); }
  };

  return (
    <div className="min-h-screen bg-background">
      <PlatformNav />
      <main className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        <Link to="/platform/dashboard" className="font-body text-sm text-primary hover:underline">← All clients</Link>
        {error && <p className="font-body text-sm text-error">{error}</p>}

        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6 items-start">
          {/* Period filter — drives every section on this page (Collect Commission,
              Collection history, and the Paid Bookings/Memberships/Vouchers drill-in) */}
          <aside className="bg-surface rounded-spa-lg shadow-spa-resting p-4 space-y-3 lg:sticky lg:top-6">
            <h3 className="font-heading font-heading-semibold text-text-primary text-sm">Period</h3>
            <label className="font-body text-sm text-text-secondary block">Start
              <input type="date" value={wizFrom} onChange={(e) => setWizFrom(e.target.value)}
                className="block border border-border rounded-spa px-2 py-1 w-full mt-1" />
            </label>
            <label className="font-body text-sm text-text-secondary block">End
              <input type="date" value={wizTo} onChange={(e) => setWizTo(e.target.value)}
                className="block border border-border rounded-spa px-2 py-1 w-full mt-1" />
            </label>
            <div className="pt-2 border-t border-border">
              <span className="font-body text-sm text-text-secondary block mb-1">Branch</span>
              <CustomSelect value={branchFilter} onChange={setBranchFilter} options={branchOptions} />
            </div>
          </aside>

          <div className="space-y-6 min-w-0">

        {/* Collect Commission wizard */}
        <section className="bg-surface rounded-spa-lg shadow-spa-resting p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-heading font-heading-semibold text-text-primary">Collect Commission</h3>
            <button type="button" onClick={handleExportPresentPeriod} disabled={rollupLoading}
              className="font-body text-sm rounded-spa px-3 py-1.5 border border-border text-text-secondary disabled:opacity-40">
              Export Excel (Present Period)
            </button>
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
                    className={`block border rounded-spa px-2 py-1 w-20 ${wizVatNum > VAT_RATE_MAX ? 'border-error' : 'border-border'}`} />
                  {wizVatNum > VAT_RATE_MAX && (
                    <span className="block text-xs text-error mt-0.5">Max {VAT_RATE_MAX}%</span>
                  )}
                </label>
                <label className="font-body text-sm text-text-secondary">Cut %
                  <input type="number" step="0.01" value={wizRate} onChange={(e) => setWizRate(e.target.value)}
                    className="block border border-border rounded-spa px-2 py-1 w-24" />
                </label>
                <label className="font-body text-sm text-text-secondary">Actual amount collected (if different)
                  <input type="number" step="0.01" placeholder="Use computed" value={wizActualAmount}
                    onChange={(e) => setWizActualAmount(e.target.value)}
                    className="block border border-border rounded-spa px-2 py-1 w-40" />
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
                  {wizActualAmount !== '' && (
                    <p className="font-body text-xs text-text-secondary">Will record actual: {formatNPR(Number(wizActualAmount))}</p>
                  )}
                </div>
                {!confirming ? (
                  <button type="button" onClick={() => setConfirming(true)}
                    disabled={!wizRateNum || Number.isNaN(wizVatNum) || wizRateNum < 0 || wizVatNum < 0 || wizVatNum > VAT_RATE_MAX}
                    className="bg-primary text-white rounded-spa px-4 py-2 font-body text-sm disabled:opacity-40">
                    Collect Commission
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-body text-sm text-text-secondary">
                      Record {wizActualAmount !== '' ? formatNPR(Number(wizActualAmount)) : formatNPR(computedCommission)} at {wizRateNum}% · {wizBasis === 'vat_exclusive' ? `VAT-excl @ ${wizVatNum}%` : 'VAT-incl'}?
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
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-heading font-heading-semibold text-text-primary">Collection history</h3>
            <div className="flex gap-2">
              <button type="button" onClick={handleExportAllSummary} disabled={collections.length === 0}
                className="font-body text-sm rounded-spa px-3 py-1.5 border border-border text-text-secondary disabled:opacity-40">
                Export All (Summary)
              </button>
              <button type="button" onClick={handleExportAllDetail} disabled={collections.length === 0 || allDetailExporting}
                className="font-body text-sm rounded-spa px-3 py-1.5 border border-border text-text-secondary disabled:opacity-40">
                {allDetailExporting ? 'Loading…' : 'Export All (Detail)'}
              </button>
            </div>
          </div>
          {collections.length === 0 ? (
            <p className="text-text-secondary font-body text-sm">Nothing collected yet.</p>
          ) : (
            <div className="overflow-x-auto border border-border rounded-spa">
              <table className="w-full text-sm font-data">
                <thead className="text-text-secondary border-b border-border bg-background">
                  <tr>
                    <th className="text-left px-3 py-2 font-body">Period</th>
                    <th className="text-right px-3 py-2 font-body">Sales</th>
                    <th className="text-right px-3 py-2 font-body">VAT-excl. base</th>
                    <th className="text-right px-3 py-2 font-body">Cut %</th>
                    <th className="text-right px-3 py-2 font-body">Expected</th>
                    <th className="text-right px-3 py-2 font-body">Collected</th>
                    <th className="text-left px-3 py-2 font-body">Collected On</th>
                    <th className="text-left px-3 py-2 font-body">Notes</th>
                    <th className="text-left px-3 py-2 font-body">Export</th>
                  </tr>
                </thead>
                <tbody>
                  {collections.map((c) => {
                    const vatExclBase = c.gross_sales == null ? null
                      : c.commission_basis === 'vat_exclusive' ? c.gross_sales / (1 + Number(c.vat_rate_percent || 0) / 100)
                      : c.gross_sales;
                    return (
                      <tr key={c.id} className="border-b border-border last:border-0 whitespace-nowrap">
                        <td className="px-3 py-2 text-text-primary">{c.period_start} → {c.period_end}</td>
                        <td className="px-3 py-2 text-right text-text-primary">{c.gross_sales == null ? '—' : formatNPR(c.gross_sales)}</td>
                        <td className="px-3 py-2 text-right text-text-secondary">{vatExclBase == null ? '—' : formatNPR(vatExclBase)}</td>
                        <td className="px-3 py-2 text-right text-text-primary">
                          {c.rate_percent != null
                            ? `${c.rate_percent}% (${c.commission_basis === 'vat_exclusive' ? `excl. @ ${c.vat_rate_percent}%` : 'incl.'})`
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-text-secondary">
                          {c.expected_amount == null ? '—' : formatNPR(c.expected_amount)}
                        </td>
                        <td className="px-3 py-2 text-right text-text-primary font-heading-semibold">
                          {formatNPR(c.amount_collected)}
                          {c.expected_amount != null && Number(c.expected_amount) !== Number(c.amount_collected) && (
                            <span className="block text-xs font-body font-body-normal text-warning">adjusted</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-text-secondary">{c.collected_at}</td>
                        <td className="px-3 py-2 text-text-secondary">{c.notes || '—'}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <button type="button" onClick={() => handleExportRowSummary(c)}
                              className="font-body text-xs text-primary hover:underline">
                              Summary
                            </button>
                            <button type="button" onClick={() => handleExportRowDetail(c)}
                              disabled={detailExportingId === c.id}
                              className="font-body text-xs text-primary hover:underline disabled:opacity-40">
                              {detailExportingId === c.id ? 'Loading…' : 'Detail'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Itemized paid drill-in */}
        <section className="bg-surface rounded-spa-lg shadow-spa-resting p-4 space-y-3">
          <h3 className="font-heading font-heading-semibold text-text-primary">Paid Bookings, Memberships & Vouchers</h3>
          <p className="font-body text-xs text-text-secondary">
            Paid only. Unpaid/refunded bookings are excluded (not new money, or not money yet), and
            wallet-funded portions of a booking (membership/referral/voucher redemption) are excluded
            here since they're already counted in Paid Memberships/Vouchers. Filtered by the Period
            dates on the left — matches the "Sales (period)" figure above exactly.
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
              <thead className="text-text-secondary border-b border-border sticky top-0 bg-surface z-sticky-filter">
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

          </div>
        </div>
      </main>
    </div>
  );
};

export default PlatformOrgDetail;
