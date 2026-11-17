import React, { useCallback, useEffect, useState } from 'react';
import { nameForList, viewerAccess } from '../../services/dataMasking';
import { useAuth } from '../../contexts/AuthContext';
import { useSearchParams } from 'react-router-dom';
import Button from '../../components/ui/Button';
import { Card, SuggestionsCard, clock12, npr, shortDay } from './dashKit';
import { balanceOf, paidNote } from '../../lib/dashboardMoney';
import { DashPanels } from './DashboardPanels';
import { fetchFrontDeskQueue, updateBookingStatus } from '../../services/api';
import { fmtClock, freeNow } from '../../lib/dashboardFloor';
import DeskButtons from './DeskButtons';

const MAX_CHIPS = 8;

const ACTION = {
  collect: { icon: 'HandCoins', tone: 'text-error', label: 'Collect' },
  assign: { icon: 'UserPlus', tone: 'text-blue-600', label: 'Assign' },
  confirm: { icon: 'Clock', tone: 'text-warning', label: 'Confirm', hint: 'not confirmed' },
  checkin: { icon: 'LogIn', tone: 'text-primary', label: 'Check in' },
  with: { icon: 'PlayCircle', tone: 'text-primary' },
};

const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const names = (b) => (b.booking_therapists || []).map((t) => t.therapist?.name).filter(Boolean).join(', ');

/**
 * Front desk (mockup scene E, desktop): the four desk buttons, Next up (time order; check in / confirm / collect / assign inline with the
 * same panels as the Branch view, "With client" for what is running), Free right now as its own card, Suggestion placeholder.
 * `data` is get_dashboard for the branch (the floor gives "Free right now").
 */
const FrontDeskView = ({ data, dataError, branchId, today, nowMin, role, staffLabel = 'staff', onReload }) => {
  const { profile } = useAuth();
  const canViewPrices = viewerAccess(profile).canViewPrices; // ZNLY-235: no collect rows or amounts for a no-prices login
  const [, setSearchParams] = useSearchParams();
  const [queue, setQueue] = useState([]);
  const [queueError, setQueueError] = useState(false);
  const [panel, setPanel] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const canAct = role === 'manager' || role === 'admin'; // assigning, bookable chips and memberships/vouchers stay manager+
  const go = (view) => setSearchParams({ view });

  const load = useCallback(async () => {
    if (!branchId) return;
    const { data: q, error } = await fetchFrontDeskQueue({ branchId, date: today });
    setQueueError(!!error);
    if (!error) setQueue(q);
  }, [branchId, today]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]); // "updates by itself"
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
  const canDo = (b) => (b.action === 'assign' ? canAct : b.action !== 'with');

  const free = freeNow(data?.floor?.[0]?.therapists, nowMin);
  const slotAt = (m, t) => ({ day: today, colType: t ? 'therapist' : null, colId: t ? t.therapist_id : null, hour: Math.floor(m / 60), minute: m % 60 });
  const bookAt = (t) => setPanel({ type: 'create', slot: slotAt(Math.ceil(nowMin / 10) * 10, t) });
  const bookNew = () => setPanel({ type: 'create', slot: slotAt(Math.ceil(nowMin / 10) * 10, null) });
  const walkIn = () => setPanel({ type: 'create', slot: slotAt(Math.floor(nowMin / 5) * 5, free[0] || null) }); // right now, with whoever has been free longest

  const rowFor = (b) => {
    const a = ACTION[b.action];
    const who = names(b);
    const due = balanceOf(b);
    const who1 = nameForList(b.customer_name, b.customer_phone) || b.booking_number;
    const title = b.action === 'collect' ? `${who1} · ready to pay` : [who1, b.service_name_snapshot].filter(Boolean).join(' · ');
    const detail = b.action === 'collect' ? [npr(due), paidNote(b), b.date < today ? `completed ${shortDay(b.date)}` : null].filter(Boolean).join(' · ')
      : b.action === 'with' ? `ends ${clock12(b.end_time)}`
        : b.action === 'assign' ? `needs a ${staffLabel.toLowerCase()}` : a.hint;
    return (
      <div key={b.id} className="flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-0">
        <span className="font-data text-xs text-gray-600 w-[62px] flex-shrink-0">{b.date < today ? shortDay(b.date).slice(4) : clock12(b.start_time)}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-gray-900 truncate">{title}</div>
          <div className="text-xs text-gray-500 truncate">{[who, detail].filter(Boolean).join(' · ')}</div>
        </div>
        {b.action === 'with' && <span className="text-[11px] font-medium rounded-full px-2 py-0.5 bg-primary/10 text-primary flex-shrink-0">With client</span>}
        {canDo(b) && <Button size="sm" variant={b.action === 'assign' ? 'outline' : 'primary'} disabled={busyId === b.id} onClick={() => act(b)}>{a.label}</Button>}
      </div>
    );
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      <DeskButtons onNew={bookNew} onWalkIn={walkIn} onGo={go} extras={canAct} />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="lg:col-span-3 space-y-3 sm:space-y-4">
          <Card icon="Clock" title="Next up" count={queue.filter((b) => b.action !== 'with').length} error={queueError} onRetry={refresh}
            meta={<span className="inline-flex items-center gap-1.5"><i className="w-1.5 h-1.5 rounded-full bg-success" />Live · updates by itself</span>}>
            {queue.length === 0 && <p className="text-sm text-gray-500">Nothing waiting at the desk ✓</p>}
            {queue.filter((b) => canViewPrices || b.action !== 'collect').map(rowFor)}
          </Card>
          <Card icon="Users" title="Free right now" error={dataError} onRetry={refresh}>
            {free.length === 0 ? <p className="text-sm text-gray-500">No one is free right now.</p> : (
              <div className="flex flex-wrap gap-2">
                {free.slice(0, MAX_CHIPS).map((t) => (
                  <button key={t.therapist_id} type="button" onClick={() => bookAt(t)} title="Book them now"
                    className="flex items-center gap-1.5 border border-gray-200 rounded-full pl-1 pr-2.5 py-1 text-xs bg-white hover:border-primary/50">
                    <span className="w-6 h-6 rounded-full bg-gray-100 text-[10px] font-semibold text-gray-600 flex items-center justify-center">{initials(t.name)}</span>
                    <span className="font-medium text-gray-900">{t.name.split(' ')[0]}</span>
                    {t.free_until_min < nowMin + 24 * 60 && <span className="text-gray-500">till {fmtClock(t.free_until_min)}</span>}
                  </button>
                ))}
                {free.length > MAX_CHIPS && (
                  <button type="button" onClick={() => go('therapists')} className="px-3 py-1 text-sm text-primary font-medium hover:underline">+{free.length - MAX_CHIPS} more</button>
                )}
              </div>
            )}
          </Card>
        </div>
        <div className="lg:col-span-2 space-y-3 sm:space-y-4">
          <SuggestionsCard title="Suggestion" view="frontdesk" branchIds={[branchId]} today={today} role={role}
            handlers={{ booking: (id) => setPanel({ type: 'booking', id }) }} />
        </div>
      </div>
      <DashPanels panel={panel} branchId={branchId} onClose={() => setPanel(null)} onChanged={refresh} />
    </div>
  );
};

export default FrontDeskView;
