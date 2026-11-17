import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from 'components/AppIcon';
import PaymentModal from 'components/ui/PaymentModal';
import { submitCheckout } from 'services/checkoutSubmit';
import { useAuth } from 'contexts/AuthContext';
import { useBranch } from 'contexts/BranchContext';
import { useIndustry } from 'hooks/useIndustry';
import { downloadCsv } from 'utils/csvExport';
import { fetchMoneyOwed, fetchDueHolderNames, setDueHolder, recordPayment, recordTip, getCustomerOutstandingBalance, recordBundledAllocations } from 'services/api';
import { moneyOwedInsights, reminderText, reminderAllText } from 'lib/reportInsights';
import ReportFrame, { InsightList } from './ReportFrame';
import SettledDueHistoryPanel from '../Outstanding/SettledDueHistoryPanel';
import NeedsClosingSection from '../Outstanding/NeedsClosingSection';
import { isReportOpenable } from './reportRegistry';
import { num } from './businessHealthView';
import { buildOwedTiles, ageBars, isEmptyOwed, statusLabel, dayLabel, TABS, owedExportRows, responsibleOf, UNASSIGNED } from './moneyOwedView';

const DEFINITIONS = [
  { term: 'Owed', text: 'Completed bookings with payment not "paid" and balance = final amount − payments − refunds > 0, any date. Same rule as the dashboard (dashboardMoney.js + mig 368).' },
  { term: 'Packages', text: 'final amount − paid amount > 0.' },
  { term: 'Age', text: 'days since the booking date, Nepal time.' },
  { term: 'vs 30 days ago', text: "the same rule run as of that date (payments made after it don't count)." },
];

const PILL = { unpaid: 'bg-error/10 text-error', partial: 'bg-warning/10 text-warning', package: 'bg-blue-500/10 text-blue-600' };
const Pill = ({ kind }) => <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${PILL[kind] || 'bg-black/[0.05] text-text-secondary'}`}>{statusLabel(kind)}</span>;
const th = 'px-3.5 py-2 text-[11px] font-medium text-text-tertiary bg-background border-b border-border';
const td = 'px-2.5 py-2.5 border-b border-border text-[12.5px]';
const numTd = `${td} text-right font-data tabular-nums whitespace-nowrap`;
const Sm = ({ children }) => <span className="block text-[11px] text-text-tertiary font-normal">{children}</span>;
const ageText = (d) => (d === 0 ? 'today' : `${d} d ago`);

const copyText = async (text) => {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; } catch { return false; }
  }
};

const MoneyOwedReport = ({ reopen, onBack, onHome, onOpenView, titleExtra, isFavourite, onToggleFav }) => {
  const { profile } = useAuth();
  const { branchId, branches, isOverall, loading: branchLoading, switchBranch } = useBranch();
  const { staffLabel } = useIndustry();
  const [params, setParams] = useSearchParams();
  const onlyTherapist = params.get('therapist'); // set by a therapist's inner page: Needs closing shows only their bookings
  const showAllTherapists = () => { const next = new URLSearchParams(params); next.delete('therapist'); next.delete('tname'); setParams(next); };
  const role = profile?.role;
  const canCollect = ['manager', 'admin'].includes(role); // admin_viewer is read-only
  const canAssign = role !== 'admin_viewer'; // same as the old Outstanding page

  const ids = useMemo(() => (isOverall ? branches.map((b) => b.id) : [branchId]).filter(Boolean), [isOverall, branches, branchId]);
  const key = ids.join(',');
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    if (!ids.length) return;
    const { data, error } = await fetchMoneyOwed({ branchIds: ids });
    const empty = !error && !data?.totals;
    setState({ data: error || empty ? null : data, error: error || (empty ? new Error('No data') : null), loading: false });
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!branchLoading) load(); }, [branchLoading, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data, error, loading } = state;

  const [tab, setTab] = useState('booking');
  const [notice, setNotice] = useState('');
  const flash = (msg) => { setNotice(msg); setTimeout(() => setNotice(''), 3500); };
  const tabs = data ? TABS(data, ids.length) : [];
  const activeTab = tabs.some((t) => t.id === tab) ? tab : 'booking';
  const empty = !loading && !error && isEmptyOwed(data);
  const ready = !!data?.totals && !empty;
  const insights = useMemo(() => (ready ? moneyOwedInsights(data) : []), [data, ready]);

  // ── Remind: copy only (no payment-due outreach exists yet, ZNLY-163) ──
  const remind = async (rows, all) => {
    const ok = await copyText(all ? reminderAllText(rows) : reminderText(rows[0]));
    flash(ok ? (all ? `Copied ${rows.length} reminders` : 'Reminder copied') : 'Could not copy. Select the text and copy it by hand.');
  };

  const [suggestions, setSuggestions] = useState([]);
  // ── Assign a responsible person to an unassigned row (setDueHolder; names suggested from fetchDueHolderNames) ──
  const [assigning, setAssigning] = useState(null); // booking id being named
  const [assignName, setAssignName] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  const [showSug, setShowSug] = useState(false);
  const startAssign = (row) => {
    setAssigning(row.id); setAssignName(''); setShowSug(false);
    fetchDueHolderNames(row.branch_id).then(({ data: d }) => { if (Array.isArray(d)) setSuggestions(d); });
  };
  const saveAssign = async (row) => {
    const name = assignName.trim();
    if (!name) return;
    setAssignSaving(true);
    const { error: err } = await setDueHolder({ bookingId: row.id, dueHolderName: name });
    setAssignSaving(false);
    if (err) { flash(err.message || 'Could not assign the name.'); return; }
    setAssigning(null); setAssignName('');
    await load();
  };
  const assignSuggestions = useMemo(() => {
    const q = assignName.trim().toLowerCase();
    return suggestions.filter((n) => n && n.toLowerCase().includes(q) && n.toLowerCase() !== q).slice(0, 6);
  }, [assignName, suggestions]);

  // ── Collect: the existing PaymentModal on that booking ──
  const [paying, setPaying] = useState(null);
  const [others, setOthers] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const openPay = async (row) => {
    setPaying(row);
    setOthers([]);
    fetchDueHolderNames(row.branch_id).then(({ data: d }) => { if (Array.isArray(d)) setSuggestions(d); });
    if (!row.customer_phone) return;
    const { data: d } = await getCustomerOutstandingBalance({ customerPhone: row.customer_phone, branchId: row.branch_id, excludeBookingId: row.id });
    setOthers(d?.bookings || []);
  };
  // ZNLY-233: every checkout goes through the one shared submit, so products on the bill are saved (never dropped); no products => the treatment-only path below.
  const handleRecordPayment = (payload) => submitCheckout({ bookingId: paying?.id, payload, treatment: recordTreatmentOnly, onSaved: () => load() });
  const recordTreatmentOnly = async ({ tenders, additionalAllocations, dueHolderName, notes, tipSplits }) => {
    if (!paying) return { error: { message: 'No booking selected.' } };
    setSubmitting(true);
    const result = await recordPayment({ bookingId: paying.id, tenders, dueHolderName, notes });
    if (result.error) { setSubmitting(false); return { error: result.error }; }
    for (const split of (tipSplits || [])) {
      const tip = await recordTip({ bookingId: paying.id, amount: split.amount, receivedBy: split.receivedBy });
      if (tip.error) console.warn('[Tips] recordTip failed:', tip.error.message);
    }
    const failures = await recordBundledAllocations({ allocations: additionalAllocations, notes, bookings: others });
    setSubmitting(false);
    await load(); // refresh after payment
    if (failures.length) flash(`Payment recorded for ${paying.ref}, but NOT recorded for: ${failures.join('; ')}. Those still show as owed.`);
    return { error: null };
  };

  const insightList = (
    <InsightList
      insights={insights.map((i) => ({ ...i, onAct: () => remind(i.remindRows, true), actLabel: `Remind all ${i.remindRows.length}` }))}
      canOpen={(v) => isReportOpenable(v, role)} onOpen={onOpenView}
    />
  );

  const bookingTable = () => (
    <table className="w-full border-collapse">
      <thead><tr>
        <th className={`${th} text-left`}>Customer</th><th className={`${th} text-left`}>Date</th><th className={`${th} text-left`}>Service · {staffLabel.toLowerCase()}</th><th className={`${th} text-left`}>Responsible</th>
        <th className={`${th} text-right`}>Total</th><th className={`${th} text-right`}>Paid</th><th className={`${th} text-right`}>Balance</th><th className={`${th} text-left`}>Status</th><th className={th} />
      </tr></thead>
      <tbody>
        {data.rows.map((r) => (
          <tr key={`${r.src}-${r.id}`}>
            <td className={`${td} whitespace-nowrap`}>{r.customer_name}<Sm>{[r.ref, r.branch_name].filter(Boolean).join(' · ')}</Sm></td>
            <td className={`${td} whitespace-nowrap`}>{dayLabel(r.date)}<Sm>{ageText(r.age_days)}</Sm></td>
            <td className={`${td} max-w-[135px]`}><span className="block truncate" title={r.service}>{r.service}</span><Sm>{r.staff || ''}</Sm></td>
            <td className={`${td} whitespace-nowrap ${r.responsible ? '' : 'text-text-tertiary'}`}>
              {r.responsible || r.src !== 'booking' || !canAssign ? responsibleOf(r) : assigning === r.id ? (
                <div className="flex items-center gap-1.5">
                  <div className="relative w-36">
                    <input
                      type="text" autoFocus value={assignName} placeholder="Name…" aria-label="Responsible person"
                      onChange={(e) => { setAssignName(e.target.value); setShowSug(true); }}
                      onFocus={() => setShowSug(true)} onBlur={() => setTimeout(() => setShowSug(false), 150)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveAssign(r); if (e.key === 'Escape') setAssigning(null); }}
                      className="w-full rounded-spa border border-border bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    {showSug && assignSuggestions.length > 0 && (
                      <div className="absolute z-dropdown left-0 right-0 mt-1 bg-surface border border-border rounded-spa shadow-spa-elevated max-h-44 overflow-y-auto">
                        {assignSuggestions.map((n) => (
                          <button key={n} type="button" onMouseDown={() => { setAssignName(n); setShowSug(false); }} className="w-full text-left px-2 py-1.5 text-xs text-text-primary hover:bg-background">{n}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button type="button" onClick={() => saveAssign(r)} disabled={assignSaving || !assignName.trim()} className="px-2 py-1 rounded-spa bg-primary text-white text-xs font-medium disabled:opacity-50">Save</button>
                  <button type="button" onClick={() => { setAssigning(null); setAssignName(''); }} aria-label="Cancel" className="p-1 rounded-spa hover:bg-background text-text-secondary"><Icon name="X" size={14} /></button>
                </div>
              ) : (
                <span className="inline-flex items-center gap-1.5">{UNASSIGNED}
                  <button type="button" onClick={() => startAssign(r)} className="text-[11px] font-medium text-primary hover:underline print:hidden">Assign</button>
                </span>
              )}
            </td>
            <td className={numTd}>{num(r.total)}</td><td className={numTd}>{num(r.paid)}</td><td className={`${numTd} font-semibold`}>{num(r.balance)}</td>
            <td className={`${td} whitespace-nowrap`}><Pill kind={r.kind} /></td>
            <td className={`${td} text-right whitespace-nowrap print:hidden`}>
              {canCollect && r.src === 'booking' && <button type="button" onClick={() => openPay(r)} className="h-7 px-2.5 rounded-spa bg-primary text-white text-xs font-medium hover:bg-primary/90">Collect</button>}
              {r.src === 'package' && <button type="button" onClick={() => onOpenView('packages')} className="h-7 px-2.5 rounded-spa bg-primary text-white text-xs font-medium hover:bg-primary/90">Open package</button>}{' '}
              <button type="button" onClick={() => remind([r], false)} className="h-7 px-2 rounded-spa border border-border text-xs font-medium hover:bg-black/[0.03] inline-flex items-center gap-1" title="Copy reminder" aria-label="Copy reminder"><Icon name="Copy" size={12} />Remind</button>
            </td>
          </tr>
        ))}
        <tr>
          <td className={`${td} font-semibold`}>{data.totals.count} booking{data.totals.count === 1 ? '' : 's'}</td><td className={td} /><td className={td} /><td className={td} />
          <td className={numTd}>{num(data.totals.total)}</td><td className={numTd}>{num(data.totals.paid)}</td><td className={`${numTd} font-semibold`}>{num(data.totals.amount)}</td><td className={td} /><td className={td} />
        </tr>
      </tbody>
    </table>
  );

  const customerTable = () => (
    <table className="w-full border-collapse">
      <thead><tr><th className={`${th} text-left`}>Customer</th><th className={`${th} text-right`}>Bookings</th><th className={`${th} text-left`}>Last visit</th><th className={`${th} text-right`}>Oldest</th><th className={`${th} text-right`}>Balance</th><th className={th} /></tr></thead>
      <tbody>
        {data.by_customer.map((c) => (
          <tr key={c.key}>
            <td className={td}>{c.name}<Sm>{c.phone || ''}</Sm></td>
            <td className={numTd}>{c.count}</td><td className={td}>{dayLabel(c.last_date)}</td><td className={numTd}>{c.oldest_days} d</td>
            <td className={`${numTd} font-semibold`}>{num(c.amount)}</td>
            <td className={`${td} text-right print:hidden`}>
              <button type="button" onClick={() => remind(data.rows.filter((r) => (r.ckey ?? '') === c.key), true)} className="h-7 px-2.5 rounded-spa border border-border text-xs font-medium hover:bg-black/[0.03]">Copy reminder</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const responsibleTable = () => (
    <table className="w-full border-collapse">
      <thead><tr><th className={`${th} text-left`}>Responsible person</th><th className={`${th} text-right`}>Bookings</th><th className={`${th} text-right`}>Oldest</th><th className={`${th} text-right`}>Balance</th></tr></thead>
      <tbody>
        {data.by_responsible.map((r) => (
          <tr key={r.name || UNASSIGNED}>
            <td className={`${td} ${r.name ? '' : 'text-text-tertiary'}`}>{r.name || UNASSIGNED}</td><td className={numTd}>{r.count}</td><td className={numTd}>{r.oldest_days} d</td><td className={`${numTd} font-semibold`}>{num(r.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const branchTable = () => (
    <table className="w-full border-collapse">
      <thead><tr><th className={`${th} text-left`}>Branch</th><th className={`${th} text-right`}>Bookings</th><th className={`${th} text-right`}>Oldest</th><th className={`${th} text-right`}>Balance</th></tr></thead>
      <tbody>
        {data.by_branch.map((b) => (
          <tr key={b.branch_id} onClick={() => switchBranch(b.branch_id)} className="cursor-pointer hover:bg-black/[0.02]">
            <td className={td}>{b.name}</td><td className={numTd}>{b.count}</td><td className={numTd}>{b.oldest_days} d</td><td className={`${numTd} font-semibold`}>{num(b.amount)}</td>
          </tr>
        ))}
        <tr><td className={`${td} font-semibold`}>All branches</td><td className={numTd}>{data.totals.count}</td><td className={numTd}>{data.totals.oldest_days} d</td><td className={`${numTd} font-semibold`}>{num(data.totals.amount)}</td></tr>
      </tbody>
    </table>
  );

  const staffTable = () => (
    <table className="w-full border-collapse">
      <thead><tr><th className={`${th} text-left`}>{staffLabel}</th><th className={`${th} text-right`}>Bookings</th><th className={`${th} text-right`}>Balance</th></tr></thead>
      <tbody>
        {data.by_staff.map((s) => (<tr key={s.name}><td className={td}>{s.name}</td><td className={numTd}>{s.count}</td><td className={`${numTd} font-semibold`}>{num(s.amount)}</td></tr>))}
      </tbody>
    </table>
  );

  return (
    <>
      <ReportFrame
        groupLabel="Sales & money" title="Money owed" subtitle="Completed bookings and packages not fully paid, any date. Collect or remind from here."
        titleExtra={titleExtra} reopen={reopen} onBack={onBack} onHome={onHome}
        periodSlot={<span className="h-9 px-3 rounded-spa border border-border bg-surface text-[13px] font-medium inline-flex items-center gap-1.5"><Icon name="CalendarClock" size={14} className="text-text-tertiary" />As of now <small className="text-xs text-text-tertiary font-normal">· vs 30 days ago</small></span>}
        tiles={ready ? buildOwedTiles(data) : []}
        previousNote={ready && !(Number(data.prev?.count) > 0 || Number(data.prev?.amount) > 0) ? 'No data for 30 days ago yet.' : null}
        tabs={ready ? tabs : []} activeTab={activeTab} onTab={setTab}
        beforeTabs={ready ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {ageBars(data).map((b) => (
                <div key={b.key} className={`bg-surface border border-border rounded-spa-lg px-3.5 py-3 ${b.count === 0 ? 'opacity-60' : ''}`}>
                  <small className="block text-[11.5px] text-text-tertiary">{b.label}</small>
                  <b className="block font-data tabular-nums text-[17px] font-semibold mt-0.5">{num(b.amount)}</b>
                  <span className="text-[11.5px] text-text-tertiary">{b.count === 0 ? 'none' : `${b.count} booking${b.count > 1 ? 's' : ''}`}</span>
                  <div className="h-1 rounded-full bg-black/[0.06] mt-2 overflow-hidden"><i className="block h-full" style={{ width: `${b.share * 100}%`, background: b.color }} /></div>
                </div>
              ))}
            </div>
            {insightList}
          </>
        ) : null}
        definitions={DEFINITIONS}
        isFavourite={isFavourite} onToggleFav={onToggleFav}
        onExport={ready ? () => downloadCsv(`money-owed-${data.as_of}-${activeTab}.csv`, owedExportRows(data, activeTab, staffLabel)) : null}
      >
        {notice && <p role="status" className="rounded-spa border border-border bg-surface px-3 py-2 text-xs text-text-secondary">{notice}</p>}
        {loading && !data && <p className="py-12 text-center text-sm text-text-secondary">Loading…</p>}
        {error && !loading && <p className="py-12 text-center text-sm text-error">Couldn't load Money owed. Please try again.</p>}
        {empty && (
          <div className="border border-dashed border-border rounded-spa-lg bg-surface p-7 text-center text-sm text-text-secondary leading-relaxed">
            <b className="block text-text-primary mb-1">Nothing is owed</b>No completed booking or package has an unpaid balance{isOverall ? '' : ' at this branch'}.
          </div>
        )}
        {ready && (
          <>
            {activeTab === 'settled' ? <SettledDueHistoryPanel branchId={branchId} /> : (
            <>
            <div className="bg-surface border border-border rounded-spa-lg overflow-x-auto">
              {activeTab === 'booking' && bookingTable()}
              {activeTab === 'customer' && customerTable()}
              {activeTab === 'branch' && branchTable()}
              {activeTab === 'staff' && staffTable()}
              {activeTab === 'responsible' && responsibleTable()}
            </div>
            <NeedsClosingSection branchId={branchId} collapsible therapistId={onlyTherapist} therapistName={params.get('tname') || ''} onShowAll={showAllTherapists} />
            </>
            )}
          </>
        )}
      </ReportFrame>
      {paying && (
        <PaymentModal
          booking={{ bookingId: paying.id, booking_number: paying.ref, branchId: paying.branch_id, finalAmount: paying.total, amountPaid: paying.paid, service: paying.service, dueHolderName: paying.responsible || '' }}
          additionalBookings={others}
          dueHolderSuggestions={suggestions}
          onConfirm={handleRecordPayment}
          savesProducts
          onClose={() => { setPaying(null); setOthers([]); }}
          isSubmitting={submitting}
        />
      )}
    </>
  );
};

export default MoneyOwedReport;
