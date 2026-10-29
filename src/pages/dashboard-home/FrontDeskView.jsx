import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Button from '../../components/ui/Button';
import { Card, Row, clock12, npr } from './dashKit';
import { DashPanels } from './DashboardPanels';
import { fetchFrontDeskQueue, updateBookingStatus } from '../../services/api';
import { fmtClock, fmtDuration, freeNow } from '../../lib/dashboardFloor';
import { MEMBERSHIP_ENABLED, VOUCHER_ENABLED } from '../../lib/featureFlags';

const MAX_CHIPS = 8;

const ACTION = {
  collect: { icon: 'HandCoins', tone: 'text-error', label: 'Collect', hint: 'completed, not paid' },
  assign: { icon: 'UserPlus', tone: 'text-blue-600', label: 'Assign', hint: 'needs someone' },
  confirm: { icon: 'Clock', tone: 'text-warning', label: 'Confirm', hint: 'not confirmed' },
  checkin: { icon: 'LogIn', tone: 'text-primary', label: 'Check in', hint: 'arriving' },
};

/**
 * Front desk: action buttons, Next up queue (check in / collect / assign inline, same panels as the Branch view), who is free right now.
 * `data` is get_dashboard for the branch (the floor gives "Free right now").
 */
const FrontDeskView = ({ data, dataError, branchId, today, nowMin, role, staffLabelPlural = 'staff', onReload }) => {
  const [, setSearchParams] = useSearchParams();
  const [queue, setQueue] = useState([]);
  const [queueError, setQueueError] = useState(false);
  const [panel, setPanel] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const canAct = role === 'manager' || role === 'admin';
  const go = (view) => setSearchParams({ view });

  const load = useCallback(async () => {
    if (!branchId) return;
    const { data: q, error } = await fetchFrontDeskQueue({ branchId, date: today });
    setQueueError(!!error);
    if (!error) setQueue(q);
  }, [branchId, today]);
  useEffect(() => { load(); }, [load]);
  const refresh = () => { load(); onReload?.(); };

  const step = async (b, status) => {
    setBusyId(b.id);
    await updateBookingStatus({ bookingId: b.id, newStatus: status });
    setBusyId(null);
    refresh();
  };
  const act = (b) => {
    if (b.action === 'collect') return setPanel({ type: 'collect', booking: b });
    if (b.action === 'assign') return setPanel({ type: 'booking', id: b.id });
    return step(b, b.action === 'confirm' ? 'Confirmed' : 'In-Progress');
  };
  const canDo = (b) => (b.action === 'collect' || b.action === 'assign' ? canAct : true);

  const free = freeNow(data?.floor?.[0]?.therapists, nowMin);
  const bookAt = (t) => {
    const m = Math.ceil(nowMin / 10) * 10;
    setPanel({ type: 'create', slot: { day: today, colType: 'therapist', colId: t.therapist_id, hour: Math.floor(m / 60), minute: m % 60 } });
  };
  const bookNow = () => { const m = Math.ceil(nowMin / 10) * 10; setPanel({ type: 'create', slot: { day: today, colType: null, colId: null, hour: Math.floor(m / 60), minute: m % 60 } }); };

  return (
    <div className="space-y-3 sm:space-y-4">
      {canAct && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" iconName="Plus" onClick={bookNow}>New booking</Button>
          <Button size="sm" variant="outline" iconName="HandCoins" onClick={() => go('collect-payment')}>Collect payment</Button>
          {MEMBERSHIP_ENABLED && <Button size="sm" variant="outline" iconName="CreditCard" onClick={() => go('new-membership')}>New membership</Button>}
          {VOUCHER_ENABLED && <Button size="sm" variant="outline" iconName="Ticket" onClick={() => go('new-voucher')}>New voucher</Button>}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="lg:col-span-3 space-y-3 sm:space-y-4">
          <Card icon="ListChecks" title="Next up" count={queue.length} error={queueError} onRetry={refresh}>
            {queue.length === 0 && <p className="text-sm text-gray-500">Nothing waiting at the desk ✓</p>}
            {queue.map((b) => {
              const a = ACTION[b.action];
              const due = Math.max(Number(b.final_amount || 0) - Number(b.amount_paid || 0), 0);
              return (
                <Row key={b.id} icon={a.icon} tone={a.tone}
                  title={`${clock12(b.start_time)} · ${b.customer_name || b.booking_number}${b.action === 'collect' ? ` · ${npr(due)}` : ''}`}
                  sub={[b.service_name_snapshot, a.hint].filter(Boolean).join(' · ')}
                  actions={canDo(b) && <Button size="sm" variant="primary" disabled={busyId === b.id} onClick={() => act(b)}>{a.label}</Button>} />
              );
            })}
          </Card>
        </div>
        <div className="lg:col-span-2 space-y-3 sm:space-y-4">
          <Card icon="Users" title="Free right now" count={0} meta={free.length ? `${free.length} ${free.length === 1 ? 'is' : 'are'} free` : null} error={dataError} onRetry={refresh}>
            {free.length === 0 ? <p className="text-sm text-gray-500">No one is free right now.</p> : (
              <div className="flex flex-wrap gap-2">
                {free.slice(0, MAX_CHIPS).map((t) => (
                  <button key={t.therapist_id} type="button" disabled={!canAct} onClick={() => bookAt(t)} title={canAct ? 'Book them now' : undefined}
                    className="text-left border border-gray-200 rounded-full px-3 py-1 text-sm bg-white enabled:hover:border-primary/50">
                    <span className="font-medium text-gray-900">{t.name}</span>
                    <span className="text-xs text-gray-500"> · free {t.free_until_min >= (nowMin ?? 0) + 24 * 60 ? '' : `for ${fmtDuration(t.free_until_min - nowMin)} · till ${fmtClock(t.free_until_min)}`}</span>
                  </button>
                ))}
                {free.length > MAX_CHIPS && (
                  <button type="button" onClick={() => go('therapists')} className="px-3 py-1 text-sm text-primary font-medium hover:underline">+{free.length - MAX_CHIPS} more</button>
                )}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-2">{staffLabelPlural} on shift with nothing on right now.</p>
          </Card>
          <Card icon="Sparkles" title="Suggestion" meta="Coming soon"><p className="text-sm text-gray-400">Rule-based suggestions will appear here.</p></Card>
        </div>
      </div>
      <DashPanels panel={panel} branchId={branchId} onClose={() => setPanel(null)} onChanged={refresh} />
    </div>
  );
};

export default FrontDeskView;
