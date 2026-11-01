import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import { useAuth } from '../../../../contexts/AuthContext';
import { useOrg } from '../../../../contexts/OrgContext';
import { durationText } from 'utils/durationText';
import { shortDate, dayRange, dayChips, hhmmOf } from './therapistInnerView';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HATCH = { backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 4px, rgba(0,0,0,0.07) 4px 5px)' };
const TONE = { ok: 'bg-primary/10 text-primary', warn: 'bg-warning/10 text-warning', blue: 'bg-blue-500/10 text-blue-600', plain: 'bg-black/[0.06] text-text-secondary' };
const weekdayOf = (iso) => { const [y, m, d] = iso.split('-').map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; };
const prettyDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${shortDate(iso)}`; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const Card = ({ title, aside, children }) => (
  <div className="bg-surface rounded-spa-lg border border-border">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 pt-3 pb-2"><h3 className="font-heading font-heading-semibold text-sm text-text-primary">{title}</h3>{aside && <span className="text-[11.5px] text-text-tertiary">{aside}</span>}</div>
    {children}
  </div>
);
const Tile = ({ icon, label, value, unit, sub }) => (
  <div className="bg-surface rounded-spa-lg border border-border p-4">
    <div className="flex items-center gap-2 text-[13px] text-text-secondary"><Icon name={icon} size={15} />{label}</div>
    <div className="mt-2 font-data tabular-nums text-2xl font-semibold text-text-primary">{value}{unit && <>{' '}<span className="ml-1 text-[12px] font-normal text-text-tertiary">{unit}</span></>}</div>
    <div className="mt-1 text-[11.5px] text-text-tertiary leading-snug">{sub}</div>
  </div>
);
const Chip = ({ tone, children }) => <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>{children}</span>;

// One calendar square: colour = what happened; the label under the number says it in words (colour is never the only cue).
function squareOf(d) {
  const flagged = d.lateMin || d.earlyMin;
  switch (d.kind) {
    case 'present': case 'extra': return flagged ? { cls: 'bg-warning text-white', label: [d.lateMin && 'late', d.earlyMin && 'early'].filter(Boolean).join(' · ') } : { cls: 'bg-primary text-white', label: d.kind === 'extra' ? 'extra day' : 'present' };
    case 'half': return { cls: 'bg-warning/25 text-warning', label: 'half day' };
    case 'absent': return { cls: 'border-2 border-warning text-warning', label: 'absent' };
    case 'leave': return { cls: 'bg-blue-500 text-white', label: d.label.replace(' Leave', '').toLowerCase() };
    case 'noCheckin': return { cls: 'bg-success/25 text-primary', label: 'no check-in' };
    case 'notRostered': return { cls: 'border border-border text-text-tertiary', label: d.reason === 'no shift' ? 'off' : 'blocked', style: HATCH };
    case 'today': return { cls: 'border border-dashed border-primary text-text-secondary', label: 'today' };
    case 'future': return { cls: 'border border-dashed border-border text-text-tertiary opacity-40', label: '' };
    default: return { cls: 'border border-dashed border-border bg-black/[0.02] text-text-tertiary', label: '' };
  }
}

function MonthGrid({ days, year, month, markLink = null }) {
  const first = days[0];
  const cells = [...Array(weekdayOf(first.date)).fill(null), ...days];
  return (
    <div className="px-4 pb-3">
      <div className="mb-1.5 text-[12px] font-medium text-text-secondary">{MONTHS[month]} {year}</div>
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5 text-center">
        {WEEKDAY.map((w) => <div key={w} className="text-[11px] text-text-tertiary pb-0.5">{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const sq = squareOf(d);
          const tip = d.kind === 'notRostered' ? `${shortDate(d.date)} · not rostered: ${d.reason}` : `${shortDate(d.date)}: ${d.kind === 'future' ? 'upcoming' : d.label}`;
          const link = (d.kind === 'notMarked' || d.kind === 'noCheckin') && markLink ? markLink(d.date) : null;
          const linkTip = d.kind === 'noCheckin' ? `Add clock times for ${shortDate(d.date)}` : `Mark attendance for ${shortDate(d.date)}`;
          return (
            <div key={d.date} title={link ? linkTip : tip} aria-label={link ? linkTip : tip} style={sq.style} onClick={link || undefined} role={link ? 'link' : undefined}
              className={`rounded-md h-9 sm:h-10 flex flex-col items-center justify-center leading-none ${sq.cls} ${link ? 'cursor-pointer hover:bg-black/[0.06]' : ''}`}>
              <span className="font-data tabular-nums text-[11px]">{Number(d.date.slice(8))}</span>
              {sq.label && <span className="hidden sm:block text-[9px] mt-0.5 opacity-90">{sq.label}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The inner page's Attendance tab (ZNLY-172 V37g). Everything comes from attendanceDays (the Overview reads the same output): each day is judged against
// the therapist's own shift, Worked exists only when both clock times were recorded, and an unmarked day is unknown, never absent.
const AttendanceTab = ({ ov, onRetry, therapistId, therapistName, range, canMark = false }) => {
  const { profile } = useAuth();
  const { org } = useOrg();
  const navigate = useNavigate();
  const att = ov.data?.attendance;
  const first = String(therapistName || '').split(' ')[0];
  // Marking happens in the dashboard's Attendance view (the /attendance-calendar page is read-only); it needs one branch, so not in Overall.
  const canMark2 = canMark && ['manager', 'admin'].includes(profile?.role);
  const markLink = canMark2 ? (date) => () => navigate(`/${org?.slug}/dashboard?view=attendance&date=${date}&therapist=${therapistId}`) : null;

  const months = useMemo(() => {
    if (!att) return [];
    const out = [];
    for (const d of att.days) {
      const key = d.date.slice(0, 7);
      const last = out[out.length - 1];
      if (last && last.key === key) last.days.push(d); else out.push({ key, year: Number(key.slice(0, 4)), month: Number(key.slice(5)) - 1, days: [d] });
    }
    return out;
  }, [att]);

  if (ov.loading) return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 bg-background rounded-spa-lg animate-pulse" />)}</div>;
  if (ov.error || !att) {
    return (
      <div className="bg-warning/10 border border-warning/30 rounded-spa p-4 flex items-center gap-3">
        <Icon name="AlertCircle" size={18} className="text-warning flex-shrink-0" />
        <p className="font-body text-sm text-text-primary">{ov.error || 'Failed to load attendance.'}</p>
        <button onClick={onRetry} className="ml-auto font-body font-body-medium text-sm text-primary underline">Retry</button>
      </div>
    );
  }

  const t = att.totals;
  const period = dayRange(range.fromDate, range.toDate);
  if (t.rosteredDays === 0 && t.markedDays === 0) {
    return <div className="p-12 text-center bg-surface rounded-spa-lg border border-border"><Icon name="Clock" size={32} className="text-text-tertiary mx-auto mb-3" /><p className="font-body text-sm text-text-tertiary">No roster and no attendance for {therapistName} in {period}.</p></div>;
  }

  const marked = att.days.filter((d) => d.marked);
  const markedList = [...marked].reverse();
  const clockDays = att.days.filter((d) => d.workedMin != null);
  const lateN = clockDays.filter((d) => d.lateMin).length;
  const earlyN = clockDays.filter((d) => d.earlyMin).length;
  const mr = marked.filter((d) => d.rostered);
  const kindN = (...k) => mr.filter((d) => k.includes(d.kind)).length;
  const presentN = kindN('present', 'half'); const absentN = kindN('absent'); const leaveN = kindN('leave');
  const bits = [];
  if (presentN) bits.push(mr.length === presentN ? (presentN === 1 ? 'present on that day' : presentN === 2 ? 'present on both' : `present on all ${presentN}`) : `present on ${presentN}`);
  if (absentN) bits.push(`absent on ${absentN}`);
  if (leaveN) bits.push(`on leave or day off on ${leaveN}`);
  const clockClause = t.clockDays === 0 ? 'no clock times were recorded' : t.clockDays === t.markedDays ? 'clock times were recorded on all of them' : `clock times were recorded on ${t.clockDays} of them`;
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  const extraClause = t.extraDays ? ` Plus ${plural(t.extraDays, 'extra day')} with no shift.` : '';
  const shiftSet = [...new Set(att.days.filter((d) => d.rostered).map((d) => `${hhmmOf(d.shiftStart)}–${hhmmOf(d.shiftEnd)}`))];
  const shiftText = shiftSet.length === 1 ? `judged against the shift, ${shiftSet[0]}` : 'judged against each day’s own shift';
  const dateList = (dates) => dates.map(shortDate).join(', ');
  const one = clockDays.length === 1 ? clockDays[0] : null;
  const ontimeSub = !t.clockDays ? 'needs a day with both clock times'
    : one && (one.lateMin || one.earlyMin) ? `with clock times · on ${shortDate(one.date)} came in ${one.lateMin ? `${durationText(one.lateMin)} late` : 'on time'}${one.earlyMin ? ` and left ${durationText(one.earlyMin)} early` : ''}`
      : `with clock times${lateN || earlyN ? ` · ${lateN} late, ${earlyN} left early` : ''}`;
  const hasMarked = t.markedRostered > 0;
  const offMode = !t.expectCheckIn && t.noCheckin > 0; // switch OFF: rostered days with no record count as present ("no check-in")
  const oldest = (kind) => att.days.find((d) => d.kind === kind)?.date;
  const offSentence = `${first} was rostered on ${t.rosteredSoFar} days${t.includesToday ? ' so far' : ''} and counts as present on ${t.presentDays === t.knownDays ? `all ${t.knownDays}` : `${t.presentDays} of ${t.knownDays}`}: marked present on ${t.markedPresent}, no check-in on ${t.noCheckin}${absentN ? `; absent on ${absentN}` : ''}${leaveN ? `; on leave or day off on ${leaveN}` : ''}.`;

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-spa-lg border border-border px-4 py-3 text-[13px] text-text-primary">
        {offMode
          ? <>{offSentence}{extraClause}</>
          : hasMarked
          ? <>Attendance was marked on <b>{t.markedRostered} of {first}’s {t.rosteredSoFar} rostered days{t.includesToday ? ' so far' : ''}</b>. {cap(bits.length ? `${bits.join(', ')}; ${clockClause}` : clockClause)}.{extraClause}</>
          : t.rosteredSoFar === 0 && t.rosteredDays > 0
            ? <>No rostered day in {period} has happened yet.</>
            : t.rosteredDays === 0
            ? <>{first} has no rostered days in {period}. {plural(t.extraDays || t.markedDays, 'day')} {(t.extraDays || t.markedDays) === 1 ? 'was' : 'were'} marked anyway.</>
            : <>Attendance wasn’t marked on any of {first}’s {plural(t.rosteredSoFar, 'rostered day')}{t.includesToday ? ' so far' : ''}.{t.extraDays ? ` ${plural(t.extraDays, 'extra day')} with no shift ${t.extraDays === 1 ? 'was' : 'were'} marked.` : ''}</>}
      </div>

      {(offMode ? t.noCheckin > 0 : t.notMarked > 0) && (
        <div className="bg-accent/10 border border-accent/30 rounded-spa-lg px-4 py-2.5 flex flex-wrap items-center gap-3 text-[12.5px] text-text-secondary">
          <span className="text-accent">✦</span>
          <span className="flex-1 min-w-[200px]">{offMode
            ? (t.clockDays === 0 ? 'No clock times are recorded yet, so Clocked in and On time have nothing to show.' : `Clock times exist for only ${t.clockDays} of ${t.rosteredSoFar} days, so Clocked in and On time describe ${t.clockDays === 1 ? 'that 1 day' : `those ${t.clockDays} days`}.`)
            : <>{hasMarked ? `The other ${t.notMarked} rostered days have no attendance, so this tab can say little about ${period}.` : `No attendance is marked yet, so this tab can say little about ${period}.`} Marking them in Attendance would fill in the picture.</>}</span>
          {markLink && <button type="button" onClick={markLink(oldest(offMode ? 'noCheckin' : 'notMarked'))} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-spa border border-border bg-surface text-[12px] font-body-medium text-text-primary hover:bg-black/[0.03]"><Icon name="Calendar" size={13} />{offMode ? 'Add clock times' : 'Mark attendance'}</button>}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Tile icon="Clock" label="Clocked in" value={t.clockDays ? durationText(t.clockedMin) : '—'}
          sub={t.clockDays ? <>on the <b className="text-text-secondary">{plural(t.clockDays, 'day')} with clock times</b> ({t.clockDays === 1 ? `${shortDate(t.clockDates[0].date)}, rostered ${durationText(t.clockDates[0].rosteredMin)}` : t.clockDays <= 4 ? dateList(t.clockDates.map((c) => c.date)) : period})</> : 'no day has both clock times recorded'} />
        <Tile icon="CheckCircle" label="On time" value={t.clockDays ? t.onTime : '—'} unit={t.clockDays ? `of ${plural(t.clockDays, 'day')}` : ''} sub={ontimeSub} />
        {offMode
          ? <Tile icon="Calendar" label="No check-in" value={t.noCheckin} unit="days" sub={`${t.noCheckinText} · counted present (${att.branchName || 'this branch'} doesn’t require check-in)`} />
          : <Tile icon="Calendar" label="Not marked" value={t.rosteredSoFar ? t.notMarked : '—'} unit={t.rosteredSoFar ? 'days' : ''} sub={t.notMarked ? `${t.notMarkedText} · unknown, not counted as absent` : 'every rostered day so far has attendance'} />}
      </div>

      <Card title={months.length === 1 ? `${MONTHS[months[0].month]} at a glance` : `${period} at a glance`} aside={`one square per day · ${shiftText}`}>
        {months.map((m) => <MonthGrid key={m.key} days={m.days} year={m.year} month={m.month} markLink={markLink} />)}
        <div className="px-4 pb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-text-tertiary">
          <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-primary" />Present</span>
          <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-warning" />Present, but late or left early</span>
          <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm border-2 border-warning" />Absent</span>
          <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-blue-500" />Leave or day off</span>
          {offMode && <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-success/25" />Present, no check-in</span>}
          {!offMode && <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm border border-dashed border-text-tertiary" />Not marked</span>}
          <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm border border-border" style={HATCH} />Not rostered (tap or hover for why)</span>
        </div>
      </Card>

      <Card title="Marked days" aside={marked.length ? `${plural(marked.length, 'day')} · newest first` : null}>
        {marked.length === 0 ? <p className="px-4 pb-4 text-[12.5px] text-text-tertiary">Nothing marked in {period}.</p> : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-[11.5px] text-text-tertiary border-y border-border/70 bg-black/[0.02]">
                  <th className="text-left font-medium py-1.5 pl-4 pr-2">Date</th><th className="text-right font-medium py-1.5 px-2">Shift</th><th className="text-right font-medium py-1.5 px-2">In</th><th className="text-right font-medium py-1.5 px-2">Out</th><th className="text-right font-medium py-1.5 px-2">Worked</th><th className="text-left font-medium py-1.5 pl-4 pr-4">What happened</th>
                </tr></thead>
                <tbody>
                  {markedList.map((d) => {
                    const { chips, note } = dayChips(d);
                    return (
                      <tr key={d.date} className="border-b border-border/60 last:border-0">
                        <td className="py-2 pl-4 pr-2 font-medium text-text-primary whitespace-nowrap">{prettyDate(d.date)}</td>
                        <td className="py-2 px-2 text-right font-data tabular-nums text-text-secondary whitespace-nowrap">{d.rostered ? `${hhmmOf(d.shiftStart)}–${hhmmOf(d.shiftEnd)} · ${durationText(d.rosteredMin)}` : 'no roster'}</td>
                        <td className="py-2 px-2 text-right font-data tabular-nums text-text-secondary">{d.checkIn || '—'}{d.workedAt && <div className="text-[10.5px] text-text-tertiary font-body">at {d.workedAt}</div>}</td>
                        <td className="py-2 px-2 text-right font-data tabular-nums text-text-secondary">{d.checkOut || '—'}</td>
                        <td className="py-2 px-2 text-right font-data tabular-nums text-text-primary">{d.workedMin != null ? durationText(d.workedMin) : '—'}</td>
                        <td className="py-2 pl-4 pr-4"><div className="flex flex-wrap items-center gap-1.5">{chips.map((c) => <Chip key={c.text} tone={c.tone}>{c.text}</Chip>)}{note && <span className="text-[11.5px] text-text-tertiary">{note}</span>}</div></td>
                      </tr>
                    );
                  })}
                  <tr className="bg-black/[0.02] font-medium">
                    <td className="py-2 pl-4 pr-2" colSpan={4}>Clocked in</td>
                    <td className="py-2 px-2 text-right font-data tabular-nums">{t.clockDays ? durationText(t.clockedMin) : '—'}</td>
                    <td className="py-2 pl-4 pr-4 text-[11.5px] font-normal text-text-tertiary">{t.clockDays ? `from the ${plural(t.clockDays, 'day')} with clock times` : 'no day has both clock times'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="md:hidden divide-y divide-border/60">
              {markedList.map((d) => {
                const { chips, note } = dayChips(d);
                return (
                  <div key={d.date} className="px-4 py-2.5 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5"><span className="font-medium text-[13px] text-text-primary mr-1">{prettyDate(d.date)}</span>{chips.map((c) => <Chip key={c.text} tone={c.tone}>{c.text}</Chip>)}</div>
                    <div className="text-[11.5px] text-text-tertiary font-data tabular-nums">{d.rostered ? `${hhmmOf(d.shiftStart)}–${hhmmOf(d.shiftEnd)}` : 'no roster'} · in {d.checkIn || '—'} · out {d.checkOut || '—'} · worked {d.workedMin != null ? durationText(d.workedMin) : '—'}{d.workedAt ? ` · at ${d.workedAt}` : ''}</div>
                    {note && <div className="text-[11px] text-text-tertiary">{note}</div>}
                  </div>
                );
              })}
              <div className="px-4 py-2.5 flex justify-between text-[13px] font-medium bg-black/[0.02]"><span>Clocked in</span><span className="font-data tabular-nums">{t.clockDays ? durationText(t.clockedMin) : '—'}</span></div>
            </div>
          </>
        )}
        <div className="px-4 py-2.5 text-[11.5px] text-text-tertiary border-t border-border/70 space-y-1">
          <div><b className="text-text-secondary font-medium">Late</b> = clocked in more than {t.graceMinutes} min after the shift start. <b className="text-text-secondary font-medium">Left early</b> = clocked out more than {t.graceMinutes} min before the shift end. Both are measured from the shift time.</div>
          <div>“—” = not recorded. It adds nothing to Clocked in.</div>
        </div>
      </Card>
    </div>
  );
};

export default AttendanceTab;
