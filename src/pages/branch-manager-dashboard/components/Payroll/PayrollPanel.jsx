import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import { PanelShell, FormBody } from '../../../../components/ui/PanelFormKit';
import { useBranch } from '../../../../contexts/BranchContext';
import {
  fetchStaffCompensation,
  setStaffCompensation,
  getPayrollRun,
  fetchPayrollBranchSplit,
  generatePayroll,
  finalizePayroll,
  fetchTherapistProductSales,
} from '../../../../services/api';
import { Avatar, thClass, ErrorBlock, EmptyBlock, shortDate } from '../Area/listKit';
import { teamMemberLower, teamMemberWord, wordBranch } from '../../../../utils/industryTerms';

// Display-only mirror of services/api.js's SICK_LEAVE_PAID_CAP_DAYS/ANNUAL_LEAVE_PAID_CAP_DAYS
// (the actual deduction is computed server-side) — keep these two numbers in sync if the policy
// changes.
const SICK_LEAVE_CAP = 14;
const ANNUAL_LEAVE_CAP = 18;

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const formatNPR = (amount) => `NPR ${fmt(amount)}`;

function formatMonth(isoDate) {
  if (!isoDate) return '—';
  const [y, m] = isoDate.split('-');
  return new Date(y, Number(m) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

// Build last-12-month options for the month picker.
function buildMonthOptions() {
  const options = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    options.push({ value, label });
  }
  return options;
}

const MONTH_OPTIONS = buildMonthOptions();
const NEW_TAG = <span className="ml-1.5 text-[9.5px] font-semibold tracking-[.04em] text-primary bg-[#EEF3EC] rounded px-1 py-px align-middle">NEW</span>;
const th = thClass(false);
const rateInput = 'w-[72px] h-8 rounded-md border border-border bg-white px-2 text-right text-[13px] tabular-nums focus:outline-none focus:border-[#B9C7B6] focus:ring-[3px] focus:ring-primary/10';

// ── Pay rates ────────────────────────────────────────────────────────────────────────────────

const CompensationPanel = ({ branchId, readOnly = false }) => {
  const [staff, setStaff] = useState(null);
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [editing, setEditing] = useState(null); // therapistId
  const [editSalary, setEditSalary] = useState('');
  const [editRate, setEditRate] = useState('');
  const [editProductRate, setEditProductRate] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    const { data, error: err } = await fetchStaffCompensation(branchId);
    if (err) { setLoadError(err.message || 'Failed to load staff compensation.'); setStaff([]); return; }
    setStaff(data || []);
  }, [branchId]);
  useEffect(() => { setStaff(null); load(); }, [load]);

  const startEdit = (s) => {
    setEditing(s.therapistId);
    setEditSalary(String(s.monthlySalary));
    setEditRate(String(s.commissionRate));
    setEditProductRate(String(s.productCommissionRate ?? 0));
    setError(null);
  };
  const cancelEdit = () => setEditing(null);
  const saveEdit = async (therapistId) => {
    const salary = Number(editSalary);
    const rate = Number(editRate);
    const productRate = Number(editProductRate);
    if (!(salary >= 0)) { setError('Salary must be zero or more.'); return; }
    if (!(rate >= 0) || rate > 100) { setError('Treatment commission must be 0–100.'); return; }
    if (!(productRate >= 0) || productRate > 100) { setError('Product commission must be 0–100.'); return; }
    setSaving(true);
    setError(null);
    const { error: err } = await setStaffCompensation({ therapistId, monthlySalary: salary, commissionRate: rate, productCommissionRate: productRate });
    setSaving(false);
    if (err) { setError(err.message || 'Failed to save.'); return; }
    setEditing(null);
    await load();
  };
  const onKey = (id) => (e) => { if (e.key === 'Enter') saveEdit(id); if (e.key === 'Escape') cancelEdit(); };

  return (
    <div data-pay-rates>
      {error && <p role="alert" className="mt-3 text-[13px] text-error flex items-center gap-2"><Icon name="AlertCircle" size={14} />{error}</p>}
      {loadError ? <ErrorBlock error={loadError} onRetry={load} /> : (
        <table className="w-full border-collapse mt-3">
          <thead>
            <tr>
              <th scope="col" className={`${th} text-left pl-2`}>{teamMemberWord()}</th>
              <th scope="col" className={`${th} text-right pr-3`}>Monthly salary</th>
              <th scope="col" className={`${th} text-right pr-3`}>Treatment commission</th>
              <th scope="col" className={`${th} text-right pr-3`}>Product commission{NEW_TAG}</th>
              <th scope="col" className={th}><span className="sr-only">Edit</span></th>
            </tr>
          </thead>
          <tbody>
            {staff === null && Array.from({ length: 4 }).map((_, i) => <tr key={i}><td colSpan={5} className="h-[52px] border-b border-[#F1F1EF]"><div className="h-7 rounded bg-[#F1F1EF] animate-pulse" /></td></tr>)}
            {(staff || []).map((s) => {
              const on = editing === s.therapistId;
              return (
                <tr key={s.therapistId} data-therapist={s.therapistId} className={on ? 'bg-[#F7F9F6]' : 'hover:bg-[#FAFAF9]'}>
                  <td className="h-[52px] border-b border-[#F1F1EF] pl-2 pr-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={s.name} size={28} />
                      <div className="min-w-0">
                        <div className="text-[13.5px] font-medium text-text-primary truncate">{s.name}</div>
                        {s.position && <div className="text-[12px] text-[#8A8A90] truncate">{s.position}</div>}
                      </div>
                    </div>
                  </td>
                  {on ? (
                    <>
                      <td className="h-[52px] border-b border-[#F1F1EF] pr-3 text-right"><input type="number" min="0" step="1" autoFocus aria-label={`${s.name} monthly salary`} value={editSalary} onChange={(e) => setEditSalary(e.target.value)} onKeyDown={onKey(s.therapistId)} className={`${rateInput} w-28`} /></td>
                      <td className="h-[52px] border-b border-[#F1F1EF] pr-3 text-right"><input type="number" min="0" max="100" step="0.1" aria-label={`${s.name} treatment commission %`} value={editRate} onChange={(e) => setEditRate(e.target.value)} onKeyDown={onKey(s.therapistId)} className={rateInput} /></td>
                      <td className="h-[52px] border-b border-[#F1F1EF] pr-3 text-right"><input type="number" min="0" max="100" step="0.1" aria-label={`${s.name} product commission %`} value={editProductRate} onChange={(e) => setEditProductRate(e.target.value)} onKeyDown={onKey(s.therapistId)} className={rateInput} data-product-rate-input /></td>
                      <td className="h-[52px] border-b border-[#F1F1EF] pr-1">
                        <div className="flex items-center gap-1.5 justify-end">
                          <button type="button" onClick={() => saveEdit(s.therapistId)} disabled={saving} className="h-8 px-3 rounded-md bg-primary text-white text-[13px] font-medium disabled:opacity-50" data-save-rate>{saving ? '…' : 'Save'}</button>
                          <button type="button" onClick={cancelEdit} aria-label="Cancel" className="w-8 h-8 grid place-items-center rounded-md text-[#8A8A90] hover:bg-[#F1F1EF]"><Icon name="X" size={14} /></button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="h-[52px] border-b border-[#F1F1EF] pr-3 text-right text-[13px] tabular-nums">{fmt(s.monthlySalary)}</td>
                      <td className="h-[52px] border-b border-[#F1F1EF] pr-3 text-right text-[13px] tabular-nums">{s.commissionRate}%</td>
                      <td className="h-[52px] border-b border-[#F1F1EF] pr-3 text-right text-[13px] tabular-nums bg-[#F7F9F6]" data-product-rate>{s.productCommissionRate ?? 0}%</td>
                      <td className="h-[52px] border-b border-[#F1F1EF] pr-1 text-right">
                        {!readOnly && <button type="button" onClick={() => startEdit(s)} className="h-8 px-3 rounded-md border border-border bg-white text-[13px] font-medium text-text-primary hover:bg-[#FAFAF9] inline-flex items-center gap-1.5"><Icon name="Pencil" size={13} />Edit</button>}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {staff && staff.length === 0 && !loadError && <EmptyBlock icon="Users" title={`No active ${teamMemberLower()}s`} hint="Add people under Team first." />}
      <p className="mt-4 text-[12.5px] text-[#515152] bg-[#F7F7F5] rounded-lg px-3 py-2.5 max-w-[640px] flex gap-2"><Icon name="Info" size={14} className="mt-0.5 flex-none text-[#8A8A90]" /><span>Product commission is a share of what the {teamMemberLower()} <b className="font-medium">sold</b>, after refunds, for products marked <b className="font-medium">Earns commission</b>. It is separate from treatment commission, which stays as it is today.</span></p>
    </div>
  );
};

// ── Drill-down: the product sales behind one person's numbers ────────────────────────────────────

const ProductSalesDrill = ({ item, branchId, periodMonth, onClose }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    fetchTherapistProductSales({ branchId, therapistId: item.therapistId, periodMonth }).then(({ data: d, error: err }) => {
      if (!live) return;
      if (err) setError(err.message || 'Could not load the sales.'); else setData(d);
    });
    return () => { live = false; };
  }, [item.therapistId, branchId, periodMonth]);
  const credited = data?.credited || [];
  const earlier = data?.earlierRefunds || [];
  const row = (s, note) => (
    <li key={s.id} className="flex items-center gap-3 px-3.5 py-2.5 text-[13px] tabular-nums">
      <div className="min-w-0 flex-1">
        <p className={`truncate ${s.refundedAt ? 'line-through text-[#8A8A90]' : 'text-text-primary font-medium'}`}>{s.name} × {s.quantity}</p>
        <p className="text-[12px] text-[#8A8A90]">{shortDate(s.createdAt, periodMonth)}{s.refundedAt ? ' · refunded' : ''}{!s.earns ? ' · does not earn commission' : ''}{note ? ` · ${note}` : ''}</p>
      </div>
      <span className={s.refundedAt ? 'text-[#8A8A90]' : 'font-medium'}>{fmt(s.amount)}</span>
    </li>
  );
  return (
    <PanelShell variant="panel" title={`${item.therapistName} · products`} onClose={onClose} hideFooter>
      <FormBody>
        {error && <p role="alert" className="text-[13px] text-error">{error}</p>}
        {!data && !error && <div className="h-24 rounded-lg bg-[#F1F1EF] animate-pulse" />}
        {data && (
          <>
            <dl className="border border-border rounded-[10px] divide-y divide-[#F1F1EF] text-[13px] tabular-nums" data-drill-summary>
              <div className="flex justify-between px-3.5 py-2.5"><dt className="text-[#515152]">Products sold, after refunds</dt><dd className="font-medium">{formatNPR(item.productRevenue)}</dd></div>
              <div className="flex justify-between px-3.5 py-2.5"><dt className="text-[#515152]">Rate</dt><dd className="font-medium">{item.productCommissionRate}%</dd></div>
              <div className="flex justify-between px-3.5 py-2.5"><dt className="text-[#515152]">Commission earned</dt><dd className="font-medium">{formatNPR(item.productCommission)}</dd></div>
              {item.productCommissionDeduction > 0 && <div className="flex justify-between px-3.5 py-2.5"><dt className="text-[#515152]">Refunds of earlier months</dt><dd className="font-medium text-error">−{formatNPR(item.productCommissionDeduction)}</dd></div>}
            </dl>
            <div>
              <p className="text-[11.5px] text-[#8A8A90] font-medium uppercase tracking-[.05em] mb-2">Credited in {formatMonth(`${periodMonth}-01`)}</p>
              {credited.length === 0 ? <p className="text-[13px] text-[#8A8A90]">No product sales credited this month.</p> : <ul className="border border-border rounded-[10px] divide-y divide-[#F1F1EF]" data-drill-credited>{credited.map((s) => row(s))}</ul>}
            </div>
            {earlier.length > 0 && (
              <div>
                <p className="text-[11.5px] text-[#8A8A90] font-medium uppercase tracking-[.05em] mb-2">Refunds of earlier months</p>
                <ul className="border border-border rounded-[10px] divide-y divide-[#F1F1EF]" data-drill-earlier>{earlier.map((s) => row(s, 'taken off this run if it was already paid'))}</ul>
              </div>
            )}
          </>
        )}
      </FormBody>
    </PanelShell>
  );
};

// ── Pay runs ─────────────────────────────────────────────────────────────────────────────────

const RunPayrollPanel = ({ branchId, readOnly = false }) => {
  const [selectedMonth, setSelectedMonth] = useState(MONTH_OPTIONS[1]?.value || MONTH_OPTIONS[0]?.value);
  const [runData, setRunData] = useState(null); // { run, items }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [showFinalizeConfirm, setShowFinalizeConfirm] = useState(false);
  const [drill, setDrill] = useState(null); // an item
  const [split, setSplit] = useState(null); // { byTherapist, visitorLine }

  const loadRun = useCallback(async (month) => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await getPayrollRun({ branchId, periodMonth: month });
    if (err) setError(err.message || 'Failed to load payroll run.'); else setRunData(data);
    const sp = await fetchPayrollBranchSplit({ branchId, periodMonth: month });
    setSplit(sp.data || null);
    setLoading(false);
  }, [branchId]);
  useEffect(() => { if (selectedMonth) loadRun(selectedMonth); }, [loadRun, selectedMonth]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    const { data, error: err } = await generatePayroll({ branchId, periodMonth: selectedMonth });
    setGenerating(false);
    if (err) setError(err.message || 'Failed to generate payroll.'); else setRunData(data);
  };
  const handleFinalize = async () => {
    setShowFinalizeConfirm(false);
    setFinalizing(true);
    setError(null);
    const { error: err } = await finalizePayroll({ runId: runData.run.id });
    setFinalizing(false);
    if (err) setError(err.message || 'Failed to finalize payroll.'); else await loadRun(selectedMonth);
  };

  const handleExportCSV = () => {
    if (!runData?.items?.length) return;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = [
      'Staff', 'Month', 'Salary', 'Days In Month',
      'Present', 'Absent', 'Half Days', 'Leave', 'Unpaid Leave (over cap)',
      'Attendance Deduction', 'Service Revenue', 'Service Commission',
      'Referral Commission', 'Products Sold', 'Product Commission %', 'Product Commission', 'Product Refund Deduction', 'Net Pay',
    ];
    let csv = header.join(',') + '\n';
    const month = formatMonth(runData.run.periodMonth);
    runData.items.forEach((i) => {
      csv += [
        esc(i.therapistName), esc(month),
        esc(i.monthlySalary), esc(i.daysInMonth),
        esc(i.presentDays), esc(i.absentDays), esc(i.halfDays), esc(i.leaveDays), esc(i.unpaidLeaveDays),
        esc(i.attendanceDeduction), esc(i.serviceRevenue), esc(i.serviceCommission),
        esc(i.referralCommission), esc(i.productRevenue), esc(i.productCommissionRate), esc(i.productCommission), esc(i.productCommissionDeduction), esc(i.netPay),
      ].join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `payroll-${selectedMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const isFinalized = runData?.run?.status === 'finalized';
  const hasDraftRun = runData?.run?.status === 'draft';
  const items = runData?.items || [];
  const num = 'px-3 text-right text-[13px] tabular-nums whitespace-nowrap border-b border-[#F1F1EF] h-[52px]';
  const drillBtn = (item, children) => (
    <button type="button" onClick={() => setDrill(item)} className="underline decoration-dotted underline-offset-[3px] hover:text-primary" aria-label={`Show ${item.therapistName}'s product sales`} data-drill>{children}</button>
  );

  return (
    <div data-pay-runs>
      <div className="flex items-center gap-3 flex-wrap mt-4">
        <div className="w-52"><CustomSelect options={MONTH_OPTIONS} value={selectedMonth} onChange={setSelectedMonth} size="sm" /></div>
        {!readOnly && !isFinalized && (
          <button type="button" onClick={handleGenerate} disabled={generating || loading}
            className="h-8 px-3 rounded-md bg-primary text-white text-[13px] font-medium inline-flex items-center gap-1.5 disabled:opacity-50" data-generate>
            <Icon name={generating ? 'Loader' : hasDraftRun ? 'RefreshCw' : 'Play'} size={14} className={generating ? 'animate-spin' : ''} />
            {generating ? 'Generating…' : hasDraftRun ? 'Regenerate' : 'Generate'}
          </button>
        )}
        {!readOnly && hasDraftRun && !isFinalized && (
          <button type="button" onClick={() => setShowFinalizeConfirm(true)} disabled={finalizing}
            className="h-8 px-3 rounded-md border border-[#CFDCCC] bg-[#F7F9F6] text-primary text-[13px] font-medium inline-flex items-center gap-1.5 hover:bg-[#EEF3EC] disabled:opacity-50" data-finalize>
            <Icon name="Lock" size={14} />Finalize
          </button>
        )}
        {items.length > 0 && (
          <button type="button" onClick={handleExportCSV} className="h-8 px-3 rounded-md border border-border bg-white text-[13px] font-medium inline-flex items-center gap-1.5 hover:bg-[#FAFAF9]"><Icon name="Download" size={14} />Export CSV</button>
        )}
        {isFinalized && (
          <span className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-full bg-[#EEF3EC] text-primary text-[12px] font-medium"><Icon name="CheckCircle" size={13} />Finalized {runData.run.finalizedAt ? new Date(runData.run.finalizedAt).toLocaleDateString('en-GB') : ''}</span>
        )}
      </div>

      {showFinalizeConfirm && (
        <div className="mt-3 flex items-start gap-3 p-4 bg-[#FEF7E8] border border-[#F3E2B8] rounded-[10px]">
          <Icon name="AlertTriangle" size={18} className="text-[#B45309] flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[13px] font-medium text-text-primary">Finalize payroll for {formatMonth(`${selectedMonth}-01`)}?</p>
            <p className="text-xs text-[#515152] mt-0.5">Once finalized this run is permanently locked and cannot be regenerated or edited. A product refund after this point is taken off the next run.</p>
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={handleFinalize} className="h-8 px-3 rounded-md bg-[#B45309] text-white text-[13px] font-medium" data-confirm-finalize>Yes, finalize</button>
              <button type="button" onClick={() => setShowFinalizeConfirm(false)} className="h-8 px-3 rounded-md border border-border text-[13px] font-medium text-[#515152] hover:bg-[#FAFAF9]">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {error && <ErrorBlock error={error} onRetry={() => loadRun(selectedMonth)} />}

      {loading ? (
        <div className="mt-4 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-[52px] rounded bg-[#F1F1EF] animate-pulse" />)}</div>
      ) : !runData ? (
        <EmptyBlock icon="FileText" title="No pay run for this month yet" hint={readOnly ? '' : 'Pick a month and press Generate.'} />
      ) : (
        <div className="overflow-x-auto mt-3">
          {split?.visitorLine && <p className="text-[12px] text-[#8A8A90] mb-2">{split.visitorLine}</p>}
          <table className="w-full border-collapse min-w-[980px]">
            <thead>
              <tr>
                <th scope="col" className={`${th} text-left pl-2`}>{teamMemberWord()}</th>
                <th scope="col" className={`${th} text-right pr-3`}>Base salary</th>
                <th scope="col" className={`${th} text-right pr-3`} title="Present / Absent / Half / Leave">P/A/H/L</th>
                <th scope="col" className={`${th} text-right pr-3`}>Deduction</th>
                <th scope="col" className={`${th} text-right pr-3`}>Treatments</th>
                <th scope="col" className={`${th} text-right pr-3`}>Treatment commission</th>
                <th scope="col" className={`${th} text-right pr-3`}>Referral</th>
                <th scope="col" className={`${th} text-right pr-3`}>Products sold{NEW_TAG}</th>
                <th scope="col" className={`${th} text-right pr-3`}>Product commission{NEW_TAG}</th>
                <th scope="col" className={`${th} text-right pr-3`}>Net pay</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const net = round2(item.productCommission - item.productCommissionDeduction);
                return (
                  <tr key={item.therapistId} data-item={item.therapistId} className="hover:bg-[#FAFAF9]">
                    <td className="h-[52px] border-b border-[#F1F1EF] pl-2 pr-3">
                      <div className="flex items-center gap-3 min-w-0"><Avatar name={item.therapistName} size={28} /><span className="text-[13.5px] font-medium text-text-primary truncate">{item.therapistName}</span></div>
                    </td>
                    <td className={num}>{fmt(item.monthlySalary)}</td>
                    <td className={`${num} text-[#8A8A90]`}>
                      {item.presentDays}/{item.absentDays}/{item.halfDays}/{item.leaveDays}
                      {item.unpaidLeaveDays > 0 && <span className="ml-1 text-[11px] text-error font-medium" title={`${item.unpaidLeaveDays} leave day(s) beyond the paid cap (${SICK_LEAVE_CAP} sick / ${ANNUAL_LEAVE_CAP} annual per year), deducted like Absent`}>({item.unpaidLeaveDays} unpaid)</span>}
                    </td>
                    <td className={`${num} ${item.attendanceDeduction > 0 ? 'text-error' : 'text-[#B4B4BA]'}`}>{item.attendanceDeduction > 0 ? `−${fmt(item.attendanceDeduction)}` : '—'}</td>
                    <td className={`${num} text-[#515152]`}>
                      {item.serviceRevenue > 0 ? fmt(item.serviceRevenue) : '—'}
                      {split?.byTherapist?.[item.therapistId]?.lentTotal > 0 && (
                        <div className="text-[11px] text-[#8A8A90]">
                          At home {fmt(split.byTherapist[item.therapistId].atHome)}
                          {Object.values(split.byTherapist[item.therapistId].lent).map((l) => ` · at ${l.branchName} (lent) ${fmt(l.revenue)}`).join('')}
                        </div>
                      )}
                    </td>
                    <td className={num}>{item.serviceCommission > 0 ? fmt(item.serviceCommission) : '—'}</td>
                    <td className={num}>{item.referralCommission > 0 ? fmt(item.referralCommission) : '—'}</td>
                    <td className={`${num} bg-[#F7F9F6]`} data-products-sold>{item.productRevenue > 0 ? drillBtn(item, fmt(item.productRevenue)) : (item.productCommissionDeduction > 0 ? drillBtn(item, '—') : '—')}</td>
                    <td className={`${num} bg-[#F7F9F6]`} data-product-commission>
                      {item.productCommission > 0 || item.productCommissionDeduction > 0 ? drillBtn(item, fmt(net)) : '—'}
                      {item.productCommissionDeduction > 0 && <div className="text-[11px] text-error font-normal">−{fmt(item.productCommissionDeduction)} refund of an earlier month</div>}
                    </td>
                    <td className={`${num} font-semibold`}>{fmt(item.netPay)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="h-[52px] pl-2 text-[13px] font-semibold text-text-primary" colSpan={9}>Total payout, {formatMonth(`${selectedMonth}-01`)}</td>
                <td className="h-[52px] pr-3 text-right text-[15px] font-semibold text-primary tabular-nums whitespace-nowrap" data-total-net>{formatNPR(runData.run.totalNet)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {runData && (
        <p className="mt-3 text-[12.5px] text-[#515152] bg-[#F7F7F5] rounded-lg px-3 py-2.5 flex gap-2">
          <Icon name="Package" size={14} className="mt-0.5 flex-none text-[#8A8A90]" />
          <span>
            Products sold = product sales credited to that person in {formatMonth(`${selectedMonth}-01`)}, minus refunds. Click a number to see the sales behind it. A refund after the run is finalised shows as a deduction in the next run.{' '}
            {isFinalized ? `Finalized on ${new Date(runData.run.finalizedAt).toLocaleDateString('en-GB')}.` : `Draft, generated ${new Date(runData.run.generatedAt).toLocaleDateString('en-GB')}; you can regenerate until it is finalized.`}{' '}
            Attendance deduction = salary ÷ {runData.items[0]?.daysInMonth ?? '—'} days × (absent + 0.5 × half-days + unpaid leave days). Day Off and the first {SICK_LEAVE_CAP} Sick / {ANNUAL_LEAVE_CAP} Annual Leave days per calendar year are paid.
          </span>
        </p>
      )}
      {drill && <ProductSalesDrill item={drill} branchId={branchId} periodMonth={selectedMonth} onClose={() => setDrill(null)} />}
    </div>
  );
};

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// ── Main panel ───────────────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'compensation', label: 'Pay rates' },
  { id: 'run', label: 'Pay runs' },
];

// readOnly: view-only (admin_viewer) — hides rate editing and Generate/Finalize; Export CSV stays.
const PayrollPanel = ({ branchId, isOverall, readOnly = false }) => {
  const [activeTab, setActiveTab] = useState('compensation');
  const { branchName } = useBranch();

  if (isOverall) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Icon name="Wallet" size={40} className="text-text-tertiary mb-4" />
        <h3 className="font-heading font-heading-semibold text-lg text-text-primary mb-1">Select a specific {wordBranch()}</h3>
        <p className="font-body text-sm text-text-secondary max-w-sm">Payroll is {wordBranch()}-specific. Use the {wordBranch()} switcher in the header to select a {wordBranch()} before running payroll.</p>
      </div>
    );
  }

  return (
    <div className="pb-6">
      <h1 className="text-[20px] font-semibold tracking-[-0.45px] text-text-primary">Payroll</h1>
      <p className="text-[13px] text-[#8A8A90] mt-[3px]">{branchName ? `${branchName} · ` : ''}{readOnly ? 'monthly pay for your team (view only)' : 'monthly pay for your team'}</p>
      <div role="tablist" aria-label="Payroll" className="mt-[14px] flex items-center gap-[22px] border-b border-border">
        {TABS.map((t) => {
          const on = activeTab === t.id;
          return (
            <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => setActiveTab(t.id)}
              className={`h-[38px] text-[13px] font-medium relative whitespace-nowrap ${on ? 'text-text-primary' : 'text-[#515152] hover:text-text-primary'}`}>
              {t.label}{on && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-text-primary rounded" />}
            </button>
          );
        })}
      </div>
      {activeTab === 'compensation' && <CompensationPanel branchId={branchId} readOnly={readOnly} />}
      {activeTab === 'run' && <RunPayrollPanel branchId={branchId} readOnly={readOnly} />}
    </div>
  );
};

export default PayrollPanel;
