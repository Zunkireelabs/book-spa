import { NEPAL_TZ } from '../../utils/nepalTime';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import PendingDiscountsPanel from '../branch-manager-dashboard/components/PendingDiscountsPanel';
import DailyClosingPanel from '../branch-manager-dashboard/components/DailyClosingPanel';
import Floor from './Floor';
import SetupChecklist from './SetupChecklist';
import { DashPanels } from './DashboardPanels';
import { fetchNeeds, updateBookingStatus } from '../../services/api';
import { supabase } from '../../lib/supabase';
import { confirmPendingBooking } from '../../lib/confirmBooking';
import { useToast } from '../branch-manager-dashboard/components/Area/listKit';
import { dayProgress, dayProgressText } from '../../lib/dayProgress';
import { bookingSplit, splitLine, fmtClock, fmtDuration, fmtRange, fmtFreeTotal, freeNow, freeTime } from '../../lib/dashboardFloor';
import DeskButtons from './DeskButtons';
import { paidNote } from '../../lib/dashboardMoney';
import { foldDayMoney } from '../../lib/dayMoney';
import { npr, plural, shortDay, clock12, LoadError, Card, Row, SuggestionsCard, Tile, sharePct } from './dashKit';
import { dayStatus, nextClient } from '../../lib/dashboardMyDay';
import { ofKind } from '../../lib/dashboardNeeds';

const WEEKDAY = new Date().toLocaleDateString('en-GB', { weekday: 'short', timeZone: NEPAL_TZ });
// Delta vs the same weekday last week: green up / red down, plain "—" when there is no data to compare.
const Delta = ({ now, prev, unit }) => {
  if (now == null || prev == null || (unit === '%' && Number(prev) === 0)) return <span className="text-gray-400">— vs last {WEEKDAY}</span>;
  const diff = unit === 'pts' ? Math.round((now - prev) * 100) : Math.round(((now - prev) / prev) * 100);
  if (diff === 0) return <span className="text-gray-500">same as last {WEEKDAY}</span>;
  return <span className={diff > 0 ? 'text-success font-medium' : 'text-error font-medium'}>{diff > 0 ? '+' : '−'}{Math.abs(diff)}{unit === 'pts' ? ' pts' : '%'} <span className="text-gray-500 font-normal">vs last {WEEKDAY}</span></span>;
};

const WeekStrip = ({ week }) => (
  <div className="grid grid-cols-7 gap-2">
    {(week || []).map((d, i) => {
      const pct = sharePct(d.booked_share);
      const low = pct != null && pct < 45;
      return (
        <div key={d.date} className="text-center">
          <div className="h-16 bg-gray-50 rounded relative flex items-end overflow-hidden">
            <div className={`w-full ${low ? 'bg-accent' : 'bg-primary/70'}`} style={{ height: `${Math.min(100, pct || 0)}%` }} />
          </div>
          <div className="text-xs font-medium text-gray-900 mt-1">{pct == null ? '—' : `${pct}%`}</div>
          <div className="text-[11px] text-gray-500">{i === 0 ? 'Today' : new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })}</div>
        </div>
      );
    })}
  </div>
);

/**
 * The Branch view (V36c): Live / Prep / Close for one branch, from get_dashboard. `data` is the RPC result, `hours` {open, close} minutes.
 */
const BranchView = ({ phase, data, hours, nowMin, branchId, today, role, staffLabel, staffLabelPlural, highlight, onReload, dataError = false, newTenant = false, setup = null, nowHm = null, onOpenMyDay }) => {
  const [, setSearchParams] = useSearchParams();
  const [panel, setPanel] = useState(null); // { type: 'booking', id } | { type: 'create', slot } | { type: 'collect', booking }
  const [needs, setNeeds] = useState(null); // null = still loading (never shown as 0 / "nothing left") // every booking that needs someone, tagged with its kind (lib/dashboardNeeds)
  const [needsError, setNeedsError] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const { notify, toastNode } = useToast();
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState(null);
  const canAct = role === 'manager' || role === 'admin';
  const canMoney = data?.money != null;

  const loadNeeds = useCallback(async () => {
    if (!branchId) return;
    const { data: rows, error } = await fetchNeeds({ branchIds: [branchId], date: today });
    setNeedsError(!!error);
    if (!error) setNeeds(rows);
  }, [branchId, today]);
  useEffect(() => { loadNeeds(); }, [loadNeeds]);

  // Another device (or a colleague) changing a booking of this branch updates the Needs list here without a reload: one debounced
  // refetch per burst of events, only while this view is mounted (the channel is dropped on unmount / branch change).
  const loadNeedsRef = useRef(loadNeeds);
  loadNeedsRef.current = loadNeeds;
  useEffect(() => {
    if (!branchId) return undefined;
    let timer = null;
    const channel = supabase
      .channel(`dashboard-needs-${branchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `branch_id=eq.${branchId}` }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => loadNeedsRef.current?.(), 1000);
      })
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [branchId]);

  const loadClosed = useCallback(async () => {
    if (!branchId) return;
    const { data: r } = await supabase.from('daily_reports').select('closed_at, closer:users!daily_reports_closed_by_fkey(full_name)').eq('branch_id', branchId).eq('report_date', today).maybeSingle();
    setClosed(r || null);
  }, [branchId, today]);
  // Only the Close part of the day shows who closed it, so the lookup waits until that part is open.
  useEffect(() => { if (phase === 'close') loadClosed(); }, [loadClosed, phase]);

  const refresh = () => { loadNeeds(); onReload?.(); };
  const go = (view) => setSearchParams({ view });
  const openBooking = (id) => setPanel({ type: 'booking', id });
  const openCreate = (slot) => setPanel({ type: 'create', slot: { day: today, colType: null, colId: null, ...slot } });
  const closePanel = () => setPanel(null);
  // A new booking starting at the next 10 minutes from `fromMin`, kept inside the free gap that ends at `toMin`.
  const gapStart = (fromMin, toMin) => Math.min(Math.ceil(fromMin / 10) * 10, Math.max(fromMin, toMin - 10));
  const bookGap = (t, g) => { const m = gapStart(g.from_min, g.to_min); openCreate({ colType: 'therapist', colId: t.therapist_id, hour: Math.floor(m / 60), minute: m % 60 }); };
  const bookNow = () => { const m = gapStart(nowMin ?? 9 * 60, 24 * 60); openCreate({ hour: Math.floor(m / 60), minute: m % 60 }); };
  const confirm = async (id) => {
    setBusyId(id);
    await confirmPendingBooking(id, { update: updateBookingStatus, notify });   // a refusal is a toast; the booking stays Pending
    setBusyId(null);
    refresh();
  };

  const floor = data?.floor?.[0];
  const pulse = data?.pulse || {};
  const split = bookingSplit(pulse);
  const progress = dayProgress(pulse);
  const free = freeTime(floor?.therapists, phase === 'live' ? nowMin : null);
  const share = data?.week?.[0]?.booked_share;
  const bad = dataError; // get_dashboard failed
  const badNeeds = dataError || needsError; // or the needs rows failed
  const rowName = (b) => b.customer_name || b.booking_number;

  const owed = ofKind(needs, 'owed');
  const unconfirmed = ofKind(needs, 'unconfirmed');
  const unassigned = ofKind(needs, 'unassigned');
  const notClosed = ofKind(needs, 'not_closed');
  const oldestOpen = notClosed.map((b) => b.date).sort()[0];
  const unpaidRows = owed.map((b) => (
    <Row key={`p${b.id}`} icon="HandCoins" tone="text-error" title={`Collect ${npr(b.amount_due)} · ${rowName(b)}`} sub={[`Completed ${b.date === today ? clock12(b.start_time) : shortDay(b.date)}`, paidNote(b) || 'not paid'].join(' · ')}
      actions={canAct && <Button size="sm" variant="primary" onClick={() => setPanel({ type: 'collect', booking: b })}>Collect</Button>} />
  ));
  const unconfirmedRows = unconfirmed.map((b) => (
    <Row key={`c${b.id}`} icon="Clock" tone="text-warning" title={`${rowName(b)} at ${clock12(b.start_time)} not confirmed`} sub={b.service_name_snapshot}
      actions={<Button size="sm" variant="primary" disabled={busyId === b.id} onClick={() => confirm(b.id)}>Confirm</Button>} />
  ));
  const unassignedRows = unassigned.map((b) => (
    <Row key={`a${b.id}`} icon="UserPlus" tone="text-blue-600" title={`${rowName(b)} at ${clock12(b.start_time)} needs a ${(staffLabelPlural || 'person').toLowerCase().replace(/s$/, '')}`} sub={b.service_name_snapshot}
      actions={<Button size="sm" variant="primary" onClick={() => openBooking(b.id)}>Assign</Button>} />
  ));

  const discounts = canAct && <PendingDiscountsPanel branchId={branchId} highlightBookingId={highlight} />;
  const notClosedRow = notClosed.length > 0 && (
    <Row icon="History" tone="text-warning" title={`${plural(notClosed.length, 'booking')} never closed`} sub={`oldest ${shortDay(oldestOpen)}`} actions={<Button size="sm" variant="outline" onClick={() => go('bookings')}>Open</Button>} />
  );
  const needsLoading = needs === null && !needsError;
  const needCount = needs ? needs.length : 0; // the one rule: every kind, so Live, Close and Business show the same total

  const needsCard = (
    <Card icon="Inbox" title="Needs action" count={needCount} error={badNeeds} onRetry={refresh} loading={needsLoading}>
      {needCount === 0 && <p className="text-sm text-gray-500">Nothing needs you right now ✓</p>}
      {discounts}
      {unpaidRows}{unconfirmedRows}{unassignedRows}{notClosedRow}
    </Card>
  );
  const suggestions = (
    <SuggestionsCard view="branch" branchIds={[branchId]} today={today} role={role}
      handlers={{ booking: openBooking, create: (day) => openCreate({ day }) }} />
  );
  const nextSeven = <Card icon="CalendarDays" title="Next 7 days" error={bad} onRetry={refresh} meta={`Booked share of ${(staffLabel || 'staff').toLowerCase()} hours`}><WeekStrip week={data?.week} /></Card>;
  const floorCard = (title, meta) => (
    <Card icon="Users" title={title} meta={meta} metaBelow error={bad} onRetry={refresh}>
      <Floor floor={floor} nowMin={phase === 'live' ? nowMin : null} open={hours?.open} close={hours?.close} onOpenBooking={openBooking}
        onBookGap={bookGap} staffPlural={(staffLabelPlural || 'staff').toLowerCase()} />
    </Card>
  );

  // Solo owner (scene G): linked, with bookings today -> a green My day strip first. The same "next client" rule as the My day view.
  const mineList = data?.my_day?.bookings || [];
  const mineNext = mineList.length && nowHm ? nextClient(mineList, nowHm) : null;
  const toMinHm = (t) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5));
  const mineIn = mineNext && mineNext.status !== 'In-Progress' ? toMinHm(mineNext.start) - toMinHm(nowHm) : null;
  const mineDay = dayStatus(mineList, nowHm || '00:00');
  const myDay = mineList.length > 0 && (
    <section className="bg-primary text-white rounded-lg px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2" data-myday-strip>
      <div className="min-w-0">
        <div className="text-[11px] tracking-wide opacity-75">
          {mineNext ? (mineNext.status === 'In-Progress' ? 'MY DAY · WITH YOU NOW' : mineIn > 0 ? `MY DAY · NEXT CLIENT IN ${fmtDuration(mineIn).replace(/m$/, ' MIN').toUpperCase()}` : 'MY DAY · NEXT CLIENT IS DUE') : mineDay.allClosed ? 'MY DAY · ALL DONE' : 'MY DAY · NO MORE CLIENTS TODAY'}
        </div>
        {mineNext && <div className="text-[15px] font-semibold truncate">{clock12(mineNext.start)} · {mineNext.customer || mineNext.number} · {mineNext.service}</div>}
        <div className="text-xs opacity-85">{[mineNext?.room, !mineNext && !mineDay.allClosed ? `${mineDay.open} not closed yet` : null, `${dayProgressText({ finished: mineDay.done, total: mineDay.total, noShow: mineDay.noShow })} today`].filter(Boolean).join(' · ')}</div>
      </div>
      <button type="button" onClick={onOpenMyDay} className="ml-auto bg-white text-primary text-xs font-medium rounded-lg px-3 py-1.5 hover:bg-white/90">Open my day</button>
    </section>
  );

  const freeList = freeNow(floor?.therapists, nowMin ?? 0);
  const walkIn = () => { const m = Math.floor((nowMin ?? 9 * 60) / 5) * 5; openCreate({ walkIn: true, colType: freeList[0] ? 'therapist' : null, colId: freeList[0]?.therapist_id || null, hour: Math.floor(m / 60), minute: m % 60 }); };
  const frontDesk = canAct && <DeskButtons onNew={bookNow} onWalkIn={walkIn} onGo={go} extras />;

  const brief = (icon, children) => badNeeds ? (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3"><LoadError onRetry={refresh} /></div>
  ) : (
    <div className="flex items-start gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-700"><Icon name={icon} size={16} className="text-gray-500 mt-0.5" /><div>{children}</div></div>
  );
  const sep = <span className="text-gray-300 mx-1.5">·</span>;

  let body;
  if (phase === 'prep') {
    const prepCount = unconfirmed.length + unassigned.length;
    body = (
      <>
        {brief('Sun', <>
          <b>{plural(pulse.bookings || 0, 'booking')}</b> today{sep}<b>{floor?.working ?? 0} of {floor?.headcount ?? 0}</b> {(staffLabelPlural || 'staff').toLowerCase()} in
          {pulse.pending > 0 && <>{sep}<span className="text-warning">{pulse.pending} unconfirmed</span></>}
          {unassigned.length > 0 && <>{sep}<span className="text-warning">{unassigned.length} unassigned</span></>}
        </>)}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 sm:gap-4">
          <div className="lg:col-span-3 space-y-3 sm:space-y-4">
            <Card icon="CheckCheck" title="Get today ready" count={prepCount} error={badNeeds} onRetry={refresh}>
              {prepCount === 0 ? <p className="text-sm text-success font-medium">All set ✓</p> : <>{discounts}{unconfirmedRows}{unassignedRows}</>}
            </Card>
            {floorCard("Today's floor", 'Gaps of 1h or more in gold · click one to book it')}
          </div>
          <div className="lg:col-span-2 space-y-3 sm:space-y-4">{suggestions}{nextSeven}</div>
        </div>
      </>
    );
  } else if (phase === 'close') {
    const taken = pulse.revenue;
    body = (
      <>
        {brief('Moon', <>
          <b>{progress.finished} of {progress.total}</b> finished{progress.noShow > 0 && <> · {progress.noShow} no-show</>}
          {canMoney && <>{sep}<b>{npr(taken)}</b> taken</>}
          {sep}{needsLoading ? <span className="text-gray-400">loose ends…</span> : <span className={needCount ? 'text-warning' : ''}>{needCount} loose ends</span>}
          {sep}tomorrow {data?.tomorrow?.bookings ?? 0} booked
        </>)}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
          <div className="space-y-3 sm:space-y-4">
            {canMoney && (
              <Card icon="Banknote" title="Today's money" error={bad} onRetry={refresh}>
                <div className="text-sm divide-y divide-gray-100">
                  {(() => { const m = foldDayMoney({ byMode: data.money.by_method, refunds: data.money.refunds }); return (<>
                    {m.byMethod.map((r) => <div key={r.method} className="flex justify-between py-1.5"><span className="text-gray-600">{r.label}</span><b className="font-data">{npr(r.amount)}</b></div>)}
                    {m.refunds > 0 && <div className="flex justify-between py-1.5"><span className="text-gray-600">Refunds</span><b className="font-data text-error">−{npr(m.refunds)}</b></div>}
                    <div className="flex justify-between py-1.5"><span className="text-gray-600">Taken today</span><b className="font-data">{npr(m.taken)}</b></div>
                    {data.money.after_close?.amount ? <div className="flex justify-between py-1.5"><span className="text-gray-600">of which collected after close <span className="text-gray-400">(not in the closed report)</span></span><b className="font-data">{npr(data.money.after_close.amount)}{data.money.after_close.cash ? ` (cash ${npr(data.money.after_close.cash)})` : ''}</b></div> : null}
                    
                  </>); })()}
                  <div className="flex justify-between py-1.5"><span className="text-gray-600">Tips (passed to staff, not revenue)</span><b className="font-data">{npr(data.money.tips)}</b></div>
                  <div className="flex justify-between py-2"><b>Cash expected in the drawer</b><b className="font-data">{npr(data.money.cash_expected)}</b></div>
                </div>
                {closed ? (
                  <p className="text-sm text-success font-medium mt-2">Closed at {new Date(closed.closed_at).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: NEPAL_TZ })}{closed.closer?.full_name ? ` by ${closed.closer.full_name}` : ''} ✓</p>
                ) : canAct && (
                  <Button className="mt-3 max-md:min-h-11" onClick={() => setClosing((v) => !v)}>{closing ? 'Hide closing' : 'Close the day'}</Button>
                )}
              </Card>
            )}
            {closing && !closed && <DailyClosingPanel branchId={branchId} onOpenBooking={openBooking} />}
            <Card icon="Sun" title="Tomorrow" error={bad} onRetry={refresh} meta={data?.tomorrow ? `${data.tomorrow.working} ${(staffLabelPlural || 'staff').toLowerCase()} working` : null}>
              <Row icon="CalendarDays" tone="text-primary" title={plural(data?.tomorrow?.bookings ?? 0, 'booking')} actions={<Button size="sm" variant="outline" onClick={() => go('calendar')}>Open calendar</Button>} />
              {data?.tomorrow?.unconfirmed > 0 && <Row icon="Clock" tone="text-warning" title={`${data.tomorrow.unconfirmed} not confirmed for tomorrow`} />}
            </Card>
          </div>
          <div className="space-y-3 sm:space-y-4">
            <Card icon="CheckCheck" title="Loose ends" count={needCount} error={badNeeds} onRetry={refresh} loading={needsLoading}>
              {needCount === 0 && <p className="text-sm text-success font-medium">Nothing left open ✓</p>}
              {discounts}{unpaidRows}{unconfirmedRows}{unassignedRows}{notClosedRow}
            </Card>
            {suggestions}
          </div>
        </div>
      </>
    );
  } else {
    body = (
      <>
        {bad ? <Card icon="CalendarDays" title="Today so far" error onRetry={refresh} /> : <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
          <Tile label="Bookings today" value={pulse.bookings ?? 0} sub={splitLine(split)} icon="CalendarDays" onClick={() => go('bookings')} />
          <Tile label="Taken today" value={canMoney ? npr(pulse.revenue) : '—'} sub={canMoney ? (data?.money?.after_close?.amount ? `incl. ${npr(data.money.after_close.amount)} after close` : (newTenant ? 'No comparison yet' : <Delta now={pulse.revenue} prev={pulse.revenue_prev} unit="%" />)) : 'Managers see this'} icon="Banknote" onClick={() => go('all-reports')} />
          <Tile label="Free time left" value={newTenant ? '—' : fmtFreeTotal(free.total)} sub={newTenant ? 'Fills in once you take bookings' : free.biggest ? `${free.total >= 24 * 60 ? `across ${plural(free.people, (staffLabel || 'person').toLowerCase(), (staffLabelPlural || 'people').toLowerCase())} · ` : ''}Biggest gap ${fmtRange(free.biggest.from_min, free.biggest.to_min)}` : 'No gaps of 1h or more'} icon="Clock" onClick={() => go('calendar')} />
          <Tile label="Booked hours" value={newTenant || share == null ? '—' : `${sharePct(share)}%`} sub={newTenant ? 'No comparison yet' : <>Of {(staffLabel || 'staff').toLowerCase()} hours · <Delta now={share} prev={pulse.booked_share_prev} unit="pts" /></>} icon="Users" onClick={() => go('all-reports')} />
        </div>}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 sm:gap-4">
          <div className="lg:col-span-3 space-y-3 sm:space-y-4">
            {floorCard('Live floor', 'Click a block to open it · click a gap to book it')}
            {nextSeven}
          </div>
          <div className="lg:col-span-2 space-y-3 sm:space-y-4">{needsCard}{suggestions}</div>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      {myDay}{frontDesk}{newTenant && setup && <SetupChecklist steps={setup} onGo={go} />}{body}
      <DashPanels panel={panel} branchId={branchId} onClose={closePanel} onChanged={refresh} />
      {toastNode}
    </div>
  );
};

export default BranchView;
