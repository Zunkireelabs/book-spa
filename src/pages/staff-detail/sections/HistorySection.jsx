import React from 'react';
import Icon from '../../../components/AppIcon';
import { Card, Loading, Problem } from './ui';
import { attendanceTone, attendanceSummary } from '../profileModel';

const TONE_CLASS = { 'on-time': 'bg-primary/70', late: 'bg-warning', leave: 'bg-blue-300', off: 'bg-border', absent: 'bg-error/70', none: 'bg-border/40' };
const TONE_LABEL = { 'on-time': 'On time', late: 'Late', leave: 'Leave', off: 'Day off', absent: 'Absent' };
const CAT_ICON = { profile: 'User', pay: 'Banknote', hours: 'Clock', transfers: 'Building2', created: 'Plus' };

const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kathmandu' });
const monthTitle = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });

const HistorySection = ({
  month, attendance, attendanceLoading, attendanceError, activity, activityLoading, activityError, onRetry,
  filter, setFilter, canSeePay, firstName, openAttendance,
}) => {
  const chips = [['all', 'All'], ['profile', 'Profile'], ...(canSeePay ? [['pay', 'Pay']] : []), ['hours', 'Hours'], ['transfers', 'Transfers']];
  const items = activity?.items || [];
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-text-primary mb-3">Attendance · {monthTitle(month)}{attendance?.length && attendanceSummary(attendance) ? <span className="font-normal text-text-secondary"> · {attendanceSummary(attendance)}</span> : null}</p>
        {attendanceLoading ? <Loading /> : attendanceError ? <Problem message={attendanceError} /> : !attendance?.length || attendance.every((r) => attendanceTone(r) === 'none') ? (
          <Card className="py-8 text-center text-sm text-text-secondary">No attendance recorded this month.</Card>
        ) : (
          <>
            <div className="flex flex-wrap gap-1">
              {attendance.map((r) => {
                const tone = attendanceTone(r);
                return <span key={r.date} title={`${fmtDate(`${r.date}T12:00:00+05:45`)} · ${TONE_LABEL[tone] || 'Nothing recorded'}`} className={`h-6 w-6 sm:w-7 rounded-sm ${TONE_CLASS[tone]}`} />;
              })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
              {Object.keys(TONE_CLASS).filter((t) => t !== 'none').map((t) => <span key={t} className="inline-flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-sm ${TONE_CLASS[t]}`} />{TONE_LABEL[t]}</span>)}
              <button type="button" onClick={openAttendance} className="ml-auto text-primary hover:underline">Open attendance</button>
            </div>
          </>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-text-primary mb-3">Changes <span className="font-normal text-text-secondary">· to {firstName}'s record, transfers and status, newest first</span></p>
        <div className="flex flex-wrap gap-2 mb-3">
          {chips.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setFilter(id)} className={`px-3 h-8 rounded-full border text-sm spa-transition-fast ${filter === id ? 'bg-text-primary text-white border-text-primary' : 'bg-surface text-text-secondary border-border hover:border-text-tertiary'}`}>{label}</button>
          ))}
        </div>
        {activityLoading ? <Loading /> : activityError ? <Problem message={activityError} onRetry={onRetry} /> : items.length === 0 ? (
          <Card className="py-8 text-center text-sm text-text-secondary">
            {activity?.since ? `History is recorded from ${fmtDate(activity.since)}.` : 'Nothing recorded yet.'}{filter !== 'all' ? ' Nothing in this filter yet.' : ''}
          </Card>
        ) : (
          <>
            <Card className="divide-y divide-border">
              {items.map((it) => (
                <div key={it.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-8 h-8 rounded-full border border-border flex items-center justify-center flex-shrink-0 text-text-secondary"><Icon name={CAT_ICON[it.category] || 'Circle'} size={14} /></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary">{it.text}</p>
                    {it.actorName && <p className="text-xs text-text-secondary">{it.actorName}</p>}
                  </div>
                  <span className="text-xs text-text-tertiary whitespace-nowrap">{fmtDate(it.at)}</span>
                </div>
              ))}
            </Card>
            {activity?.since && <p className="mt-2 text-xs text-text-tertiary">History is recorded from {fmtDate(activity.since)}.</p>}
          </>
        )}
      </div>
    </div>
  );
};

export default HistorySection;
