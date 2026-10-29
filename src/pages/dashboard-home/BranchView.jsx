import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import PendingDiscountsPanel from '../branch-manager-dashboard/components/PendingDiscountsPanel';
import DailyClosingPanel from '../branch-manager-dashboard/components/DailyClosingPanel';
import Floor from './Floor';
import SetupChecklist from './SetupChecklist';
import { DashPanels } from './DashboardPanels';
import { fetchNeedsActionRows, updateBookingStatus } from '../../services/api';
import { supabase } from '../../lib/supabase';
import { bookingSplit, fmtClock, fmtFreeTotal, freeTime } from '../../lib/dashboardFloor';
import { npr, plural, shortDay, clock12, LoadError, Card, Row, Tile } from './dashKit';
import { MEMBERSHIP_ENABLED, VOUCHER_ENABLED } from '../../lib/featureFlags';

const WEEKDAY = new Date().toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Asia/Kathmandu' });
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
      const pct = d.booked_share == null ? null : Math.round(d.booked_share * 100);
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
const BranchView = ({ phase, data, hours, nowMin, branchId, today, role, staffLabel, staffLabelPlural, highlight, onReload, dataError = false, newTenant = false, setup = null }) => {
  const [, setSearchParams] = useSearchParams();
  const [panel, setPanel] = useState(null); // { type: 'booking', id } | { type: 'create', slot } | { type: 'collect', booking }
  const [needs, setNeeds] = useState({ unpaid: [], unconfirmed: [], unassigned: [] });
  const [needsError, setNeedsError] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState(null);
  const canAct = role === 'manager' || role === 'admin';
  const canMoney = data?.money != null;

  const loadNeeds = useCallback(async () => {
    if (!branchId) return;
    const { data: rows, error } = await fetchNeedsActionRows({ branchId, date: today });
    setNeedsError(!!error);
    if (!error) setNeeds(rows);
  }, [branchId, today]);
  useEffect(() => { loadNeeds(); }, [loadNeeds]);

  const loadClosed = useCallback(async () => {
    if (!branchId) return;
    const { data: r } = await supabase.from('daily_reports').select('closed_at, closer:users!daily_reports_closed_by_fkey(full_name)').eq('branch_id', branchId).eq('report_date', today).maybeSingle();
    setClosed(r || null);
  }, [branchId, today]);
  useEffect(() => { loadClosed(); }, [loadClosed]);

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
    await updateBookingStatus({ bookingId: id, newStatus: 'Confirmed' });
    setBusyId(null);
    refresh();
  };

  const floor = data?.floor?.[0];
  const pulse = data?.pulse || {};
  const split = bookingSplit(pulse);
  const free = freeTime(floor?.therapists, phase === 'live' ? nowMin : null);
  const share = data?.week?.[0]?.booked_share;
  const bad = dataError; // get_dashboard failed
  const badNeeds = dataError || needsError; // or the needs rows failed
  const rowName = (b) => b.customer_name || b.booking_number;

  const unpaidRows = needs.unpaid.map((b) => (
    <Row key={`p${b.id}`} icon="HandCoins" tone="text-error" title={`Collect ${npr(b.final_amount)} · ${rowName(b)}`} sub={`Completed ${b.date === today ? clock12(b.start_time) : shortDay(b.date)} · not paid`}
      actions={canAct && <Button size="sm" variant="primary" onClick={() => setPanel({ type: 'collect', booking: b })}>Collect</Button>} />
  ));
  const unconfirmedRows = needs.unconfirmed.map((b) => (
    <Row key={`c${b.id}`} icon="Clock" tone="text-warning" title={`${rowName(b)} at ${clock12(b.start_time)} not confirmed`} sub={b.service_name_snapshot}
      actions={<Button size="sm" variant="primary" disabled={busyId === b.id} onClick={() => confirm(b.id)}>Confirm</Button>} />
  ));
  const unassignedRows = needs.unassigned.map((b) => (
    <Row key={`a${b.id}`} icon="UserPlus" tone="text-blue-600" title={`${rowName(b)} at ${clock12(b.start_time)} needs a ${(staffLabelPlural || 'person').toLowerCase().replace(/s$/, '')}`} sub={b.service_name_snapshot}
      actions={<Button size="sm" variant="primary" onClick={() => openBooking(b.id)}>Assign</Button>} />
  ));

  const discounts = canAct && <PendingDiscountsPanel branchId={branchId} highlightBookingId={highlight} />;
  const needCount = needs.unpaid.length + needs.unconfirmed.length + needs.unassigned.length + (data?.needs_action?.pending_discounts || 0);

  const needsCard = (
    <Card icon="Inbox" title="Needs action" count={needCount} error={badNeeds} onRetry={refresh}>
      {needCount === 0 && <p className="text-sm text-gray-500">Nothing needs you right now ✓</p>}
      {discounts}
      {unpaidRows}{unconfirmedRows}{unassignedRows}
    </Card>
  );
  const suggestions = (
    <Card icon="Sparkles" title="Suggestions" meta="Coming soon">
      <p className="text-sm text-gray-400">Rule-based suggestions will appear here.</p>
    </Card>
  );
  const nextSeven = <Card icon="CalendarDays" title="Next 7 days" error={bad} onRetry={refresh} meta={`Booked share of ${(staffLabel || 'staff').toLowerCase()} hours`}><WeekStrip week={data?.week} /></Card>;
  const floorCard = (title, meta) => (
    <Card icon="Users" title={title} meta={meta} error={bad} onRetry={refresh}>
      <Floor floor={floor} nowMin={phase === 'live' ? nowMin : null} open={hours?.open} close={hours?.close} onOpenBooking={openBooking}
        onBookGap={bookGap} staffPlural={(staffLabelPlural || 'staff').toLowerCase()} />
    </Card>
  );

  const myDay = data?.my_day?.bookings?.length > 0 && (
    <section className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-900"><Icon name="User" size={15} /> My day <span className="text-xs text-gray-500 font-normal">{plural(data.my_day.bookings.length, 'booking')}{Number(data.my_day.tips) > 0 ? ` · tips ${npr(data.my_day.tips)}` : ''}</span></div>
      <div className="flex gap-2 overflow-x-auto mt-2">
        {data.my_day.bookings.map((b) => (
          <button key={b.id} type="button" onClick={() => openBooking(b.id)} className="flex-shrink-0 text-left bg-white border border-gray-200 rounded px-3 py-1.5 text-xs">
            <div className="font-medium text-gray-900">{clock12(b.start)} · {b.customer}</div>
            <div className="text-gray-500">{b.service} · {b.status}</div>
          </button>
        ))}
      </div>
    </section>
  );

  const frontDesk = canAct && (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" iconName="Plus" onClick={bookNow}>New booking</Button>
      <Button size="sm" variant="outline" iconName="HandCoins" onClick={() => go('collect-payment')}>Collect payment</Button>
      {MEMBERSHIP_ENABLED && <Button size="sm" variant="outline" iconName="CreditCard" onClick={() => go('new-membership')}>New membership</Button>}
      {VOUCHER_ENABLED && <Button size="sm" variant="outline" iconName="Ticket" onClick={() => go('new-voucher')}>New voucher</Button>}
    </div>
  );

  const brief = (icon, children) => badNeeds ? (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3"><LoadError onRetry={refresh} /></div>
  ) : (
    <div className="flex items-start gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-700"><Icon name={icon} size={16} className="text-gray-500 mt-0.5" /><div>{children}</div></div>
  );
  const sep = <span className="text-gray-300 mx-1.5">·</span>;

  let body;
  if (phase === 'prep') {
    const prepCount = needs.unconfirmed.length + needs.unassigned.length;
    body = (
      <>
        {brief('Sun', <>
          <b>{plural(pulse.bookings || 0, 'booking')}</b> today{sep}<b>{floor?.working ?? 0} of {floor?.headcount ?? 0}</b> {(staffLabelPlural || 'staff').toLowerCase()} in
          {pulse.pending > 0 && <>{sep}<span className="text-warning">{pulse.pending} unconfirmed</span></>}
          {needs.unassigned.length > 0 && <>{sep}<span className="text-warning">{needs.unassigned.length} unassigned</span></>}
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
    const loose = (data?.loose_ends?.open_past_bookings || 0);
    body = (
      <>
        {brief('Moon', <>
          <b>{pulse.completed || 0} of {pulse.bookings || 0}</b> done{pulse.no_show > 0 && <> ({pulse.no_show} no-show)</>}
          {canMoney && <>{sep}<b>{npr(taken)}</b> taken</>}
          {sep}<span className={needs.unpaid.length + loose ? 'text-warning' : ''}>{needs.unpaid.length + loose} loose ends</span>
          {sep}tomorrow {data?.tomorrow?.bookings ?? 0} booked
        </>)}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
          <div className="space-y-3 sm:space-y-4">
            {canMoney && (
              <Card icon="Banknote" title="Today's money" error={bad} onRetry={refresh}>
                <div className="text-sm divide-y divide-gray-100">
                  {Object.entries(data.money.by_method || {}).map(([m, v]) => <div key={m} className="flex justify-between py-1.5"><span className="text-gray-600">{m}</span><b className="font-data">{npr(v)}</b></div>)}
                  <div className="flex justify-between py-1.5"><span className="text-gray-600">Tips (passed to staff, not revenue)</span><b className="font-data">{npr(data.money.tips)}</b></div>
                  <div className="flex justify-between py-2"><b>Cash expected in the drawer</b><b className="font-data">{npr(data.money.cash_expected)}</b></div>
                </div>
                {closed ? (
                  <p className="text-sm text-success font-medium mt-2">Closed at {new Date(closed.closed_at).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kathmandu' })}{closed.closer?.full_name ? ` by ${closed.closer.full_name}` : ''} ✓</p>
                ) : canAct && (
                  <Button className="mt-3" onClick={() => setClosing((v) => !v)}>{closing ? 'Hide closing' : 'Count cash and close the day'}</Button>
                )}
              </Card>
            )}
            {closing && !closed && <DailyClosingPanel branchId={branchId} />}
            <Card icon="Sun" title="Tomorrow" error={bad} onRetry={refresh} meta={data?.tomorrow ? `${data.tomorrow.working} ${(staffLabelPlural || 'staff').toLowerCase()} working` : null}>
              <Row icon="CalendarDays" tone="text-primary" title={plural(data?.tomorrow?.bookings ?? 0, 'booking')} actions={<Button size="sm" variant="outline" onClick={() => go('calendar')}>Open calendar</Button>} />
              {data?.tomorrow?.unconfirmed > 0 && <Row icon="Clock" tone="text-warning" title={`${data.tomorrow.unconfirmed} not confirmed for tomorrow`} />}
            </Card>
          </div>
          <div className="space-y-3 sm:space-y-4">
            <Card icon="CheckCheck" title="Loose ends" count={needs.unpaid.length + loose} error={badNeeds} onRetry={refresh}>
              {needs.unpaid.length + loose === 0 && <p className="text-sm text-success font-medium">Nothing left open ✓</p>}
              {discounts}{unpaidRows}
              {loose > 0 && <Row icon="History" tone="text-warning" title={`${plural(loose, 'earlier booking')} never finished`} sub="Pending, confirmed or in progress from the last 7 days" actions={<Button size="sm" variant="outline" onClick={() => go('bookings')}>Open</Button>} />}
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
          <Tile label="Bookings today" value={pulse.bookings ?? 0} sub={`${split.done} done · ${split.now} now · ${split.toCome} to come`} icon="CalendarDays" onClick={() => go('bookings')} />
          <Tile label="Taken today" value={canMoney ? npr(pulse.revenue) : '—'} sub={canMoney ? (newTenant ? 'No comparison yet' : <Delta now={pulse.revenue} prev={pulse.revenue_prev} unit="%" />) : 'Managers see this'} icon="Banknote" onClick={() => go('all-reports')} />
          <Tile label="Free time left" value={newTenant ? '—' : fmtFreeTotal(free.total)} sub={newTenant ? 'Fills in once you take bookings' : free.biggest ? `${free.total >= 24 * 60 ? `across ${plural(free.people, (staffLabel || 'person').toLowerCase(), (staffLabelPlural || 'people').toLowerCase())} · ` : ''}biggest gap ${fmtClock(free.biggest.from_min)}–${fmtClock(free.biggest.to_min)}` : 'No gaps of 1h or more'} icon="Clock" onClick={() => go('calendar')} />
          <Tile label="Booked hours" value={newTenant || share == null ? '—' : `${Math.round(share * 100)}%`} sub={newTenant ? 'No comparison yet' : <>Of {(staffLabel || 'staff').toLowerCase()} hours · <Delta now={share} prev={pulse.booked_share_prev} unit="pts" /></>} icon="Users" onClick={() => go('all-reports')} />
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
    </div>
  );
};

export default BranchView;
