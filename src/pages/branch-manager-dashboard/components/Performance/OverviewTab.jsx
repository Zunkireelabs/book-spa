import React, { useMemo, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { previousPeriod } from 'utils/reportPeriod';
import { useIndustry } from 'hooks/useIndustry';
import { DeltaChip } from '../Reports/ReportFrame';
import {
  scoreBars, holdsBack, outcomes, servicesDelivered, weekLabels, kpiTiles, noPrevLine, clockedNote, attendanceFlag, hoursText, shortDate, dayRange,
} from './therapistInnerView';

const n0 = (v) => Number(v || 0).toLocaleString('en-IN');
const Card = ({ title, aside, children, className = '' }) => (
  <div className={`bg-surface rounded-spa-lg border border-border ${className}`}>
    {title && <div className="flex items-baseline justify-between px-4 pt-3 pb-2"><h3 className="font-heading font-heading-semibold text-sm text-text-primary">{title}</h3>{aside && <span className="text-[11.5px] text-text-tertiary">{aside}</span>}</div>}
    {children}
  </div>
);
const Flag = ({ children }) => <div className="mt-3 rounded-spa bg-warning/10 px-3 py-2 text-[12.5px] text-text-primary leading-snug"><span className="text-warning mr-1.5">✦</span>{children}</div>;
// A drop against the previous period is amber, never red (this page is for coaching).
const Chip = ({ delta }) => <DeltaChip delta={delta && delta.tone === 'bad' ? { ...delta, tone: 'flat' } : delta} />;

const HowWeCountNote = ({ children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-primary">
        <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={12} />How we count
      </button>
      {open && <div className="text-[11px] text-text-tertiary leading-snug mt-1">{children}</div>}
    </div>
  );
};

const Ring = ({ score }) => {
  const r = 34; const c = 2 * Math.PI * r;
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" className="flex-shrink-0" role="img" aria-label={`Score ${score} of 100`}>
      <circle cx="44" cy="44" r={r} fill="none" stroke="currentColor" strokeWidth="7" className="text-black/[0.07]" />
      <circle cx="44" cy="44" r={r} fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" className="text-primary" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 44 44)" />
      <text x="44" y="46" textAnchor="middle" className="fill-text-primary font-data" fontSize="22" fontWeight="600">{score}</text>
      <text x="44" y="60" textAnchor="middle" className="fill-text-tertiary" fontSize="9">of 100</text>
    </svg>
  );
};

const Bar = ({ share, cls }) => <div className="h-2 rounded-full bg-black/[0.07] overflow-hidden"><div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }} /></div>;

// Thin track: tick at the team value, dot at "you" (green at or above the team, amber below); the scale is the larger of the two.
const Marker = ({ t }) => {
  if (!t.markerText) return null;
  const m = t.marker;
  const scale = m ? Math.max(m.mine, m.avg, 1e-9) : 1;
  return (
    <div className="flex items-center gap-2 text-[11px] text-text-tertiary mt-auto pt-2 border-t border-border">
      <span className="whitespace-nowrap">{t.markerText}</span>
      <span className="flex-1 h-1 rounded-full bg-black/[0.07] relative mx-1">
        {m && <i className="absolute -top-[3px] w-0.5 h-2.5 rounded bg-text-tertiary" style={{ left: `${(m.avg / scale) * 100}%` }} />}
        {m && <em className={`absolute -top-[3px] w-2.5 h-2.5 rounded-full -ml-[5px] ${m.good ? 'bg-primary' : 'bg-warning'}`} style={{ left: `${(m.mine / scale) * 100}%` }} />}
      </span>
      <span className="whitespace-nowrap">{t.markerLabel || 'you'}</span>
    </div>
  );
};
const TILE_ICON = { sales: ['Wallet', 'bg-primary/10 text-primary'], completed: ['CheckCircle', 'bg-warning/10 text-warning'], busy: ['Clock', 'bg-blue-500/10 text-blue-600'], rebook: ['Repeat', 'bg-primary/10 text-primary'] };

const OverviewTab = ({ row, report, prevRow, maxSales, range, ov, reportLoading, onRetry, onNeedsClosing = null }) => {
  const { staffLabel } = useIndustry();
  const d = ov.data;
  const list = d?.bookingList;
  const out = useMemo(() => (list ? outcomes(list) : null), [list]);
  const svc = useMemo(() => (list ? servicesDelivered(list) : null), [list]);

  if (ov.loading || reportLoading) {
    return <div className="grid grid-cols-3 gap-3">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-40 bg-background rounded-spa-lg animate-pulse" />)}</div>;
  }
  if (ov.error) {
    return (
      <div className="bg-warning/10 border border-warning/30 rounded-spa p-4 flex items-center gap-3">
        <Icon name="AlertCircle" size={18} className="text-warning flex-shrink-0" />
        <p className="font-body text-sm text-text-primary">{ov.error}</p>
        <button onClick={onRetry} className="ml-auto font-body font-body-medium text-sm text-primary underline">Retry</button>
      </div>
    );
  }
  if (!d || !row || (d.totalAssigned === 0 && d.servicesCompleted === 0 && out.total === 0)) {
    return (
      <div className="p-12 text-center bg-surface rounded-spa-lg border border-border">
        <Icon name="LayoutGrid" size={32} className="text-text-tertiary mx-auto mb-3" />
        <p className="font-body text-sm text-text-tertiary">No data for this period.</p>
      </div>
    );
  }

  const team = report.current.team;
  const bars = scoreBars(row, maxSales);
  const back = holdsBack(row, out.openInfo);
  const tiles = kpiTiles(row, team, prevRow, d, staffLabel.toLowerCase());
  const prevR = previousPeriod(range.from, range.to);
  const first = String(row.name || '').split(' ')[0];
  const noPrev = noPrevLine(prevRow, prevR, first);
  const labels = weekLabels(report.weeks, range.from, range.to);
  const weekVals = (row.sales_by_week || []).map(Number);
  const weekMax = Math.max(1, ...weekVals);
  const rosteredMin = Number(row.working_min);
  const rosteredDays = d.dayWindowMinutes > 0 ? Math.round(rosteredMin / d.dayWindowMinutes) : 0;
  const attFlag = attendanceFlag(row.att_days, rosteredDays);
  const noClock = d.workedHours == null;
  const busyClocked = d.utilizationRate; // minutes-based API value (busy minutes on clocked-in days ÷ worked minutes), null with no attendance
  const hourRow = (label, sub, value, share, cls = 'bg-black/20') => (
    <div className="py-1.5">
      <div className="flex justify-between gap-3"><div><div className="text-[13px] font-medium text-text-primary">{label}</div><div className="text-[11px] text-text-tertiary leading-snug">{sub}</div></div><b className="font-data tabular-nums text-[13px] font-medium whitespace-nowrap">{value}</b></div>
      <div className="mt-1"><Bar share={share} cls={cls} /></div>
    </div>
  );
  const share = (min) => (rosteredMin > 0 ? Number(min) / rosteredMin : 0);
  const open7 = out.open.slice(0, 7);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Score */}
        <Card className="p-4">
          <div className="flex gap-3 items-start">
            <Ring score={row.score} />
            <div className="min-w-0">
              <div className="font-heading font-heading-semibold text-[15px] text-text-primary">{row.tier.label}</div>
              <div className="text-[11.5px] text-text-secondary leading-snug">Score = sales 40 + completion 25 + attendance 20 + busy 15</div>
              <HowWeCountNote>Tiers: 85 Top performer · 70 Strong · 55 Average · below 55 Needs support. A part with no data is left out and the rest are rescaled to 100.</HowWeCountNote>
            </div>
          </div>
          <div className="mt-3 space-y-2.5">
            {bars.map((b) => (
              <div key={b.key} className="grid grid-cols-[84px_1fr_64px] items-center gap-2">
                <div><div className="text-[12.5px] font-medium text-text-primary">{b.label}</div><div className="text-[10.5px] text-text-tertiary leading-tight">{b.sub}</div></div>
                <Bar share={b.share} cls={b.na ? 'bg-black/10' : b.amber ? 'bg-warning' : 'bg-primary'} />
                <div className="text-right font-data tabular-nums text-[12px]">{b.na ? <span className="text-text-tertiary text-[10.5px]">{b.note}</span> : <><b className="font-medium">{b.value}</b><span className="text-text-tertiary"> /{b.max}</span></>}</div>
              </div>
            ))}
          </div>
          {back && (
            <Flag>
              Completion is what holds the score back: <b>{back.count} booking{back.count === 1 ? '' : 's'} from {dayRange(back.from, back.to)} {back.count === 1 ? 'is' : 'are'} not closed.</b> Closing them counts them properly.{' '}
              {onNeedsClosing && <button type="button" onClick={onNeedsClosing} className="underline text-primary font-medium">Open Needs closing</button>}
            </Flag>
          )}
        </Card>

        {/* KPI tiles */}
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {tiles.map((t) => (
            <Card key={t.key} className="p-4 flex flex-col">
              <div className="flex items-center gap-2"><span className={`w-[26px] h-[26px] rounded-spa flex items-center justify-center flex-shrink-0 ${TILE_ICON[t.key][1]}`}><Icon name={TILE_ICON[t.key][0]} size={14} /></span><span className="text-[12px] font-medium text-text-secondary">{t.label}</span><span className="ml-auto"><Chip delta={t.delta} /></span></div>
              <div className="mt-1.5 flex items-baseline gap-2 flex-wrap">
                <span className="font-data tabular-nums text-[22px] font-semibold tracking-tight text-text-primary">{t.key === 'sales' ? `NPR ${n0(t.value)}` : t.value}</span>
                {t.sub && <span className="font-data text-[11.5px] text-text-tertiary">{t.sub}</span>}
              </div>
              <div className="text-[11.5px] text-text-tertiary mt-0.5">{t.line}</div>
              {t.foot && <div className="mt-auto pt-2 text-[11px] text-text-tertiary border-t border-border">{t.foot}</div>}
              <Marker t={t} />
            </Card>
          ))}
        </div>
      </div>
      {noPrev && <p className="text-[12px] text-text-tertiary -mt-1">{noPrev}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Booking outcomes */}
        <Card title="Booking outcomes" aside={`${out.total} booking${out.total === 1 ? '' : 's'} dated ${dayRange(range.from, range.to)}`} className="lg:col-span-2">
          <div className="px-4 pb-4">
            <div className="flex h-2.5 rounded-full overflow-hidden bg-black/[0.07]">
              {[['completed', 'bg-primary'], ['notClosed', 'bg-warning'], ['cancelled', 'bg-black/25'], ['noShow', 'bg-black/10']].map(([k, cls]) => (out[k] > 0 ? <div key={k} className={cls} style={{ width: `${(out[k] / out.total) * 100}%` }} /> : null))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[12px] text-text-secondary">
              <span><i className="inline-block w-2 h-2 rounded-sm bg-primary mr-1.5" />Completed <b className="font-data">{out.completed}</b></span>
              <span><i className="inline-block w-2 h-2 rounded-sm bg-warning mr-1.5" />Not closed <b className="font-data">{out.notClosed}</b></span>
              <span><i className="inline-block w-2 h-2 rounded-sm bg-black/25 mr-1.5" />Cancelled <b className="font-data">{out.cancelled}</b></span>
              <span><i className="inline-block w-2 h-2 rounded-sm bg-black/10 mr-1.5" />No-show <b className="font-data">{out.noShow}</b></span>
            </div>
            {out.notClosed > 0 && (
              <div className="mt-3 pt-3 border-t border-border">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-[12.5px]"><b>{out.notClosed} not closed</b> <span className="text-text-tertiary">booking value NPR {n0(out.openValue)} · {Object.entries(out.openByStatus).map(([s, c]) => `${c} ${s}`).join(', ')} · oldest {shortDate(out.openInfo.firstDate)}</span></div>
                  {onNeedsClosing && <button type="button" onClick={onNeedsClosing} className="h-8 px-3 rounded-spa border border-border text-[12.5px] font-medium text-text-primary hover:bg-black/[0.03]">Close them in Needs closing →</button>}
                </div>
                <div className="mt-2 grid sm:grid-cols-2 gap-x-6 text-[12px]">
                  {open7.map((b, i) => (
                    <div key={i} className="flex items-center gap-2 py-1 border-b border-border/60">
                      <span className="font-data text-text-tertiary whitespace-nowrap">{shortDate(b.date)} {b.start}</span>
                      <span className="truncate text-text-primary">{b.customer}</span>
                      <span className="ml-auto text-warning font-medium">{b.status}</span>
                    </div>
                  ))}
                  {out.notClosed > open7.length && <div className="py-1 text-text-tertiary">+ {out.notClosed - open7.length} more ({dayRange(out.open[open7.length].date, out.openInfo.lastDate)})</div>}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Sales by week */}
        <Card title="Sales by week" aside="Completed, final price">
          <div className="px-4 pb-4 flex items-end gap-2 h-[150px]">
            {weekVals.map((v, i) => (
              <div key={i} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
                <span className="font-data text-[10.5px] text-text-secondary mb-1">{n0(v)}</span>
                <div className={`w-full rounded-t ${v > 0 ? 'bg-primary' : 'bg-black/10'}`} style={{ height: `${v > 0 ? Math.max(4, (v / weekMax) * 100) : 2}px`, maxHeight: '100px' }} />
                <span className="text-[10.5px] text-text-tertiary mt-1.5 whitespace-nowrap">{labels[i]}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Services delivered */}
        <Card title="Services delivered" aside={`Completed${d.avgServiceDurationMinutes ? ` · avg ${d.avgServiceDurationMinutes} min each` : ''}`} className="lg:col-span-2 self-start">
          {svc.rows.length === 0 ? <p className="px-4 pb-4 text-sm text-text-tertiary">No completed services in this period.</p> : (
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-[11px] text-text-tertiary border-y border-border"><th className="text-left font-medium px-4 py-1.5">Service</th><th className="text-right font-medium py-1.5">Done</th><th className="text-right font-medium py-1.5">Sales (NPR)</th><th className="text-right font-medium px-4 py-1.5 w-[28%]">Share</th></tr></thead>
              <tbody>
                {svc.rows.map((r) => (
                  <tr key={r.name} className="border-b border-border/60">
                    <td className="px-4 py-2 text-text-primary">{r.name}</td>
                    <td className="text-right font-data tabular-nums">{r.done}</td>
                    <td className="text-right font-data tabular-nums">{r.owed && <span className="mr-2 rounded-full bg-warning/10 text-warning px-1.5 text-[10.5px] font-sans">owed</span>}{n0(r.sales)}</td>
                    <td className="px-4"><div className="flex items-center gap-2 justify-end"><div className="w-16"><Bar share={r.share} cls="bg-primary" /></div><span className="font-data tabular-nums w-9 text-right">{Math.round(r.share * 100)}%</span></div></td>
                  </tr>
                ))}
                <tr><td className="px-4 py-2 font-semibold">Total</td><td className="text-right font-data tabular-nums font-semibold">{svc.total.done}</td><td className="text-right font-data tabular-nums font-semibold">{n0(svc.total.sales)}</td><td /></tr>
              </tbody>
            </table>
          )}
        </Card>

        {/* Hours */}
        <Card title="Hours" aside={dayRange(range.from, range.to)}>
          <div className="px-4 pb-4">
            {hourRow('Rostered', 'shifts from the roster', rosteredMin > 0 ? hoursText(rosteredMin) : 'No hours set', rosteredMin > 0 ? 1 : 0)}
            {hourRow('Booked', `all bookings not cancelled, incl. the ${out.notClosed} not closed`, hoursText(row.booked_min), share(row.booked_min), 'bg-blue-500')}
            {hourRow('Delivered', `the ${d.servicesCompleted} completed services`, `${d.occupiedHours}\u00A0h`, share(d.occupiedHours * 60), 'bg-primary')}
            {hourRow('Clocked in', clockedNote(d.clockedDays || []), noClock ? 'n/a' : `${d.workedHours}\u00A0h`, noClock ? 0 : share(d.workedHours * 60))}
            {hourRow('Busy on clocked-in days', noClock ? 'no attendance marked, so no figure' : `${d.busyMinutes < 120 ? `${d.busyMinutes}\u00A0min` : `${d.busyHours}\u00A0h`} of ${d.workedHours}\u00A0h, completed services only`, busyClocked == null ? 'n/a' : `${busyClocked}%`, busyClocked == null ? 0 : busyClocked / 100, 'bg-blue-500')}
            {attFlag && <Flag>{attFlag}</Flag>}
          </div>
        </Card>
      </div>

      <div className="bg-surface rounded-spa-lg border border-border px-4 py-2.5 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-text-tertiary">
        <span>Customers served <b className="font-data text-text-primary">{d.customersAttended}</b></span>
        <span>Customers booked <b className="font-data text-text-primary">{d.customersAssigned}</b></span>
        <span>Avg service <b className="font-data text-text-primary">{d.avgServiceDurationMinutes} min</b></span>
        <span>No-show <b className="font-data text-text-primary">{row.bookings > 0 ? `${Math.round((row.no_show / row.bookings) * 1000) / 10}%` : '—'}</b> {row.no_show} of {row.bookings}</span>
      </div>
    </div>
  );
};

export default OverviewTab;
