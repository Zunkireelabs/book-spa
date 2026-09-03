import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import {
  fetchStaffCompensation,
  setStaffCompensation,
  getPayrollRun,
  generatePayroll,
  finalizePayroll,
} from '../../../../services/api';

// Display-only mirror of services/api.js's SICK_LEAVE_PAID_CAP_DAYS/ANNUAL_LEAVE_PAID_CAP_DAYS
// (the actual deduction is computed server-side) — keep these two numbers in sync if the policy
// changes.
const SICK_LEAVE_CAP = 14;
const ANNUAL_LEAVE_CAP = 18;

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

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

// ── Compensation sub-panel ────────────────────────────────────────────────────

const CompensationPanel = ({ branchId }) => {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // therapistId
  const [editSalary, setEditSalary] = useState('');
  const [editRate, setEditRate] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await fetchStaffCompensation(branchId);
    if (err) {
      setError(err.message || 'Failed to load staff compensation.');
    } else {
      setStaff(data || []);
    }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (s) => {
    setEditing(s.therapistId);
    setEditSalary(String(s.monthlySalary));
    setEditRate(String(s.commissionRate));
  };

  const cancelEdit = () => { setEditing(null); };

  const saveEdit = async (therapistId) => {
    const salary = Number(editSalary);
    const rate = Number(editRate);
    if (!(salary >= 0)) { setError('Salary must be zero or more.'); return; }
    if (!(rate >= 0) || rate > 100) { setError('Commission rate must be 0–100.'); return; }
    setSaving(true);
    setError(null);
    const { error: err } = await setStaffCompensation({ therapistId, monthlySalary: salary, commissionRate: rate });
    setSaving(false);
    if (err) { setError(err.message || 'Failed to save.'); return; }
    setEditing(null);
    await load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-heading font-heading-semibold text-base text-text-primary">Staff Compensation</h4>
        <p className="font-body text-sm text-text-secondary">Set each staff member's monthly base salary and service commission rate.</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-surface border border-border rounded-spa overflow-hidden">
        {loading ? (
          <div className="py-12 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
            <p className="font-body text-sm text-text-secondary">Loading staff…</p>
          </div>
        ) : staff.length === 0 ? (
          <div className="py-12 text-center">
            <Icon name="Users" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body text-sm text-text-secondary">No active staff found for this branch.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-background border-b border-border">
                  <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Staff Member</th>
                  <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Position</th>
                  <th className="text-right px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Monthly Salary</th>
                  <th className="text-right px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Commission %</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.therapistId} className="border-b border-border last:border-b-0 hover:bg-background/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Icon name="User" size={14} className="text-primary" />
                        </div>
                        <span className="font-body font-body-medium text-sm text-text-primary">{s.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-body text-xs text-text-secondary px-2 py-0.5 rounded-full bg-background border border-border">
                        {s.position || '—'}
                      </span>
                    </td>
                    {editing === s.therapistId ? (
                      <>
                        <td className="px-4 py-2 text-right">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            autoFocus
                            value={editSalary}
                            onChange={(e) => setEditSalary(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(s.therapistId); if (e.key === 'Escape') cancelEdit(); }}
                            placeholder="0"
                            className="w-32 rounded-spa border border-primary bg-surface px-2 py-1.5 font-data text-sm text-text-primary text-right focus:outline-none focus:ring-2 focus:ring-primary/50"
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={editRate}
                            onChange={(e) => setEditRate(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(s.therapistId); if (e.key === 'Escape') cancelEdit(); }}
                            placeholder="0"
                            className="w-24 rounded-spa border border-primary bg-surface px-2 py-1.5 font-data text-sm text-text-primary text-right focus:outline-none focus:ring-2 focus:ring-primary/50"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5 justify-end">
                            <button
                              onClick={() => saveEdit(s.therapistId)}
                              disabled={saving}
                              className="px-2.5 py-1 rounded-spa bg-primary text-white text-xs font-body-medium disabled:opacity-50"
                            >
                              {saving ? '…' : 'Save'}
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="p-1 rounded-spa hover:bg-background text-text-secondary"
                            >
                              <Icon name="X" size={14} />
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-right font-data text-sm text-text-primary">
                          {formatNPR(s.monthlySalary)}
                        </td>
                        <td className="px-4 py-3 text-right font-data text-sm text-text-primary">
                          {s.commissionRate}%
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button
                            onClick={() => startEdit(s)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-spa border border-border bg-surface text-xs font-body-medium text-primary hover:bg-background spa-transition-fast"
                          >
                            <Icon name="Pencil" size={13} />
                            Edit
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Run Payroll sub-panel ─────────────────────────────────────────────────────

const RunPayrollPanel = ({ branchId }) => {
  const [selectedMonth, setSelectedMonth] = useState(MONTH_OPTIONS[1]?.value || MONTH_OPTIONS[0]?.value);
  const [runData, setRunData] = useState(null); // { run, items }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [showFinalizeConfirm, setShowFinalizeConfirm] = useState(false);

  const loadRun = useCallback(async (month) => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await getPayrollRun({ branchId, periodMonth: month });
    if (err) {
      setError(err.message || 'Failed to load payroll run.');
    } else {
      setRunData(data);
    }
    setLoading(false);
  }, [branchId]);

  useEffect(() => {
    if (selectedMonth) loadRun(selectedMonth);
  }, [loadRun, selectedMonth]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    const { data, error: err } = await generatePayroll({ branchId, periodMonth: selectedMonth });
    setGenerating(false);
    if (err) {
      setError(err.message || 'Failed to generate payroll.');
    } else {
      setRunData(data);
    }
  };

  const handleFinalize = async () => {
    setShowFinalizeConfirm(false);
    setFinalizing(true);
    setError(null);
    const { error: err } = await finalizePayroll({ runId: runData.run.id });
    setFinalizing(false);
    if (err) {
      setError(err.message || 'Failed to finalize payroll.');
    } else {
      await loadRun(selectedMonth);
    }
  };

  const handleExportCSV = () => {
    if (!runData?.items?.length) return;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = [
      'Staff', 'Month', 'Salary', 'Days In Month',
      'Present', 'Absent', 'Half Days', 'Leave', 'Unpaid Leave (over cap)',
      'Attendance Deduction', 'Service Revenue', 'Service Commission',
      'Referral Commission', 'Net Pay',
    ];
    let csv = header.join(',') + '\n';
    const month = formatMonth(runData.run.periodMonth);
    runData.items.forEach((i) => {
      csv += [
        esc(i.therapistName), esc(month),
        esc(i.monthlySalary), esc(i.daysInMonth),
        esc(i.presentDays), esc(i.absentDays), esc(i.halfDays), esc(i.leaveDays), esc(i.unpaidLeaveDays),
        esc(i.attendanceDeduction), esc(i.serviceRevenue), esc(i.serviceCommission),
        esc(i.referralCommission), esc(i.netPay),
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

  return (
    <div className="space-y-4">
      {/* Header row: month picker + actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h4 className="font-heading font-heading-semibold text-base text-text-primary">Run Payroll</h4>
          <p className="font-body text-sm text-text-secondary">Generate a monthly payslip summary for all active staff.</p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-52">
          <CustomSelect
            options={MONTH_OPTIONS}
            value={selectedMonth}
            onChange={setSelectedMonth}
            size="sm"
          />
        </div>

        {!isFinalized && (
          <button
            onClick={handleGenerate}
            disabled={generating || loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-spa bg-primary text-white text-sm font-body-medium disabled:opacity-50"
          >
            <Icon name={generating ? 'Loader' : hasDraftRun ? 'RefreshCw' : 'Play'} size={15} className={generating ? 'animate-spin' : ''} />
            {generating ? 'Generating…' : hasDraftRun ? 'Regenerate' : 'Generate'}
          </button>
        )}

        {hasDraftRun && !isFinalized && (
          <button
            onClick={() => setShowFinalizeConfirm(true)}
            disabled={finalizing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-spa border border-primary/40 bg-primary/5 text-primary text-sm font-body-medium hover:bg-primary/10 disabled:opacity-50"
          >
            <Icon name="Lock" size={15} />
            Finalize
          </button>
        )}

        {items.length > 0 && (
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-spa border border-border bg-surface text-sm font-body-medium text-text-secondary hover:bg-background spa-transition-fast"
          >
            <Icon name="Download" size={15} />
            Export CSV
          </button>
        )}

        {isFinalized && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success/10 text-success text-xs font-body-medium border border-success/20">
            <Icon name="CheckCircle" size={13} />
            Finalized {runData.run.finalizedAt ? new Date(runData.run.finalizedAt).toLocaleDateString('en-GB') : ''}
          </span>
        )}
      </div>

      {/* Finalize confirmation */}
      {showFinalizeConfirm && (
        <div className="flex items-start gap-3 p-4 bg-warning/10 border border-warning/30 rounded-spa">
          <Icon name="AlertTriangle" size={18} className="text-warning flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-body font-body-medium text-sm text-text-primary">
              Finalize payroll for {formatMonth(selectedMonth)}?
            </p>
            <p className="font-body text-xs text-text-secondary mt-0.5">
              Once finalized this run is permanently locked and cannot be regenerated or edited.
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleFinalize}
                className="px-3 py-1.5 rounded-spa bg-warning text-white text-sm font-body-medium"
              >
                Yes, finalize
              </button>
              <button
                onClick={() => setShowFinalizeConfirm(false)}
                className="px-3 py-1.5 rounded-spa border border-border text-sm font-body-medium text-text-secondary hover:bg-background"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Payroll table */}
      <div className="bg-surface border border-border rounded-spa overflow-hidden">
        {loading ? (
          <div className="py-12 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
            <p className="font-body text-sm text-text-secondary">Loading…</p>
          </div>
        ) : !runData ? (
          <div className="py-12 text-center">
            <Icon name="FileText" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body text-sm text-text-secondary">No payroll run for this month yet.</p>
            <p className="font-body text-xs text-text-tertiary mt-1">Select a month and click Generate.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-background border-b border-border">
                  <th className="text-left px-4 py-3 font-body font-body-medium text-text-secondary whitespace-nowrap">Staff</th>
                  <th className="text-right px-3 py-3 font-body font-body-medium text-text-secondary whitespace-nowrap">Base Salary</th>
                  <th className="text-right px-3 py-3 font-body font-body-medium text-text-secondary whitespace-nowrap">
                    <span title="Present / Absent / Half / Leave (Sick + Annual + Day Off)">P/A/H/L</span>
                  </th>
                  <th className="text-right px-3 py-3 font-body font-body-medium text-text-secondary whitespace-nowrap">Deduction</th>
                  <th className="text-right px-3 py-3 font-body font-body-medium text-text-secondary whitespace-nowrap">Svc Revenue</th>
                  <th className="text-right px-3 py-3 font-body font-body-medium text-text-secondary whitespace-nowrap">Svc Commission</th>
                  <th className="text-right px-3 py-3 font-body font-body-medium text-text-secondary whitespace-nowrap">Ref Commission</th>
                  <th className="text-right px-4 py-3 font-body font-body-medium text-text-secondary whitespace-nowrap">Net Pay</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.therapistId} className="border-b border-border last:border-b-0 hover:bg-background/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Icon name="User" size={12} className="text-primary" />
                        </div>
                        <span className="font-body font-body-medium text-text-primary">{item.therapistName}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-data text-text-primary whitespace-nowrap">
                      {formatNPR(item.monthlySalary)}
                    </td>
                    <td className="px-3 py-3 text-right font-data text-text-secondary whitespace-nowrap">
                      {item.presentDays}/{item.absentDays}/{item.halfDays}/{item.leaveDays}
                      {item.unpaidLeaveDays > 0 && (
                        <span
                          className="ml-1 text-[11px] text-error font-body font-body-medium"
                          title={`${item.unpaidLeaveDays} leave day(s) beyond the paid cap (${SICK_LEAVE_CAP} sick / ${ANNUAL_LEAVE_CAP} annual per year) — deducted like Absent`}
                        >
                          ({item.unpaidLeaveDays} unpaid)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-data text-error whitespace-nowrap">
                      {item.attendanceDeduction > 0 ? `−${formatNPR(item.attendanceDeduction)}` : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-data text-text-secondary whitespace-nowrap">
                      {item.serviceRevenue > 0 ? formatNPR(item.serviceRevenue) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-data text-success whitespace-nowrap">
                      {item.serviceCommission > 0 ? `+${formatNPR(item.serviceCommission)}` : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-data text-success whitespace-nowrap">
                      {item.referralCommission > 0 ? `+${formatNPR(item.referralCommission)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-data font-data-semibold text-text-primary whitespace-nowrap">
                      {formatNPR(item.netPay)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-background border-t-2 border-border">
                  <td className="px-4 py-3 font-body font-body-semibold text-text-primary" colSpan={7}>
                    Total payout — {formatMonth(selectedMonth)}
                  </td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-lg text-primary whitespace-nowrap">
                    {formatNPR(runData.run.totalNet)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {runData && (
        <p className="font-body text-xs text-text-tertiary">
          {isFinalized
            ? `Finalized on ${new Date(runData.run.finalizedAt).toLocaleDateString('en-GB')}.`
            : `Draft — generated ${new Date(runData.run.generatedAt).toLocaleDateString('en-GB')}. You can regenerate until finalized.`}
          {' '}Attendance deduction = salary ÷ {runData.items[0]?.daysInMonth ?? '—'} days × (absent + 0.5 × half-days + unpaid leave days).
          Day Off and the first {SICK_LEAVE_CAP} Sick / {ANNUAL_LEAVE_CAP} Annual Leave days per calendar year are paid; leave beyond those caps is deducted like Absent.
        </p>
      )}
    </div>
  );
};

// ── Main panel ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'compensation', label: 'Compensation', icon: 'Settings' },
  { id: 'run', label: 'Run Payroll', icon: 'Banknote' },
];

const PayrollPanel = ({ branchId, isOverall }) => {
  const [activeTab, setActiveTab] = useState('compensation');

  if (isOverall) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Icon name="Wallet" size={40} className="text-text-tertiary mb-4" />
        <h3 className="font-heading font-heading-semibold text-lg text-text-primary mb-1">Select a specific branch</h3>
        <p className="font-body text-sm text-text-secondary max-w-sm">
          Payroll is branch-specific. Use the branch switcher in the header to select a branch before running payroll.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading font-heading-semibold text-xl text-text-primary flex items-center gap-2">
            <Icon name="Wallet" size={22} className="text-primary" />
            Payroll
          </h3>
          <p className="font-body text-sm text-text-secondary mt-0.5">
            Manage staff compensation and run monthly payroll.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-background border border-border rounded-spa w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-body-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-surface text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <Icon name={tab.icon} size={15} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'compensation' && <CompensationPanel branchId={branchId} />}
      {activeTab === 'run' && <RunPayrollPanel branchId={branchId} />}
    </div>
  );
};

export default PayrollPanel;
