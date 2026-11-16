import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import SidePanel from '../../../../components/ui/SidePanel';
import { OverflowMenu } from '../../../../components/ui/PanelFormKit';
import { useIndustry } from '../../../../hooks/useIndustry';
import { Avatar, npr } from '../Area/listKit';
import { formatMinutes, timeToMinutes, DB_DOW_LABELS } from '../../../../utils/staffDay';
import { subLine } from '../../../../services/therapistsOverview';
import { TodayCell } from './therapistBits';
import StaffAccessSection from './StaffAccessSection';
import TransferPill from '../../../../components/ui/TransferPill';
import { describeTransfer, transferState } from '../../../../utils/transferText';
import { homeServiceNameSet, servicesBookableHere } from '../../../../utils/visitorServices';
import { toKathmanduParts } from '../calendar/calendarDates';
import { formatClockTime } from '../calendar/timeFormat';
import { useAuth } from '../../../../contexts/AuthContext';
import { useBranch } from '../../../../contexts/BranchContext';
import { fetchTherapistEarnings } from '../../../../services/therapistProfileApi';
import { fetchServices, fetchServiceEligibility } from '../../../../services/api';

// "7–19" / "10:30–19" (whole hours drop the minutes): the week chips are tight.
const shortHour = (t) => { const [h, m] = String(t).split(':'); return m && m !== '00' ? `${Number(h)}:${m}` : `${Number(h)}`; };
// 12-hour without am/pm so a visiting window fits a week cell: "17:25" -> "5:25".
const hour12 = (t) => { const [h, m] = String(t).split(':'); const h12 = Number(h) % 12 || 12; return m && m !== '00' ? `${h12}:${m}` : `${h12}`; };
// "5:25 – 6:25pm": the am/pm is written once when both ends share it.
const rangeText = (a, b) => {
  const f = (t) => formatClockTime(String(t).slice(0, 5), false);
  const [x, y] = [f(a), f(b)];
  return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -2)} – ${y}` : `${x} – ${y}`;
};
const shortRange = (d) => `${shortHour(d.startTime)}–${shortHour(d.endTime)}`;
const minutesOf = (e) => Math.max(0, (timeToMinutes(e.end) ?? 0) - (timeToMinutes(e.start) ?? 0));

const SECTION = 'text-[11.5px] font-medium uppercase tracking-[.05em] text-[#8A8A90]';
const PAY_ROW = 'flex items-center justify-between px-3.5 h-[38px] text-[13px] border-b border-[#F1F1EF] last:border-b-0';

// The read-only right-hand peek (V28): today's bookings, this week's hours, services and (managers / admins only) pay. A fixed overlay, so
// nothing underneath reflows. `t` is a row from services/therapistsOverview. Editing happens on the full profile.
// A VISITOR (ZNLY-113, t.visiting) gets the same panel adapted: the window here instead of a home shift, this branch's bookings, hours set by
// their home branch, the services they can be booked for here, and no pay (the home branch pays them). `branchName` is then the branch visited.
const TherapistPeekPanel = ({ t, branchName, totalServices, canSeeRates, ratesReadable, rosterReadable = true, nowTime, today, menuItems, onOpenCalendar, onClose }) => {
  const { orgSlug } = useParams();
  const { staffLabel, locationLabel } = useIndustry();
  const profileHref = `/${orgSlug}/staff/${t.id}`;
  const { profile } = useAuth();
  const { branchId } = useBranch();
  const visitor = !!t.visiting;
  // While the Edit access panel is open on top, Esc / click-away must reach it (and its discard guard), not close this peek underneath.
  const [editingAccess, setEditingAccess] = useState(false);
  const homeName = t.transfer?.input?.fromBranch || `their home ${locationLabel.toLowerCase()}`;
  const visit = useMemo(() => {
    if (!visitor || !t.transfer) return null;
    const d = describeTransfer(t.transfer.input, { viewpoint: 'receiving', day: today });
    const start = toKathmanduParts(t.transfer.input.startAt);
    const end = toKathmanduParts(t.transfer.input.revertAt);
    const clock = (p) => (p ? formatClockTime(p.time, false) : '');
    const endTxt = end ? (end.date === today ? clock(end) : `${end.date.slice(8)}/${end.date.slice(5, 7)} ${clock(end)}`) : '';
    const pill = d.state === 'upcoming' && d.upcomingLine ? d.upcomingLine : `Visiting${endTxt ? ` · until ${endTxt}` : ''}`;
    // "Here 4:20 – 6:20 pm": only when the window sits inside today; a window that began earlier or ends later reads open-ended.
    const here = start && end && start.date === today && end.date === today ? `Here ${clock(start)} – ${clock(end)}`
      : end ? `Here until ${endTxt}` : 'Here today';
    // The window's own hours on a given day, clipped to that day: '4:20–6:20' (null when the window does not touch the day).
    const hoursOn = (date) => {
      if (!start || !end || date < start.date || date > end.date) return null;
      return `${hour12(start.date === date ? start.time : '00:00')}–${hour12(end.date === date ? end.time : '24:00')}`;
    };
    return { state: d.state, pill, here, hoursOn };
  }, [visitor, t.transfer, today]);
  // "Earned this month": the SAME payroll helper the profile uses (fetchTherapistEarnings -> payrollCalc), admin + admin_viewer only.
  const [earned, setEarned] = useState(null);
  useEffect(() => {
    let live = true;
    setEarned(null);
    if (!canSeeRates || visitor || !t?.id || !today) return undefined;
    fetchTherapistEarnings({ therapistId: t.id, branchId: t.branchId || branchId, periodMonth: today.slice(0, 7), role: profile?.role })
      .then((r) => { if (live && r?.data) setEarned(r.data); });
    return () => { live = false; };
  }, [canSeeRates, visitor, t?.id, today, branchId, profile?.role]);

  // Visitor only: the services they do at home that this branch also offers (the calendar picker's rule, utils/visitorServices).
  const [hereServices, setHereServices] = useState(null);
  useEffect(() => {
    setHereServices(null);
    if (!visitor || !t.id || !t.branchId || !branchId) return undefined;
    let live = true;
    Promise.all([fetchServices(t.branchId), fetchServices(branchId), fetchServiceEligibility()]).then(([home, here, elig]) => {
      if (!live || home?.error || here?.error || elig?.error) return;
      setHereServices(servicesBookableHere(here?.data, homeServiceNameSet(home?.data, elig?.data, t.id)).map((s) => s.name));
    }).catch(() => {});
    return () => { live = false; };
  }, [visitor, t.id, t.branchId, branchId]);
  const shift = t.hours.startTime && t.hours.endTime && !t.hours.isDayOff ? `Shift ${t.hours.startTime.slice(0, 5)} – ${t.hours.endTime.slice(0, 5)}` : null;
  // Lent out today: the right side says where they are (or will be) and when, not the home shift.
  const lent = (() => {
    const inp = t.transfer?.viewpoint === 'home' ? t.transfer.input : null;
    const state = inp ? transferState(inp) : null;
    if (!inp || (state !== 'now' && state !== 'upcoming')) return null;
    const a = toKathmanduParts(inp.startAt); const b = toKathmanduParts(inp.revertAt);
    if (!a || !b || a.date > today || b.date < today) return null;
    return `${state === 'now' ? 'At' : 'To'} ${inp.toBranch || `another ${locationLabel.toLowerCase()}`} ${rangeText(a.date < today ? '00:00' : a.time, b.date > today ? '23:59' : b.time)}`;
  })();
  const nextId = t.bookings.entries.find((e) => e.start >= nowTime && e.status !== 'Completed');
  const extra = [
    t.experienceYears != null ? `${t.experienceYears} year${t.experienceYears === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');
  const serviceList = visitor ? (hereServices || []) : t.serviceNames;
  const chips = serviceList.slice(0, 6);
  const more = serviceList.length - chips.length;

  const header = (
    <div className="px-5 pt-4 pb-4 border-b border-border">
      <div className="flex items-center justify-between h-7 -mt-1">
        <p className="text-[12px] text-[#8A8A90] truncate">{visitor ? `${staffLabel} · From ${homeName}` : `${staffLabel}${branchName ? ` · ${branchName}` : ''}`}</p>
        <div className="flex items-center gap-1">
          <OverflowMenu items={menuItems} />
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-spa text-text-secondary hover:bg-black/[0.05]"><Icon name="X" size={18} /></button>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-1">
        <Avatar name={t.name} size={52} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 id="therapist-peek-title" className="text-[18px] font-semibold tracking-[-0.3px] text-text-primary truncate">{t.name}</h2>
            {visitor && visit && <TransferPill state={visit.state}>{visit.pill}</TransferPill>}
            {!visitor && t.isActive && <TodayCell t={t} pill />}
            {!t.isActive && <span className="h-[22px] px-2 rounded-full bg-[#F1F1EF] text-[11.5px] font-medium text-[#8A8A90] inline-flex items-center">Inactive</span>}
          </div>
          <p className="text-[12.5px] text-[#8A8A90] mt-0.5">
            {[subLine(t), extra].filter(Boolean).join(' · ') || '—'}
            {t.rating != null && <span className="ml-1.5 inline-flex items-center gap-0.5 text-[#515152]"><Icon name="Star" size={11} className="text-[#D4A017]" />{t.rating.toFixed(1)}</span>}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-4 flex-wrap">
        <Link to={profileHref} className="h-9 px-3.5 rounded-md bg-primary text-white text-[13px] font-medium inline-flex items-center gap-2 hover:bg-primary/95"><Icon name="User" size={14} />Open full profile</Link>
        <button type="button" onClick={onOpenCalendar} className="h-9 px-3 rounded-md border border-border bg-white text-[13px] font-medium inline-flex items-center gap-2 hover:bg-[#FAFAF9]"><Icon name="Calendar" size={14} />Calendar</button>
        {t.phone && <a href={`tel:${t.phone.replace(/[^\d+]/g, '')}`} className="h-9 px-3 rounded-md border border-border bg-white text-[13px] font-medium inline-flex items-center gap-2 hover:bg-[#FAFAF9]"><Icon name="Phone" size={14} />{t.phone}</a>}
      </div>
    </div>
  );

  return (
    <SidePanel isOpen title={t.name} header={header} titleId="therapist-peek-title" onClose={editingAccess ? undefined : onClose} width="min(460px, 100vw)">
      <div className="px-5 py-5 space-y-6" data-peek={t.id}>
        <section>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className={SECTION}>Today · {t.bookings.count} booking{t.bookings.count === 1 ? '' : 's'}</h3>
            {visitor ? (visit && <span className="text-[12px] text-[#515152] tabular-nums" data-visit-window>{visit.here}</span>)
              : lent ? <span className="text-[12px] text-[#515152] tabular-nums" data-lent-window>{lent}</span>
              : rosterReadable && shift && <span className="text-[12px] text-[#515152] tabular-nums">{shift}</span>}
          </div>
          {t.bookings.entries.length === 0 ? (
            <p className="text-[13px] text-[#8A8A90] border border-border rounded-lg px-3.5 py-3">Nothing booked today.</p>
          ) : (
            <ul className="border border-border rounded-lg divide-y divide-[#F1F1EF]">
              {t.bookings.entries.map((e, i) => (
                <li key={`${e.bookingId}-${i}`} className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
                  <span className="font-semibold tabular-nums w-[44px]">{e.start}</span>
                  <span className="min-w-0 flex-1 truncate">{[e.service || 'Booking', minutesOf(e) ? `${minutesOf(e)} min` : null, e.customer].filter(Boolean).join(' · ')}</span>
                  {e.status === 'Completed' && <span className="h-[20px] px-2 rounded-full bg-[#F1F1EF] text-[11.5px] font-medium text-[#515152] inline-flex items-center">Done</span>}
                  {e.status === 'In-Progress' && <span className="h-[20px] px-2 rounded-full bg-[#E7F1E4] text-[11.5px] font-medium text-primary inline-flex items-center">Now</span>}
                  {nextId === e && e.status !== 'In-Progress' && <span className="h-[20px] px-2 rounded-full bg-[#E7F1E4] text-[11.5px] font-medium text-primary inline-flex items-center">Next</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {rosterReadable && <section>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className={SECTION}>{visitor ? `This week at ${branchName || `this ${locationLabel.toLowerCase()}`}` : `This week · ${t.weekMinutes ? formatMinutes(t.weekMinutes) : 'no hours set'}`}</h3>
            {visitor ? <span className="text-[12px] text-[#8A8A90]">Other days at {homeName}</span>
              : <Link to={profileHref} className="text-[12px] text-[#8A8A90] hover:text-text-primary">Edit hours in profile</Link>}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {t.weekDays.map((d, i) => {
              const isToday = d.date === today;
              const windowHours = visitor ? visit?.hoursOn(d.date) : null; // the visit's own hours here that day
              const off = visitor ? !windowHours : (d.missing || d.isDayOff);
              const here = !!windowHours;
              return (
                <div key={d.date} data-week-day={d.date} data-visit-here={here || undefined} className={`rounded-lg border px-1 py-1.5 text-center ${isToday ? 'border-primary border-2 py-[5px]' : 'border-border'} ${off ? 'bg-[#FAFAF9] text-[#B4B4BA]' : here ? 'bg-[#F2F6F0]' : ''}`}>
                  <p className="text-[11.5px] font-semibold text-inherit">{DB_DOW_LABELS[i].slice(0, 3)}</p>
                  <p className="text-[11px] tabular-nums text-[#8A8A90] truncate">{visitor ? (windowHours || '—') : d.missing ? '—' : d.isDayOff ? 'Off' : d.openNoHours ? 'Open' : shortRange(d)}</p>
                  {d.source === 'override' && <p className="text-[9.5px] text-[#B45309] font-medium leading-none mt-0.5">changed</p>}
                </div>
              );
            })}
          </div>
        </section>}

        <section>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className={SECTION}>{visitor ? `Bookable here${hereServices ? ` · ${hereServices.length} service${hereServices.length === 1 ? '' : 's'}` : ''}` : `Services · ${t.serviceCount} of ${totalServices}`}</h3>
            {!visitor && <Link to={profileHref} className="text-[12px] text-[#8A8A90] hover:text-text-primary">Manage</Link>}
          </div>
          {visitor && !hereServices ? <p className="text-[13px] text-[#8A8A90]">Loading…</p> : serviceList.length === 0 ? <p className="text-[13px] text-[#8A8A90]">{visitor ? `None of ${t.name.split(' ')[0]}'s services are offered here.` : 'No services yet.'}</p> : (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((n) => <span key={n} className="h-[26px] px-2.5 rounded-full border border-border text-[12.5px] inline-flex items-center bg-white">{n}</span>)}
              {more > 0 && <span className="h-[26px] px-2.5 rounded-full border border-border text-[12.5px] inline-flex items-center bg-white text-[#515152]">+{more} more</span>}
            </div>
          )}
        </section>

        {!visitor && <StaffAccessSection therapistId={t.id} personName={t.name} onEditingChange={setEditingAccess} />}

        {visitor && (
          <section>
            <h3 className={`${SECTION} mb-2`}>Pay</h3>
            <p className="text-[13px] text-[#515152]" data-peek-visitor-pay>Paid by {homeName}.</p>
          </section>
        )}

        {canSeeRates && !visitor && (
          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className={SECTION}>Pay</h3>
              <span className="text-[12px] text-[#8A8A90]">Admins only</span>
            </div>
            {!ratesReadable ? (
              <p className="text-[13px] text-[#8A8A90] border border-border rounded-lg px-3.5 py-3">Pay rates aren't available to your role yet.</p>
            ) : !t.rates ? (
              <p className="text-[13px] text-[#8A8A90] border border-border rounded-lg px-3.5 py-3">No pay set up yet. Add it in their profile.</p>
            ) : (
              <div className="border border-border rounded-lg" data-peek-pay>
                <div className={PAY_ROW}><span>Monthly salary</span><b className="tabular-nums font-semibold">{t.rates.monthlySalary != null ? npr(t.rates.monthlySalary) : '—'}</b></div>
                <div className={PAY_ROW}><span>Service commission</span><b className="tabular-nums font-semibold">{t.rates.servicePct != null ? `${t.rates.servicePct}%` : '—'}</b></div>
                <div className={PAY_ROW}><span>Product commission</span><b className="tabular-nums font-semibold">{t.rates.productPct != null ? `${t.rates.productPct}%` : '—'}</b></div>
                {earned && <div className={PAY_ROW}><span>Earned this month</span><b className="tabular-nums font-semibold" data-peek-earned>{npr(earned.total)}</b></div>}
              </div>
            )}
          </section>
        )}
      </div>
    </SidePanel>
  );
};

export default TherapistPeekPanel;
