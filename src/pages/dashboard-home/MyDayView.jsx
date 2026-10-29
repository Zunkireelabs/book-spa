import React, { useCallback, useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import { Card, clock12, npr } from './dashKit';
import { fetchAttendancePunches, punchIn, punchOut } from '../../services/api';
import { dayStatus, myEarnings, nextClient } from '../../lib/dashboardMyDay';
import { fmtClock, fmtDuration, upcomingGaps } from '../../lib/dashboardFloor';
import { friendlyError } from '../../utils/friendlyError';

const ordinal = (n) => { const v = n % 100; return `${n}${['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'}`; };

/**
 * My day (mockup scene E phone, works at 375px): green next-client hero, my day list (Done / Next / Free), my earnings today and this month
 * (own tips + commission, never anyone else's), Check in / out + Request leave as two full-width buttons.
 * `data` is get_dashboard for the branch; its my_day follows the login's linked person (ZNLY-150).
 */
const MyDayView = ({ data, dataError, branchId, today, nowHm, role, staffLabelPlural = 'Staff', onReload }) => {
  const mine = data?.my_day;
  const therapistId = mine?.therapist_ids?.[0] || null;
  const [punches, setPunches] = useState(null);
  const [punchError, setPunchError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const loadPunches = useCallback(async () => {
    if (!therapistId) return;
    const { data: rows, error } = await fetchAttendancePunches({ date: today, therapistId });
    setPunchError(!!error);
    if (!error) setPunches(rows);
  }, [therapistId, today]);
  useEffect(() => { loadPunches(); }, [loadPunches]);

  if (dataError) return <Card icon="User" title="My day" error onRetry={onReload} />;
  if (!data) return <Card icon="User" title="My day"><p className="text-sm text-gray-500">Loading…</p></Card>;
  if (!therapistId) {
    return (
      <Card icon="User" title="My day">
        <p className="text-sm text-gray-700">Your login isn't linked to a person yet, so there is no day to show.</p>
        <p className="text-xs text-gray-500 mt-1">{role === 'manager' || role === 'admin'
          ? `Link it in ${staffLabelPlural} → open yourself → Login.`
          : `Ask your manager to link it in the ${staffLabelPlural} list (Login field).`}</p>
      </Card>
    );
  }

  const open = (punches || []).find((p) => !p.checkOut);
  const toggle = async () => {
    setBusy(true); setMessage(null);
    const res = open ? await punchOut({ punchId: open.id }) : await punchIn({ therapistId, branchId });
    setBusy(false);
    if (res.error) setMessage(friendlyError(res.error, res.error.message || 'Could not save that.'));
    loadPunches();
  };

  const list = mine.bookings || [];
  const next = nextClient(list, nowHm);
  const earnToday = myEarnings(mine);
  const month = myEarnings(mine, 'month');
  const toMin = (t) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5));
  const nowMin = toMin(nowHm);
  const day = dayStatus(list, nowHm);
  const done = day.done;

  // The timeline: my bookings plus my free gaps (an hour or more, still ahead), in time order.
  const gaps = upcomingGaps((data.floor?.[0]?.therapists || []).find((t) => t.therapist_id === therapistId)?.gaps, nowMin);
  const timeline = [...list.map((b) => ({ at: toMin(b.start), b })), ...gaps.map((g) => ({ at: g.from_min, gap: g }))].sort((x, y) => x.at - y.at);

  const startsIn = next && next.status !== 'In-Progress' ? toMin(next.start) - nowMin : null;
  const kicker = !next ? null : next.status === 'In-Progress' ? 'WITH YOU NOW'
    : startsIn > 0 ? `YOUR NEXT CLIENT IN ${fmtDuration(startsIn).replace(/m$/, ' MIN').toUpperCase()}` : 'YOUR NEXT CLIENT IS DUE';
  const meta = next && [`${clock12(next.start)}`, next.room, next.visit ? `${ordinal(next.visit)} visit` : null].filter(Boolean).join(' · ');
  const chip = (b) => (b.status === 'Completed' ? ['Done', 'bg-gray-100 text-gray-500']
    : b.status === 'In-Progress' ? ['With client', 'bg-primary/10 text-primary']
      : next && b.id === next.id ? ['Next', 'bg-primary/10 text-primary']
        : toMin(b.start) < nowMin ? ['Late', 'bg-warning/10 text-warning'] : ['Booked', 'bg-gray-100 text-gray-500']);

  return (
    <div className="space-y-3 sm:space-y-4 max-w-xl">
      <section className="rounded-xl bg-primary text-white px-4 py-4" data-myday-hero>
        {next ? (
          <>
            <div className="text-[11.5px] tracking-wide opacity-75">{clock12(nowHm).toUpperCase()} · {kicker}</div>
            <div className="text-lg font-semibold mt-1">{next.customer || next.number} · {next.service}</div>
            <div className="text-[12.5px] opacity-85">{meta}</div>
          </>
        ) : (
          <div className="text-sm">{!list.length ? 'Nothing booked for you today.' : day.allClosed ? 'All done for today.' : `No more clients today · ${day.open} not closed yet`}</div>
        )}
      </section>

      {list.length > 0 && (
        <Card title="My day" meta={`${done} of ${list.length} done`}>
          <div className="-mx-4 -my-4">
            {timeline.map((it) => it.b ? (
              <div key={it.b.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 last:border-0">
                <span className="font-data text-xs text-gray-600 w-[62px] flex-shrink-0">{clock12(it.b.start)}</span>
                <div className="min-w-0 flex-1 text-sm font-medium text-gray-900 truncate">{[it.b.customer || it.b.number, it.b.service].filter(Boolean).join(' · ')}</div>
                <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${chip(it.b)[1]}`}>{chip(it.b)[0]}</span>
              </div>
            ) : (
              <div key={`g${it.at}`} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 last:border-0">
                <span className="font-data text-xs text-gray-600 w-[62px] flex-shrink-0">{fmtClock(it.gap.from_min)}</span>
                <div className="min-w-0 flex-1 text-sm text-gray-400">—</div>
                <span className="text-[11px] font-medium rounded-full px-2 py-0.5 bg-gray-100 text-gray-500">Free</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="My earnings" meta="Only you see this">
        <div className="text-sm">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-5 text-[11px] text-gray-500 pb-1"><span /><span className="text-right w-24">Today</span><span className="text-right w-24">This month</span></div>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-5 py-1.5 border-t border-gray-100"><span className="text-gray-600">Commission</span><b className="font-data text-right w-24">{earnToday.commission == null ? 'Not set up' : npr(earnToday.commission)}</b><b className="font-data text-right w-24">{month.commission == null ? 'Not set up' : npr(month.commission)}</b></div>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-5 py-1.5 border-t border-gray-100"><span className="text-gray-600">Tips</span><b className="font-data text-right w-24">{npr(earnToday.tips)}</b><b className="font-data text-right w-24">{npr(month.tips)}</b></div>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-5 py-2 border-t border-gray-100"><b>Total</b><b className="font-data text-right w-24">{npr(earnToday.total)}</b><b className="font-data text-right w-24">{npr(month.total)}</b></div>
        </div>
        <p className="text-xs text-gray-400 mt-1">Commission counts paid, completed bookings. Pay day figures come from Payroll.</p>
      </Card>

      <div className="flex gap-2">
        <Button className="flex-1" variant={open ? 'outline' : 'primary'} iconName={open ? 'LogOut' : 'LogIn'} disabled={busy || punchError || punches == null} onClick={toggle}>
          {open ? 'Check out' : 'Check in'}
        </Button>
        <Button className="flex-1" variant="outline" iconName="CalendarOff" disabled title="Leave requests aren't available yet">Request leave</Button>
      </div>
      {open && <p className="text-xs text-gray-500">Checked in at {open.checkIn}</p>}
      {punchError && <p className="text-xs text-error">Couldn't load attendance. <button type="button" className="underline font-medium" onClick={loadPunches}>Retry</button></p>}
      {message && <p className="text-xs text-error">{message}</p>}
    </div>
  );
};

export default MyDayView;
