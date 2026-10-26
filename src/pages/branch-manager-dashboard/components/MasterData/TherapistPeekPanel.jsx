import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import SidePanel from '../../../../components/ui/SidePanel';
import { OverflowMenu } from '../../../../components/ui/PanelFormKit';
import { useIndustry } from '../../../../hooks/useIndustry';
import { Avatar, npr } from '../Area/listKit';
import { formatMinutes, timeToMinutes, DB_DOW_LABELS } from '../../../../utils/staffDay';
import { subLine } from '../../../../services/therapistsOverview';
import { TodayCell } from './therapistBits';
import { useAuth } from '../../../../contexts/AuthContext';
import { useBranch } from '../../../../contexts/BranchContext';
import { fetchTherapistEarnings } from '../../../../services/therapistProfileApi';

// "7–19" / "10:30–19" (whole hours drop the minutes): the week chips are tight.
const shortHour = (t) => { const [h, m] = String(t).split(':'); return m && m !== '00' ? `${Number(h)}:${m}` : `${Number(h)}`; };
const shortRange = (d) => `${shortHour(d.startTime)}–${shortHour(d.endTime)}`;
const minutesOf = (e) => Math.max(0, (timeToMinutes(e.end) ?? 0) - (timeToMinutes(e.start) ?? 0));

const SECTION = 'text-[11.5px] font-medium uppercase tracking-[.05em] text-[#8A8A90]';
const PAY_ROW = 'flex items-center justify-between px-3.5 h-[38px] text-[13px] border-b border-[#F1F1EF] last:border-b-0';

// The read-only right-hand peek (V28): today's bookings, this week's hours, services and (managers / admins only) pay. A fixed overlay, so
// nothing underneath reflows. `t` is a row from services/therapistsOverview. Editing happens on the full profile.
const TherapistPeekPanel = ({ t, branchName, totalServices, canSeeRates, ratesReadable, rosterReadable = true, nowTime, today, menuItems, onOpenCalendar, onClose }) => {
  const { orgSlug } = useParams();
  const { staffLabel } = useIndustry();
  const profileHref = `/${orgSlug}/staff/${t.id}`;
  const { profile } = useAuth();
  const { branchId } = useBranch();
  // "Earned this month": the SAME payroll helper the profile uses (fetchTherapistEarnings -> payrollCalc), admin + admin_viewer only.
  const [earned, setEarned] = useState(null);
  useEffect(() => {
    let live = true;
    setEarned(null);
    if (!canSeeRates || !t?.id || !today) return undefined;
    fetchTherapistEarnings({ therapistId: t.id, branchId: t.branchId || branchId, periodMonth: today.slice(0, 7), role: profile?.role })
      .then((r) => { if (live && r?.data) setEarned(r.data); });
    return () => { live = false; };
  }, [canSeeRates, t?.id, today, branchId, profile?.role]);
  const shift = t.hours.startTime && t.hours.endTime && !t.hours.isDayOff ? `Shift ${t.hours.startTime.slice(0, 5)} – ${t.hours.endTime.slice(0, 5)}` : null;
  const nextId = t.bookings.entries.find((e) => e.start >= nowTime && e.status !== 'Completed');
  const extra = [
    t.experienceYears != null ? `${t.experienceYears} year${t.experienceYears === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');
  const chips = t.serviceNames.slice(0, 6);
  const more = t.serviceNames.length - chips.length;

  const header = (
    <div className="px-5 pt-4 pb-4 border-b border-border">
      <div className="flex items-center justify-between h-7 -mt-1">
        <p className="text-[12px] text-[#8A8A90] truncate">{staffLabel}{branchName ? ` · ${branchName}` : ''}</p>
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
            {t.isActive && <TodayCell t={t} pill />}
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
    <SidePanel isOpen title={t.name} header={header} titleId="therapist-peek-title" onClose={onClose} width="min(460px, 100vw)">
      <div className="px-5 py-5 space-y-6" data-peek={t.id}>
        <section>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className={SECTION}>Today · {t.bookings.count} booking{t.bookings.count === 1 ? '' : 's'}</h3>
            {rosterReadable && shift && <span className="text-[12px] text-[#515152] tabular-nums">{shift}</span>}
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
            <h3 className={SECTION}>This week · {t.weekMinutes ? formatMinutes(t.weekMinutes) : 'no hours set'}</h3>
            <Link to={profileHref} className="text-[12px] text-[#8A8A90] hover:text-text-primary">Edit hours in profile</Link>
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {t.weekDays.map((d, i) => {
              const off = d.missing || d.isDayOff;
              const isToday = d.date === today;
              return (
                <div key={d.date} data-week-day={d.date} className={`rounded-lg border px-1 py-1.5 text-center ${isToday ? 'border-primary border-2 py-[5px]' : 'border-border'} ${off ? 'bg-[#FAFAF9] text-[#B4B4BA]' : ''}`}>
                  <p className="text-[11.5px] font-semibold text-inherit">{DB_DOW_LABELS[i].slice(0, 3)}</p>
                  <p className="text-[11px] tabular-nums text-[#8A8A90]">{d.missing ? '—' : d.isDayOff ? 'Off' : d.openNoHours ? 'Open' : shortRange(d)}</p>
                  {d.source === 'override' && <p className="text-[9.5px] text-[#B45309] font-medium leading-none mt-0.5">changed</p>}
                </div>
              );
            })}
          </div>
        </section>}

        <section>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className={SECTION}>Services · {t.serviceCount} of {totalServices}</h3>
            <Link to={profileHref} className="text-[12px] text-[#8A8A90] hover:text-text-primary">Manage</Link>
          </div>
          {t.serviceNames.length === 0 ? <p className="text-[13px] text-[#8A8A90]">No services yet.</p> : (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((n) => <span key={n} className="h-[26px] px-2.5 rounded-full border border-border text-[12.5px] inline-flex items-center bg-white">{n}</span>)}
              {more > 0 && <span className="h-[26px] px-2.5 rounded-full border border-border text-[12.5px] inline-flex items-center bg-white text-[#515152]">+{more} more</span>}
            </div>
          )}
        </section>

        {canSeeRates && (
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
