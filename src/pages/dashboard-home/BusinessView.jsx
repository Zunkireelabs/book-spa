import React, { useEffect, useState } from 'react';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import { Card, Row, Tile, npr, plural, shortDay } from './dashKit';
import { fetchBusinessNeeds } from '../../services/api';

const KIND = {
  discount: { icon: 'Percent', tone: 'text-warning', text: (b) => `Discount waiting for approval · ${b.customer_name || b.booking_number}` },
  unconfirmed: { icon: 'Clock', tone: 'text-warning', text: (b) => `${b.customer_name || b.booking_number} not confirmed` },
  unpaid: { icon: 'HandCoins', tone: 'text-error', text: (b) => `${b.customer_name || b.booking_number} completed, not paid · NPR ${Number(b.final_amount || 0).toLocaleString('en-IN')}` },
};
const waited = (min) => (min >= 24 * 60 ? `${Math.floor(min / 1440)}d` : min >= 60 ? `${Math.floor(min / 60)}h` : `${min}m`);

/**
 * Business view (admin / admin_viewer, All branches): brief, branches table (a row opens that branch's Branch view), Needs action limited to
 * admin-only items and anything waiting over 2h (grouped by branch), Suggestions placeholder. `data` is get_dashboard for every branch.
 */
const BusinessView = ({ data, dataError, branchIds, today, staffLabelPlural = 'staff', onOpenBranch, onReload, newTenant = false }) => {
  const [groups, setGroups] = useState([]);
  const [needsError, setNeedsError] = useState(false);
  const load = async () => {
    if (!branchIds?.length) return;
    const { data: g, error } = await fetchBusinessNeeds({ branchIds, date: today });
    setNeedsError(!!error);
    if (!error) setGroups(g);
  };
  useEffect(() => { load(); }, [branchIds?.join(','), today]); // eslint-disable-line react-hooks/exhaustive-deps
  const retry = () => { load(); onReload?.(); };

  const pulse = data?.pulse || {};
  const canMoney = data?.money != null;
  const rows = data?.branches || [];
  const needCount = groups.reduce((n, g) => n + g.items.length, 0);
  const working = rows.reduce((n, r) => n + Number(r.working || 0), 0);
  const label = 'branches';

  return (
    <div className="space-y-3 sm:space-y-4">
      {dataError ? (
        <Card icon="Building2" title="Business today" error onRetry={retry} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
            <Tile label="Bookings today" value={pulse.bookings ?? 0} sub={`${pulse.completed || 0} done · ${(pulse.confirmed || 0) + (pulse.pending || 0)} to come`} icon="CalendarDays" />
            <Tile label="Taken today" value={canMoney ? npr(pulse.revenue) : '—'} sub={newTenant ? 'No comparison yet' : canMoney ? 'All ' + label : 'Not shown for your role'} icon="Banknote" />
            <Tile label={`${staffLabelPlural} working`} value={working} sub={`Across ${plural(rows.length, 'branch', label)}`} icon="Users" />
            <Tile label="Needs a decision" value={needsError ? '—' : needCount} sub="Admin-only or waiting over 2h" icon="Inbox" />
          </div>
          <Card icon="Building2" title="Branches" meta="Click one to open it">
            {rows.length === 0 ? <p className="text-sm text-gray-500">No {label} yet.</p> : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-500">
                    <th className="px-1 py-1.5 font-medium">Name</th><th className="px-1 py-1.5 font-medium text-right">Bookings</th>
                    <th className="px-1 py-1.5 font-medium text-right">Done</th>{canMoney && <th className="px-1 py-1.5 font-medium text-right">Taken</th>}
                    <th className="px-1 py-1.5 font-medium text-right">Working</th><th />
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.branch_id} onClick={() => onOpenBranch(r.branch_id)} className="border-t border-gray-100 cursor-pointer hover:bg-gray-50">
                        <td className="px-1 py-2 font-medium text-gray-900">{r.name}</td>
                        <td className="px-1 py-2 text-right tabular-nums">{r.bookings}</td>
                        <td className="px-1 py-2 text-right tabular-nums">{r.completed}</td>
                        {canMoney && <td className="px-1 py-2 text-right tabular-nums">{npr(r.revenue)}</td>}
                        <td className="px-1 py-2 text-right tabular-nums">{r.working}</td>
                        <td className="px-1 py-2 text-right text-gray-400"><Icon name="ChevronRight" size={14} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="lg:col-span-3">
          <Card icon="Inbox" title="Needs your decision" count={needCount} error={needsError} onRetry={retry}>
            {groups.length === 0 && <p className="text-sm text-gray-500">Nothing needs you right now ✓</p>}
            {groups.map((g) => (
              <div key={g.branch_id} className="mb-3 last:mb-0">
                <div className="text-xs font-medium text-gray-500 mb-1">{g.branch_name} · {g.items.length}</div>
                {g.items.map((b) => (
                  <Row key={`${b.kind}${b.id}`} icon={KIND[b.kind].icon} tone={KIND[b.kind].tone} title={KIND[b.kind].text(b)} sub={`${shortDay(b.date)} · waiting ${waited(b.wait_min)}`}
                    actions={<Button size="sm" variant="outline" onClick={() => onOpenBranch(g.branch_id, b.kind === 'discount' ? b.id : null)}>Open</Button>} />
                ))}
              </div>
            ))}
          </Card>
        </div>
        <div className="lg:col-span-2">
          <Card icon="Sparkles" title="Suggestions" meta="Coming soon"><p className="text-sm text-gray-400">Rule-based suggestions will appear here.</p></Card>
        </div>
      </div>
    </div>
  );
};

export default BusinessView;
