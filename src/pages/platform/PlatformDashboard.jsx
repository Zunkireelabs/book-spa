import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CustomSelect from 'components/ui/CustomSelect';
import PlatformNav from './components/PlatformNav';
import { getRevenueRollup, formatNPR } from 'services/platformApi';
import { PERIOD_PRESETS, getPeriodRange } from 'utils/periodPresets';

const PlatformDashboard = () => {
  const navigate = useNavigate();
  const [preset, setPreset] = useState('monthly');
  const range = useMemo(() => getPeriodRange(preset), [preset]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    getRevenueRollup(range.startDate, range.endDate)
      .then((data) => { if (alive) setRows(data || []); })
      .catch((e) => { if (alive) setError(e.message || 'Failed to load'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [range.startDate, range.endDate]);

  const money = (v) => (v == null ? '—' : formatNPR(v));
  const pct = (v) => (v == null ? 'Not configured' : `${Number(v)}%`);

  return (
    <div className="min-h-screen bg-background">
      <PlatformNav />
      <main className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-heading-semibold text-xl text-text-primary">Revenue & Commission</h2>
          <div className="w-48">
            <CustomSelect value={preset} onChange={setPreset}
              options={PERIOD_PRESETS.map((p) => ({ value: p.id, label: p.label }))} />
          </div>
        </div>
        <p className="font-body text-sm text-text-secondary">{range.startDate} → {range.endDate}</p>

        {error && <p className="font-body text-sm text-error">{error}</p>}
        {loading ? (
          <p className="font-body text-sm text-text-secondary">Loading…</p>
        ) : (
          <div className="overflow-x-auto bg-surface rounded-spa-lg shadow-spa-resting">
            <table className="w-full text-sm font-data">
              <thead className="text-text-secondary border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2 font-body">Client</th>
                  <th className="text-right px-4 py-2 font-body">Sales (range)</th>
                  <th className="text-right px-4 py-2 font-body">Rate</th>
                  <th className="text-right px-4 py-2 font-body">Commission (range)</th>
                  <th className="text-right px-4 py-2 font-body">Owed to date</th>
                  <th className="text-right px-4 py-2 font-body">Collected</th>
                  <th className="text-right px-4 py-2 font-body">Net owed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.org_id}
                    onClick={() => navigate(`/platform/dashboard/${r.org_id}`)}
                    className="border-b border-border hover:bg-background cursor-pointer">
                    <td className="px-4 py-2 font-body text-text-primary">{r.org_name}</td>
                    <td className="px-4 py-2 text-right">{money(r.gross_total)}</td>
                    <td className="px-4 py-2 text-right">{pct(r.active_rate_percent)}</td>
                    <td className="px-4 py-2 text-right">{money(r.commission_for_range)}</td>
                    <td className="px-4 py-2 text-right">{money(r.commission_owed_to_date)}</td>
                    <td className="px-4 py-2 text-right">{money(r.collected_to_date)}</td>
                    <td className="px-4 py-2 text-right">{money(r.net_owed)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center font-body text-text-secondary">No orgs.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
};

export default PlatformDashboard;
