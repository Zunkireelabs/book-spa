import React, { useEffect, useState } from 'react';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import { Card, GroupBand, Row, SuggestionsCard, npr, sharePct, pctChange, plural, shortDay, weekdayName } from './dashKit';
import { approveDiscount, fetchNeeds, rejectDiscount } from '../../services/api';
import { adminDiscounts, groupNeeds, summarizeWaiting } from '../../lib/dashboardNeeds';
import { friendlyError } from '../../utils/friendlyError';
import { wordBranch, wordBranchCap, wordBranches, wordBranchesCap } from '../../utils/industryTerms';

const waited = (min) => (min >= 24 * 60 ? `${Math.floor(min / 1440)}d` : min >= 60 ? `${Math.floor(min / 60)}h` : `${min}m`);
const nepalDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
const sinceLabel = (ms, today) => {
  if (ms == null) return null;
  if (nepalDay(ms) !== today) return shortDay(nepalDay(ms));
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kathmandu' }).toLowerCase();
};

const Change = ({ pct }) => (pct == null ? <span className="text-gray-400">—</span>
  : pct === 0 ? <span className="text-gray-500">same</span>
    : <span className={pct > 0 ? 'text-primary' : 'text-error'}>{pct > 0 ? '+' : '−'}{Math.abs(pct)}%</span>);

/**
 * Business view (admin / admin_viewer, All branches; mockup scene D): one-line brief, Branches table (a row opens that branch's Branch
 * view), Needs action split into "Needs you (admin)" (discounts, approved/declined in place) and "Waiting at branches" (one summary
 * row per kind per branch, older than 2h), Suggestions placeholder. `data` is get_dashboard for every branch.
 */
const BusinessView = ({ data, dataError, branchIds, today, role, onOpenBranch, onReload }) => {
  const loc = wordBranch(); // the app's own word for a site; useIndustry's locationLabel means rooms here
  const locs = wordBranches();
  const [groups, setGroups] = useState([]);
  const [needsError, setNeedsError] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null);
  const load = async () => {
    if (!branchIds?.length) return;
    const { data: items, error } = await fetchNeeds({ branchIds, date: today });
    setNeedsError(!!error);
    if (!error) setGroups(groupNeeds(items));
  };
  useEffect(() => { load(); }, [branchIds?.join(','), today]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    window.addEventListener('pending-approvals-changed', load);
    return () => window.removeEventListener('pending-approvals-changed', load);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const retry = () => { load(); onReload?.(); };

  const decide = async (b, approve) => {
    setBusyId(b.id); setMessage(null);
    const res = await (approve ? approveDiscount(b.id) : rejectDiscount(b.id));
    setBusyId(null);
    if (res.error) setMessage(friendlyError(res.error, res.error.message || 'Could not save that.'));
    else window.dispatchEvent(new CustomEvent('pending-approvals-changed'));
    retry();
  };

  const pulse = data?.pulse || {};
  const canMoney = data?.money != null;
  const canAct = role === 'admin';
  const rows = data?.branches || [];
  const weekday = weekdayName(today);
  const discounts = adminDiscounts(groups);
  const waiting = summarizeWaiting(groups);
  const needCount = groups.reduce((n, g) => n + g.total, 0);
  const needsOf = (id) => groups.find((g) => g.branch_id === id)?.total || 0;

  const change = pctChange(pulse.revenue, pulse.revenue_prev);
  const behind = rows.map((r) => ({ name: r.name, pct: pctChange(r.revenue, r.revenue_prev) })).filter((r) => r.pct != null && r.pct < 0).sort((a, b) => a.pct - b.pct)[0];
  const sep = <span className="text-gray-300 mx-1.5">·</span>;

  return (
    <div className="space-y-3 sm:space-y-4">
      {dataError ? (
        <Card icon="Building2" title="Business today" error onRetry={retry} />
      ) : (
        <>
          <div className="flex items-start gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3.5 text-sm text-gray-700 leading-relaxed">
            <Icon name="Activity" size={16} className="text-gray-500 mt-0.5 flex-shrink-0" />
            <div>
              <b>{plural(pulse.bookings || 0, 'booking')}</b> across {plural(rows.length, loc, locs)}
              {canMoney && <>{sep}<b>{npr(pulse.revenue)}</b> taken{change != null && change !== 0 && <> <span className={change > 0 ? 'text-primary font-medium' : 'text-error font-medium'}>{change > 0 ? '+' : '−'}{Math.abs(change)}%</span> vs last {weekday.slice(0, 3)}</>}</>}
              {behind && <>{sep}{behind.name} is behind <span className="text-error">−{Math.abs(behind.pct)}%</span></>}
              {!needsError && <>{sep}<span className={needCount ? 'text-warning font-medium' : ''}>{needCount === 0 ? 'nothing needs someone' : `${needCount} ${needCount === 1 ? 'thing needs' : 'things need'} someone`}</span></>}
            </div>
          </div>
          <Card icon="Building2" title={`${wordBranchesCap()} today`} meta={`Click a row to open that ${loc}`}>
            {rows.length === 0 ? <p className="text-sm text-gray-500">No {locs} yet.</p> : (
              <div className="overflow-x-auto -mx-4 -my-4">
                <table className="w-full text-sm">
                  <thead><tr className="text-[11px] text-gray-500 bg-background border-b border-gray-100">
                    <th className="px-3.5 py-2 font-medium text-left">{wordBranchCap()}</th><th className="px-3.5 py-2 font-medium text-right">Now</th>
                    <th className="px-3.5 py-2 font-medium text-right">Bookings</th>
                    {canMoney && <th className="px-3.5 py-2 font-medium text-right">Taken today</th>}
                    {canMoney && <th className="px-3.5 py-2 font-medium text-right whitespace-nowrap">vs last {weekday.slice(0, 3)}</th>}
                    <th className="px-3.5 py-2 font-medium text-right">Booked hours</th>
                    {canMoney && <th className="px-3.5 py-2 font-medium text-right">Unpaid</th>}
                    <th className="px-3.5 py-2 font-medium text-right">Needs action</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => {
                      const pct = sharePct(r.booked_share);
                      const n = needsOf(r.branch_id);
                      return (
                        <tr key={r.branch_id} tabIndex={0} onClick={() => onOpenBranch(r.branch_id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenBranch(r.branch_id); }}
                          className="border-b border-gray-100 last:border-0 cursor-pointer hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50">
                          <td className="px-3.5 py-2.5"><div className="font-semibold text-gray-900">{r.name}</div>{r.manager && <div className="text-[11px] text-gray-500">Manager {r.manager}</div>}</td>
                          <td className="px-3.5 py-2.5 text-right font-data text-[12.5px] whitespace-nowrap">{r.busy_now} of {r.working} busy</td>
                          <td className="px-3.5 py-2.5 text-right font-data text-[12.5px]">{r.completed} / {r.bookings}</td>
                          {canMoney && <td className="px-3.5 py-2.5 text-right font-data text-[12.5px] whitespace-nowrap">{npr(r.revenue)}</td>}
                          {canMoney && <td className="px-3.5 py-2.5 text-right font-data text-[12.5px]"><Change pct={pctChange(r.revenue, r.revenue_prev)} /></td>}
                          <td className="px-3.5 py-2.5 text-right font-data text-[12.5px] whitespace-nowrap">
                            {pct == null ? '—' : <><span className="inline-block w-14 h-[5px] bg-gray-100 rounded-full overflow-hidden align-middle mr-1.5"><i className={`block h-full ${pct < 45 ? 'bg-accent' : 'bg-primary'}`} style={{ width: `${Math.min(100, pct)}%` }} /></span>{pct}%</>}
                          </td>
                          {canMoney && <td className={`px-3.5 py-2.5 text-right font-data text-[12.5px] whitespace-nowrap ${Number(r.unpaid) > 0 ? 'text-warning' : ''}`}>{npr(r.unpaid)}</td>}
                          <td className="px-3.5 py-2.5 text-right font-data text-[12.5px]">{needsError ? '—' : n}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="lg:col-span-3">
          <Card icon="Inbox" title="Needs action" count={needCount} meta="Money owed, or items a manager can't clear" error={needsError} onRetry={retry}>
            <GroupBand>Needs you (admin)</GroupBand>
            {discounts.length === 0 && <p className="text-sm text-gray-500 py-2.5">Nothing needs you right now ✓</p>}
            {discounts.map((b) => {
              const pct = Number(b.base_amount) > 0 ? Math.round((Number(b.discount_amount || 0) / Number(b.base_amount)) * 100) : null;
              return (
                <Row key={b.id} icon="Percent" tone="text-warning" chip={b.branch_name}
                  title={`Discount${pct ? ` ${pct}%` : ''} for ${b.customer_name || b.booking_number}`}
                  sub={[b.requester?.full_name ? `${b.requester.full_name} asks` : 'Waiting for approval', `${npr(b.base_amount)} → ${npr(b.final_amount)}`, b.discount_reason ? `"${b.discount_reason}"` : null].filter(Boolean).join(' · ')}
                  actions={canAct ? (<>
                    <Button size="sm" variant="outline" disabled={busyId === b.id} onClick={() => decide(b, false)}>Decline</Button>
                    <Button size="sm" variant="primary" disabled={busyId === b.id} onClick={() => decide(b, true)}>Approve</Button>
                  </>) : null} />
              );
            })}
            {message && <p className="text-xs text-error pb-2">{message}</p>}
            <GroupBand>Waiting at {locs}</GroupBand>
            {waiting.length === 0 && <p className="text-sm text-gray-500 py-2.5">Nothing is waiting at the {locs} ✓</p>}
            {waiting.map((w) => {
              const since = sinceLabel(w.since, today);
              const go = <Button size="sm" variant="ghost" onClick={() => onOpenBranch(w.branch_id)}>Open {loc}</Button>;
              if (w.kind === 'owed') return (
                <Row key={`${w.branch_id}u`} icon="HandCoins" tone="text-error" chip={w.branch_name}
                  title={`${plural(w.count, 'completed booking')} unpaid`} sub={[`${npr(w.amount)} owed`, w.oldest_date === today ? (since ? `since ${since}` : null) : `oldest ${shortDay(w.oldest_date)}`].filter(Boolean).join(' · ')}
                  actions={go} />
              );
              if (w.kind === 'not_closed') return (
                <Row key={`${w.branch_id}n`} icon="History" tone="text-warning" chip={w.branch_name}
                  title={`${plural(w.count, 'booking')} never closed`} sub={`oldest ${shortDay(w.oldest_date)}`}
                  actions={go} />
              );
              if (w.kind === 'unassigned') return (
                <Row key={`${w.branch_id}a`} icon="UserPlus" tone="text-blue-600" chip={w.branch_name}
                  title={`${plural(w.count, 'booking')} with nobody assigned`} sub={since ? `starting ${since}` : null}
                  actions={go} />
              );
              return (
                <Row key={`${w.branch_id}c`} icon="Clock" tone="text-warning" chip={w.branch_name}
                  title={`${plural(w.count, 'booking')} not confirmed`} sub={`waiting ${waited(Math.max(...w.items.map((i) => i.wait_min)))}${since ? ` · since ${since}` : ''}`}
                  actions={go} />
              );
            })}
          </Card>
        </div>
        <div className="lg:col-span-2"><SuggestionsCard view="business" branchIds={branchIds} today={today} role={role}
          handlers={{ branch: onOpenBranch, booking: (id, b) => onOpenBranch(b), create: (day, b) => onOpenBranch(b) }} /></div>
      </div>
    </div>
  );
};

export default BusinessView;
