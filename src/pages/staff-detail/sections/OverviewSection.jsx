import React, { useState } from 'react';
import { dbDowOfDate, DB_DOW_LABELS, formatMinutes, dayWorkingMinutes, NO_HOURS_LABEL } from '../../../utils/staffDay';
import { buildTimeline } from '../profileModel';
import { Loading, Problem, Fig, Figs, npr } from './ui';
import { SHADE_STYLES } from '../../../services/availabilityShading';
import { formatClockNow, formatClockRange } from '../../../utils/clockTime';
import { readUse24h } from '../../../utils/clockPref';

const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const short = (t) => formatClockNow(String(t || '').slice(0, 5));
const STATUS_WORD = { Completed: 'Done', 'In-Progress': 'In progress', Confirmed: 'Confirmed', Pending: 'Pending' };

const BLOCK = {
  done: 'bg-[#EEF3EC] text-[#3D5E37]',
  next: 'bg-primary text-white shadow-[0_4px_12px_rgba(45,90,39,.25)]',
  up: 'bg-surface border border-[#D9E3D6] text-text-primary',
};

// The shift as a track: booking blocks (next one highlighted), breaks hatched, a red now-line, an hour scale.
// A block opens the booking's right-hand panel; hover shows the full service, duration, customer and status.
const TodayTimeline = ({ model, onOpenBooking, openCalendar }) => {
  const [hover, setHover] = useState(null);
  const n = model.ticks.length - 1;
  const hatch = 'bg-[repeating-linear-gradient(135deg,#F3F3F1_0_6px,#ECECEA_6px_12px)]';
  return (
    <div className="mt-4">
      <div
        className={`relative rounded-xl border border-border bg-background ${model.lanes === 2 ? 'h-24' : 'h-16'}`}
        style={{ backgroundImage: `repeating-linear-gradient(90deg,transparent 0,transparent calc(100%/${n} - 1px),#EEEEEC calc(100%/${n} - 1px),#EEEEEC calc(100%/${n}))` }}
      >
        {model.breaks.map((b, i) => (
          <div
            key={i} title={`${b.name || 'Break'} ${formatClockRange(String(b.startTime || '').slice(0, 5), String(b.endTime || '').slice(0, 5), readUse24h())}`}
            className={`absolute top-2 bottom-2 rounded-lg border border-dashed border-[#DADAD6] ${hatch} px-2 py-1.5 text-xs text-text-secondary overflow-hidden whitespace-nowrap`}
            style={{ left: `calc(${b.left}% + 2px)`, width: `calc(${b.width}% - 4px)` }}
          >{b.name || 'Break'}</div>
        ))}
        {model.transferSlot && (
          <div
            data-transfer-slot title={model.transferSlot.title || model.transferSlot.label}
            className="absolute top-2 bottom-2 rounded-lg border border-border px-2 py-1.5 text-xs text-text-secondary overflow-hidden whitespace-nowrap"
            style={{ left: `calc(${model.transferSlot.left}% + 2px)`, width: `calc(${model.transferSlot.width}% - 4px)`, background: SHADE_STYLES.branch.background }}
          >{model.transferSlot.label}</div>
        )}
        {model.blocks.map((b) => (
          <button
            key={b.id + b.startTime} type="button" onClick={() => onOpenBooking(b)}
            onMouseEnter={() => setHover(b)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(b)} onBlur={() => setHover(null)}
            aria-label={`${b.serviceName}, ${short(b.startTime)} to ${short(b.endTime)}, ${b.customerName || 'no name'}`}
            className={`absolute rounded-lg px-2 py-1 text-left text-xs leading-tight overflow-hidden whitespace-nowrap cursor-pointer transition hover:-translate-y-px hover:shadow-spa-elevated ${BLOCK[b.kind]} ${model.lanes === 2 ? 'h-[calc(50%-9px)]' : 'top-2 bottom-2'} ${model.lanes === 2 ? (b.lane === 0 ? 'top-1.5' : 'bottom-1.5') : ''}`}
            style={{ left: `calc(${b.left}% + 2px)`, width: `calc(${b.width}% - 4px)` }}
          >
            <b className="block font-semibold truncate">{b.serviceName}</b>
            {model.lanes === 1 && <span className="block truncate opacity-80">{short(b.startTime)} · {b.minutes} min{b.customerName ? ` · ${b.customerName}` : ''}</span>}
          </button>
        ))}
        {model.nowPct != null && (
          <div aria-label="Now" className="absolute top-0 bottom-0 w-0.5 bg-error rounded pointer-events-none" style={{ left: `${model.nowPct}%` }}>
            <span className="absolute -top-1 -left-[3px] w-2 h-2 rounded-full bg-error" />
          </div>
        )}
        {model.hidden > 0 && (
          <button type="button" onClick={openCalendar} className="absolute -top-2.5 right-2 px-2 h-5 rounded-full bg-text-primary text-white text-xs font-medium">+{model.hidden} more</button>
        )}
        {hover && (
          <div
            role="tooltip" className="absolute z-sticky-filter -top-[72px] px-3 py-2 rounded-lg bg-text-primary text-white text-xs shadow-spa-elevated pointer-events-none whitespace-nowrap"
            style={{ left: `clamp(0px, ${hover.left}%, calc(100% - 230px))` }}
          >
            <p className="font-semibold">{hover.serviceName}</p>
            <p className="opacity-80">{formatClockRange(String(hover.startTime || '').slice(0, 5), String(hover.endTime || '').slice(0, 5), readUse24h())} · {hover.minutes} min · {STATUS_WORD[hover.status] || hover.status}</p>
            {hover.customerName && <p className="opacity-80">{hover.customerName}</p>}
          </div>
        )}
      </div>
      <div className="flex justify-between mt-1.5 text-xs text-text-tertiary tabular-nums">
        {model.ticks.map((m, i) => <span key={m}>{i === 0 || i === n ? hhmm(m) : String(Math.floor(m / 60))}</span>)}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-sm text-text-secondary">
        <span><b className="font-semibold text-text-primary">{model.done}</b> done</span>
        <span><b className="font-semibold text-text-primary">{model.toCome}</b> to come{model.next ? ` · next at ${short(model.next.startTime)}` : ''}</span>
        {model.gap && <span><b className="font-semibold text-text-primary">{formatMinutes(model.gap.to - model.gap.from)}</b> free · {hhmm(model.gap.from)} – {hhmm(model.gap.to)}</span>}
      </div>
    </div>
  );
};

const Spark = ({ now = [], last = [] }) => {
  if (now.length < 2) return null;
  const max = Math.max(1, ...now, ...last); const w = 64; const h = 18;
  const pts = (a) => a.map((v, i) => `${(i / (a.length - 1)) * w},${h - 2 - (v / max) * (h - 4)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden className="ml-1.5">
      {last.length > 1 && <polyline points={pts(last)} fill="none" stroke="#C9C9CE" strokeWidth="1.5" strokeLinejoin="round" />}
      <polyline points={pts(now)} fill="none" stroke="#2D5A27" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

// Small bars, one per day: hatched where a break is taken off, amber where the roster changed the day, dark green for today.
const WeekBars = ({ week, today }) => (
  <div className="grid grid-cols-7 gap-1.5 items-end h-24 mt-3">
    {week.map((d) => {
      const off = d.hours?.isDayOff || d.hours?.missing;
      const mins = off ? 0 : dayWorkingMinutes({ startTime: d.hours.startTime, endTime: d.hours.endTime, isDayOff: false, breaks: d.hours.breaks });
      const full = off ? 0 : dayWorkingMinutes({ startTime: d.hours.startTime, endTime: d.hours.endTime, isDayOff: false, breaks: [] });
      const brk = Math.max(0, full - mins);
      const isToday = d.date === today;
      const label = DB_DOW_LABELS[dbDowOfDate(d.date)].slice(0, 3);
      const tip = off ? `${label}: day off` : d.hours.openNoHours ? `${label}: ${NO_HOURS_LABEL} · bookable in branch hours ${short(d.hours.startTime)}–${short(d.hours.endTime)}` : `${label}: ${formatClockRange(String(d.hours.startTime || '').slice(0, 5), String(d.hours.endTime || '').slice(0, 5), readUse24h())} · ${formatMinutes(mins)}${d.changed ? ' · changed on the roster' : ''}`;
      const barH = off ? 6 : Math.max(8, (full / 600) * 56);
      return (
        <div key={d.date} title={tip} className="flex flex-col items-center justify-end gap-1 h-full text-xs text-text-secondary">
          <div className={`w-full rounded-md relative overflow-hidden ${off ? 'border border-dashed border-border' : isToday ? 'bg-primary' : d.changed ? 'bg-amber-300' : 'bg-[#DCE7D9]'}`} style={{ height: barH }}>
            {brk > 0 && <em className="absolute left-0 right-0 not-italic bg-[repeating-linear-gradient(135deg,rgba(255,255,255,.7)_0_2px,transparent_2px_4px]" style={{ height: `${(brk / full) * 100}%`, top: '38%' }} />}
          </div>
          <span className={isToday ? 'font-semibold text-primary' : ''}>{label}</span>
        </div>
      );
    })}
  </div>
);

const OverviewSection = ({ data, loading, error, onRetry, today, nowTime, isServiceStaff, attendanceRows, onOpenBooking, openCalendar, showCommission = true, hoursHidden = false, transferToday = null }) => {
  if (loading && !data) return <Loading />;
  if (error) return <Problem message={error} onRetry={onRetry} />;
  if (!data) return null;
  const m = data.month || {};
  const week = data.week || [];
  const weekMinutes = week.reduce((sum, d) => sum + dayWorkingMinutes({ startTime: d.hours?.startTime, endTime: d.hours?.endTime, isDayOff: d.hours?.isDayOff || d.hours?.openNoHours, breaks: d.hours?.breaks }), 0);
  const monthName = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  const prev = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const lastName = prev.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });

  // Support staff: attendance figures only. No bookings, revenue or commission anywhere.
  if (!isServiceStaff) {
    const rows = attendanceRows || [];
    const worked = rows.filter((r) => r.status === 'on-time' || r.status === 'late').length;
    const scheduled = rows.filter((r) => ['on-time', 'late', 'absent', 'leave'].includes(r.status)).length;
    const leave = rows.filter((r) => r.status === 'leave').length;
    const late = rows.filter((r) => r.status === 'late').length;
    const nextOff = week.find((d) => d.date > today && (d.hours?.isDayOff && !d.hours?.missing));
    return (
      <Figs>
        <Fig label="Shifts worked" value={worked} detail={scheduled ? `of ${scheduled}${leave ? ` · ${leave} day${leave === 1 ? '' : 's'} of leave` : ''}` : 'no attendance this month'} />
        <Fig label="On time" value={m.onTimePct != null ? `${Math.round(m.onTimePct)}%` : '—'} detail={m.onTimeSample ? `${late} late in ${m.onTimeSample} shift${m.onTimeSample === 1 ? '' : 's'}` : 'no check-ins yet'} />
        {!hoursHidden && <Fig label="Hours this week" value={formatMinutes(weekMinutes)} detail="breaks taken off" />}
        {!hoursHidden && <Fig label="Next day off" value={nextOff ? DB_DOW_LABELS[dbDowOfDate(nextOff.date)].slice(0, 3) : '—'} detail={nextOff ? new Date(`${nextOff.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'none this week'} />}
      </Figs>
    );
  }

  const model = buildTimeline({ bookings: data.todayBookings, shift: week.find((d) => d.date === today)?.hours, nowTime, transfer: transferToday });
  const delta = m.bookingsLastMonthSameDays != null ? m.bookings - m.bookingsLastMonthSameDays : null;
  const avgVisit = m.paidVisits ? m.serviceRevenue / m.paidVisits : null;
  const top = data.topServices || [];
  const topMax = Math.max(1, ...top.map((s) => s.count));

  return (
    <div>
      {model ? <TodayTimeline model={model} onOpenBooking={onOpenBooking} openCalendar={openCalendar} />
        : <p className="mt-4 text-sm text-text-secondary">No bookings or shift today.</p>}

      <Figs>
        <Fig
          label={`Bookings · ${monthName}`} value={m.bookings ?? '—'}
          detail={<>{delta != null && <span className={delta >= 0 ? 'text-success font-medium' : 'text-error font-medium'}>{delta >= 0 ? '↑' : '↓'} {Math.abs(delta)} vs {lastName}</span>}<Spark now={data.series?.thisMonth} last={data.series?.lastMonth} /></>}
        />
        <Fig label="Service revenue" unit="NPR" value={Math.round(Number(m.serviceRevenue) || 0).toLocaleString('en-IN')} detail={avgVisit ? `avg ${npr(avgVisit)} / visit` : 'completed and paid'} />
        {showCommission && m.commissionEarned != null && <Fig label="Commission" unit="NPR" value={Math.round(Number(m.commissionEarned) || 0).toLocaleString('en-IN')} detail={m.commissionNote || "Payroll's figure"} />}
        <Fig label="On time" value={m.onTimePct != null ? `${Math.round(m.onTimePct)}%` : '—'} detail={m.onTimeSample ? `${m.onTimeSample} shift${m.onTimeSample === 1 ? '' : 's'} checked` : 'no attendance this month'} />
      </Figs>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-8 mt-8">
        {!hoursHidden && (
          <div>
            <p className="text-sm font-medium text-text-primary">This week · {formatMinutes(weekMinutes)}</p>
            <WeekBars week={week} today={today} />
          </div>
        )}
        <div>
          <p className="text-sm font-medium text-text-primary">Most booked · {monthName}</p>
          {top.length === 0 ? <p className="mt-3 text-sm text-text-secondary">No bookings yet this month.</p> : (
            <ul className="mt-2">
              {top.map((s) => (
                <li key={s.name} className="flex items-center gap-3 h-[30px] text-sm">
                  <span className="w-36 truncate text-text-primary">{s.name}</span>
                  <span className="flex-1 h-1 rounded-full bg-[#EFEFED] overflow-hidden"><span className="block h-full rounded-full bg-[#7FA877]" style={{ width: `${(s.count / topMax) * 100}%` }} /></span>
                  <span className="w-6 text-right tabular-nums text-text-secondary">{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default OverviewSection;
