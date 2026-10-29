import React, { useCallback, useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import { Card, Row, clock12, npr, plural } from './dashKit';
import { fetchAttendancePunches, punchIn, punchOut } from '../../services/api';
import { myEarnings, nextClient } from '../../lib/dashboardMyDay';
import { friendlyError } from '../../utils/friendlyError';

/**
 * My day (works at 375px): next-client hero, my day list, my earnings (own tips + commission, never anyone else's), Check in / out.
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
  const e = myEarnings(mine);

  return (
    <div className="space-y-3 sm:space-y-4">
      <section className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-4" data-myday-hero>
        {next ? (
          <>
            <div className="text-xs text-gray-500">{next.status === 'In-Progress' ? 'With you now' : 'Next client'}</div>
            <div className="text-lg font-semibold text-gray-900 mt-0.5">{clock12(next.start)} · {next.customer || next.number}</div>
            <div className="text-sm text-gray-600">{next.service}</div>
          </>
        ) : (
          <div className="text-sm text-gray-700">{list.length ? 'No more clients today.' : 'Nothing booked for you today.'}</div>
        )}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Button size="sm" variant={open ? 'outline' : 'primary'} iconName={open ? 'LogOut' : 'LogIn'} disabled={busy || punchError || punches == null} onClick={toggle}>
            {open ? 'Check out' : 'Check in'}
          </Button>
          <Button size="sm" variant="outline" iconName="CalendarOff" disabled title="Leave requests aren't available yet">Request leave</Button>
          {open && <span className="text-xs text-gray-500">Checked in at {open.checkIn}</span>}
          {punchError && <span className="text-xs text-error">Couldn't load attendance. <button type="button" className="underline font-medium" onClick={loadPunches}>Retry</button></span>}
        </div>
        {message && <p className="text-xs text-error mt-2">{message}</p>}
      </section>

      <Card icon="CalendarDays" title="My day" meta={plural(list.length, 'booking')}>
        {list.map((b) => (
          <Row key={b.id} icon={b.status === 'Completed' ? 'CheckCircle2' : b.status === 'In-Progress' ? 'PlayCircle' : 'Clock'}
            tone={b.status === 'Completed' ? 'text-success' : b.status === 'In-Progress' ? 'text-primary' : 'text-gray-500'}
            title={`${clock12(b.start)} · ${b.customer || b.number}`} sub={`${b.service || ''} · ${b.status}`} />
        ))}
      </Card>

      <Card icon="Wallet" title="My earnings today" meta="Only you see this">
        <div className="text-sm divide-y divide-gray-100">
          <div className="flex justify-between py-1.5"><span className="text-gray-600">Tips</span><b className="tabular-nums">{npr(e.tips)}</b></div>
          <div className="flex justify-between py-1.5"><span className="text-gray-600">Commission</span><b className="tabular-nums">{e.commission == null ? 'Not set up' : npr(e.commission)}</b></div>
          <div className="flex justify-between py-2"><b>Total</b><b className="tabular-nums">{npr(e.total)}</b></div>
        </div>
        <p className="text-xs text-gray-400 mt-1 flex items-start gap-1"><Icon name="Info" size={12} className="mt-0.5" /> Commission counts paid, completed bookings. Pay day figures come from Payroll.</p>
      </Card>
    </div>
  );
};

export default MyDayView;
