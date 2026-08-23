import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import CustomSelect from 'components/ui/CustomSelect';
import PlatformNav from './components/PlatformNav';
import {
  listRates, listCollections, setCommissionRate, recordCollection, getOrgBookings, formatNPR,
} from 'services/platformApi';
import { PERIOD_PRESETS, getPeriodRange, getTodayISO } from 'utils/periodPresets';

const BASIS_OPTIONS = [
  { value: 'vat_inclusive', label: 'VAT inclusive (rate on full amount)' },
  { value: 'vat_exclusive', label: 'VAT exclusive (back VAT out first)' },
];

const PlatformOrgDetail = () => {
  const { orgId } = useParams();
  const [preset, setPreset] = useState('monthly');
  const range = useMemo(() => getPeriodRange(preset), [preset]);

  const [rates, setRates] = useState([]);
  const [collections, setCollections] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState('');

  // new-rate form
  const [rate, setRate] = useState('');
  const [basis, setBasis] = useState('vat_inclusive');
  const [vatRate, setVatRate] = useState('13');
  const [effFrom, setEffFrom] = useState(getTodayISO());

  // new-collection form
  const [colAmount, setColAmount] = useState('');
  const [colFrom, setColFrom] = useState(range.startDate);
  const [colTo, setColTo] = useState(range.endDate);
  const [colAt, setColAt] = useState(getTodayISO());
  const [colNotes, setColNotes] = useState('');

  // Keep the "record collection" period in step with the selected preset.
  useEffect(() => {
    setColFrom(range.startDate);
    setColTo(range.endDate);
  }, [range.startDate, range.endDate]);

  const reload = useCallback(() => {
    setError('');
    Promise.all([listRates(orgId), listCollections(orgId), getOrgBookings(orgId, range.startDate, range.endDate)])
      .then(([r, c, b]) => { setRates(r || []); setCollections(c || []); setBookings(b || []); })
      .catch((e) => setError(e.message || 'Load failed'));
  }, [orgId, range.startDate, range.endDate]);

  useEffect(() => { reload(); }, [reload]);

  const submitRate = async (e) => {
    e.preventDefault();
    try {
      await setCommissionRate({
        orgId, ratePercent: Number(rate), basis,
        vatRatePercent: Number(vatRate), effectiveFrom: effFrom,
      });
      setRate('');
      reload();
    } catch (err) { setError(err.message); }
  };

  const submitCollection = async (e) => {
    e.preventDefault();
    try {
      await recordCollection({
        orgId, periodStart: colFrom, periodEnd: colTo,
        amount: Number(colAmount), collectedAt: colAt, notes: colNotes,
      });
      setColAmount(''); setColNotes('');
      reload();
    } catch (err) { setError(err.message); }
  };

  return (
    <div className="min-h-screen bg-background">
      <PlatformNav />
      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        <Link to="/platform/dashboard" className="font-body text-sm text-primary hover:underline">← All clients</Link>
        {error && <p className="font-body text-sm text-error">{error}</p>}

        {/* Rate history + add */}
        <section className="bg-surface rounded-spa-lg shadow-spa-resting p-4 space-y-3">
          <h3 className="font-heading font-heading-semibold text-text-primary">Commission rate history</h3>
          <ul className="space-y-1 font-data text-sm">
            {rates.map((r) => (
              <li key={r.id} className="text-text-primary">
                {r.rate_percent}% · {r.commission_basis === 'vat_exclusive' ? `VAT-excl @ ${r.vat_rate_percent}%` : 'VAT-incl'} ·
                {' '}{r.effective_from} → {r.effective_to || 'active'}
              </li>
            ))}
            {rates.length === 0 && <li className="text-text-secondary font-body">No rate configured.</li>}
          </ul>
          <form onSubmit={submitRate} className="flex flex-wrap items-end gap-3 pt-2 border-t border-border">
            <label className="font-body text-sm text-text-secondary">Rate %
              <input required type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)}
                className="block border border-border rounded-spa px-2 py-1 w-24" />
            </label>
            <div className="w-64">
              <span className="font-body text-sm text-text-secondary">Basis</span>
              <CustomSelect value={basis} onChange={setBasis} options={BASIS_OPTIONS} />
            </div>
            <label className="font-body text-sm text-text-secondary">VAT %
              <input type="number" step="0.01" value={vatRate} onChange={(e) => setVatRate(e.target.value)}
                className="block border border-border rounded-spa px-2 py-1 w-20" />
            </label>
            <label className="font-body text-sm text-text-secondary">Effective from
              <input required type="date" value={effFrom} onChange={(e) => setEffFrom(e.target.value)}
                className="block border border-border rounded-spa px-2 py-1" />
            </label>
            <button type="submit" className="bg-primary text-white rounded-spa px-3 py-1.5 font-body text-sm">Add rate</button>
          </form>
        </section>

        {/* Collections */}
        <section className="bg-surface rounded-spa-lg shadow-spa-resting p-4 space-y-3">
          <h3 className="font-heading font-heading-semibold text-text-primary">Collections</h3>
          <ul className="space-y-1 font-data text-sm">
            {collections.map((c) => (
              <li key={c.id} className="text-text-primary">
                {formatNPR(c.amount_collected)} · {c.period_start} → {c.period_end} · collected {c.collected_at}
                {c.notes ? ` · ${c.notes}` : ''}
              </li>
            ))}
            {collections.length === 0 && <li className="text-text-secondary font-body">Nothing collected yet.</li>}
          </ul>
          <form onSubmit={submitCollection} className="flex flex-wrap items-end gap-3 pt-2 border-t border-border">
            <label className="font-body text-sm text-text-secondary">Amount
              <input required type="number" step="0.01" value={colAmount} onChange={(e) => setColAmount(e.target.value)}
                className="block border border-border rounded-spa px-2 py-1 w-28" />
            </label>
            <label className="font-body text-sm text-text-secondary">Period start
              <input required type="date" value={colFrom} onChange={(e) => setColFrom(e.target.value)}
                className="block border border-border rounded-spa px-2 py-1" />
            </label>
            <label className="font-body text-sm text-text-secondary">Period end
              <input required type="date" value={colTo} onChange={(e) => setColTo(e.target.value)}
                className="block border border-border rounded-spa px-2 py-1" />
            </label>
            <label className="font-body text-sm text-text-secondary">Collected on
              <input required type="date" value={colAt} onChange={(e) => setColAt(e.target.value)}
                className="block border border-border rounded-spa px-2 py-1" />
            </label>
            <label className="font-body text-sm text-text-secondary">Notes
              <input value={colNotes} onChange={(e) => setColNotes(e.target.value)}
                className="block border border-border rounded-spa px-2 py-1" />
            </label>
            <button type="submit" className="bg-primary text-white rounded-spa px-3 py-1.5 font-body text-sm">Record</button>
          </form>
        </section>

        {/* Booking drill-in */}
        <section className="bg-surface rounded-spa-lg shadow-spa-resting p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-heading font-heading-semibold text-text-primary">Bookings</h3>
            <div className="w-48">
              <CustomSelect value={preset} onChange={setPreset}
                options={PERIOD_PRESETS.map((p) => ({ value: p.id, label: p.label }))} />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-data">
              <thead className="text-text-secondary border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2 font-body">Date</th>
                  <th className="text-left px-3 py-2 font-body">Branch</th>
                  <th className="text-left px-3 py-2 font-body">Service</th>
                  <th className="text-right px-3 py-2 font-body">Amount</th>
                  <th className="text-left px-3 py-2 font-body">Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.booking_id} className="border-b border-border">
                    <td className="px-3 py-1.5">{b.date}</td>
                    <td className="px-3 py-1.5">{b.branch_name}</td>
                    <td className="px-3 py-1.5">{b.service_name}</td>
                    <td className="px-3 py-1.5 text-right">{formatNPR(b.final_amount)}</td>
                    <td className="px-3 py-1.5">{b.payment_status}</td>
                  </tr>
                ))}
                {bookings.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center font-body text-text-secondary">No bookings in range.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
};

export default PlatformOrgDetail;
