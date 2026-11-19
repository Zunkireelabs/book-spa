import React, { useMemo } from 'react';
import Icon from '../../../../components/AppIcon';
import { outcomes, servicesDelivered, notClosedByService, didntHappen, shortDate, dayRange } from './therapistInnerView';
import { durationText } from 'utils/durationText';
import Amount from './Amount';

const n0 = (v) => Number(v || 0).toLocaleString('en-IN');
const SEG = { completed: 'bg-primary', notClosed: 'bg-warning', cancelled: 'bg-black/25', noShow: 'bg-[#7C3AED]', upcoming: 'bg-blue-500' };
const Card = ({ title, aside, titleCls = 'text-text-primary', children }) => (
  <div className="bg-surface rounded-spa-lg border border-border">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 pt-3 pb-2"><h3 className={`font-heading font-heading-semibold text-sm ${titleCls}`}>{title}</h3>{aside && <span className="text-[11.5px] text-text-tertiary">{aside}</span>}</div>
    {children}
  </div>
);
const Foot = ({ children }) => <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-text-tertiary border-t border-border/70">{children}</div>;
const Th = ({ children, right = false, className = '' }) => <th className={`font-medium py-1.5 px-2 first:pl-4 last:pr-4 ${right ? 'text-right' : 'text-left'} ${className}`}>{children}</th>;
const Mini = ({ share }) => <div className="h-2 w-16 rounded-full bg-black/[0.07] overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }} /></div>;
const OUTCOME_CHIP = { cancelled: ['Cancelled', 'bg-black/[0.06] text-text-secondary'], noShow: ['No-show', 'bg-[#7C3AED]/10 text-[#7C3AED]'] };

// The inner page's Services tab (ZNLY-172): built from the Overview's booking lines, so every number equals the Overview and the report.
// Each booking sits in exactly one place: delivered (completed), not closed, didn't happen (cancelled / no-show) or coming up.
const ServicesTab = ({ ov, onRetry, therapistName, range, onNeedsClosing = null }) => {
  const list = ov.data?.bookingList;
  const v = useMemo(() => {
    if (!list) return null;
    const out = outcomes(list);
    return { out, svc: servicesDelivered(list), nc: notClosedByService(out.open), dh: didntHappen(list) };
  }, [list]);

  if (ov.loading) return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 bg-background rounded-spa-lg animate-pulse" />)}</div>;
  if (ov.error) {
    return (
      <div className="bg-warning/10 border border-warning/30 rounded-spa p-4 flex items-center gap-3">
        <Icon name="AlertCircle" size={18} className="text-warning flex-shrink-0" />
        <p className="font-body text-sm text-text-primary">{ov.error}</p>
        <button onClick={onRetry} className="ml-auto font-body font-body-medium text-sm text-primary underline">Retry</button>
      </div>
    );
  }
  const period = dayRange(range.fromDate, range.toDate);
  const first = String(therapistName || '').split(' ')[0];
  if (!v || v.out.total === 0) {
    return (
      <div className="p-12 text-center bg-surface rounded-spa-lg border border-border">
        <Icon name="Sparkles" size={32} className="text-text-tertiary mx-auto mb-3" />
        <p className="font-body text-sm text-text-tertiary">No bookings with {first || 'this person'} in {period}.</p>
      </div>
    );
  }

  const { out, svc, nc, dh } = v;
  const cancelled = dh.filter((b) => b.kind === 'cancelled').length;
  const noShows = dh.length - cancelled;
  const legend = [['completed', 'Completed', out.completed], ['notClosed', 'Not closed', out.notClosed], ['cancelled', 'Cancelled', out.cancelled], ['noShow', 'No-show', out.noShow], ...(out.upcoming ? [['upcoming', 'Coming up', out.upcoming]] : [])];
  const s = (n) => (n === 1 ? '' : 's');

  return (
    <div className="space-y-4">
      <Card title={`${out.total} booking${s(out.total)} with ${first}`} aside={`dated ${period} · same split as the Overview`}>
        <div className="px-4 pb-4">
          <div className="flex h-2.5 rounded-full overflow-hidden bg-black/[0.07]">
            {legend.map(([k, , n]) => (n > 0 ? <div key={k} className={SEG[k]} style={{ width: `${(n / out.total) * 100}%` }} /> : null))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[12px] text-text-secondary">
            {legend.map(([k, label, n]) => <span key={k}><i className={`inline-block w-2 h-2 rounded-sm mr-1.5 ${SEG[k]}`} />{label} <b className="font-data">{n}</b></span>)}
          </div>
        </div>
      </Card>

      {out.notClosed > 0 && (
        <div className="rounded-spa bg-warning/10 px-3 py-2 text-[12.5px] text-text-primary leading-snug">
          <span className="text-warning mr-1.5">✦</span>{out.notClosed} of {out.total} bookings {out.notClosed === 1 ? 'was' : 'were'} never closed, so NPR {n0(out.openAtStake)} can't count as sales yet.
        </div>
      )}

      <Card title="Services delivered" aside={svc.rows.length ? `the ${svc.total.done} completed booking${s(svc.total.done)} · sorted by sales` : null}>
        {svc.rows.length === 0 ? <p className="px-4 pb-4 text-sm text-text-tertiary">Nothing completed yet in this period.</p> : (
          <>
            <table className="hidden md:table w-full text-[12.5px]">
              <thead><tr className="text-[11px] text-text-tertiary border-y border-border"><Th>Service</Th><Th right>Done</Th><Th right>Avg price (NPR)</Th><Th right>Hours</Th><Th right className="!pr-12">Sales (NPR)</Th><Th right className="w-[22%]">Share</Th></tr></thead>
              <tbody>
                {svc.rows.map((r) => (
                  <tr key={r.name} className="border-b border-border/60">
                    <td className="pl-4 pr-2 py-2 text-text-primary">{r.name}</td>
                    <td className="px-2 text-right font-data tabular-nums">{r.done}</td>
                    <td className="px-2 text-right font-data tabular-nums">{n0(Math.round(r.avg))}</td>
                    <td className="px-2 text-right font-data tabular-nums whitespace-nowrap">{durationText(r.minutes)}</td>
                    <td className="pl-2 pr-12 text-right font-data tabular-nums"><Amount value={r.sales} owed={r.owed} /></td>
                    <td className="pl-2 pr-4"><div className="flex items-center gap-2 justify-end"><Mini share={r.share} /><span className="font-data tabular-nums w-9 text-right">{r.pct}%</span></div></td>
                  </tr>
                ))}
                <tr><td className="pl-4 pr-2 py-2 font-semibold">Total</td><td className="px-2 text-right font-data tabular-nums font-semibold">{svc.total.done}</td><td /><td className="px-2 text-right font-data tabular-nums font-semibold whitespace-nowrap">{durationText(svc.total.minutes)}</td><td className="pl-2 pr-12 text-right font-data tabular-nums font-semibold">{n0(svc.total.sales)}</td><td className="pl-2 pr-4 text-right font-data tabular-nums font-semibold">100%</td></tr>
              </tbody>
            </table>
            <div className="md:hidden border-t border-border divide-y divide-border/60">
              {svc.rows.map((r) => (
                <div key={r.name} className="px-4 py-2.5">
                  <div className="flex items-start justify-between gap-2"><span className="text-[13px] font-medium text-text-primary">{r.name}</span><span className="font-data tabular-nums text-[13px] whitespace-nowrap pr-10"><Amount value={r.sales} owed={r.owed} /></span></div>
                  <div className="mt-0.5 text-[11.5px] text-text-tertiary">{r.done} done · avg {n0(Math.round(r.avg))} · {durationText(r.minutes)} · {r.pct}%</div>
                </div>
              ))}
              <div className="px-4 py-2.5 flex items-start justify-between gap-2 font-semibold text-[13px]"><span>Total · {svc.total.done} done · {durationText(svc.total.minutes)}</span><span className="font-data tabular-nums pr-10">{n0(svc.total.sales)}</span></div>
            </div>
          </>
        )}
        <Foot>
          <span>Sales = completed bookings at their final price, paid or not (same as the Overview and the report)</span>
          <span>Hours = the booked length of each completed service</span>
          <span>Avg price = sales ÷ done</span>
        </Foot>
      </Card>

      {(nc.rows.length > 0 || dh.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-[1.9fr_1fr] gap-4 items-start">
          {nc.rows.length > 0 && (
            <Card title="Not closed yet" titleCls="text-warning" aside={`${nc.bookings} booking${s(nc.bookings)} · NPR ${n0(nc.total)} at stake`}>
              <table className="hidden md:table w-full text-[12.5px]">
                <thead><tr className="text-[11px] text-text-tertiary border-y border-border"><Th>Service</Th><Th right>Bookings</Th><Th>Dates</Th><Th right>At stake (NPR)</Th></tr></thead>
                <tbody>
                  {nc.rows.map((r) => (
                    <tr key={r.name} className="border-b border-border/60 align-top">
                      <td className="pl-4 pr-2 py-2 text-text-primary">{r.name}</td>
                      <td className="px-2 py-2 text-right font-data tabular-nums">{r.bookings}</td>
                      <td className="px-2 py-2 font-data text-[11.5px] text-text-secondary">{r.dates}</td>
                      <td className="pl-2 pr-4 py-2 text-right font-data tabular-nums">{n0(r.atStake)}</td>
                    </tr>
                  ))}
                  <tr><td className="pl-4 pr-2 py-2 font-semibold">Total</td><td className="px-2 text-right font-data tabular-nums font-semibold">{nc.bookings}</td><td /><td className="pl-2 pr-4 text-right font-data tabular-nums font-semibold">{n0(nc.total)}</td></tr>
                </tbody>
              </table>
              <div className="md:hidden border-t border-border divide-y divide-border/60">
                {nc.rows.map((r) => (
                  <div key={r.name} className="px-4 py-2.5">
                    <div className="flex items-start justify-between gap-2"><span className="text-[13px] font-medium text-text-primary">{r.name}</span><span className="font-data tabular-nums text-[13px] whitespace-nowrap">{n0(r.atStake)}</span></div>
                    <div className="mt-0.5 text-[11.5px] text-text-tertiary">{r.bookings} booking{s(r.bookings)} · {r.dates}</div>
                  </div>
                ))}
                <div className="px-4 py-2.5 flex items-start justify-between gap-2 font-semibold text-[13px]"><span>Total · {nc.bookings} bookings</span><span className="font-data tabular-nums">{n0(nc.total)}</span></div>
              </div>
              <Foot>
                <span>"Not closed" = the time has passed, but nobody marked it completed or no-show. At stake = price − payments, the same rule as Needs closing.</span>
                {onNeedsClosing && <button type="button" onClick={onNeedsClosing} className="ml-auto text-primary font-medium hover:underline">Close them in Needs closing →</button>}
              </Foot>
            </Card>
          )}
          {dh.length > 0 && (
            <Card title="Didn't happen" aside={`${cancelled} cancelled · ${noShows} no-show${s(noShows)}`}>
              <div className="border-t border-border divide-y divide-border/60 text-[12.5px]">
                {dh.map((b, i) => (
                  <div key={i} className="px-4 py-2 flex items-center gap-3">
                    <span className="text-text-primary min-w-0 truncate">{b.service}</span>
                    <span className="ml-auto font-data text-[11.5px] text-text-secondary whitespace-nowrap">{shortDate(b.date)} {b.start}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium whitespace-nowrap ${OUTCOME_CHIP[b.kind][1]}`}>{OUTCOME_CHIP[b.kind][0]}</span>
                  </div>
                ))}
              </div>
              <Foot><span>Cancelled = called off ahead (grey). No-show = the customer didn't come (violet). Neither earns sales.</span></Foot>
            </Card>
          )}
        </div>
      )}

      {out.coming.length > 0 && (
        <Card title="Coming up" aside={`${out.coming.length} booking${s(out.coming.length)} not started yet`}>
          <div className="border-t border-border divide-y divide-border/60 text-[12.5px]">
            {out.coming.map((b, i) => (
              <div key={i} className="px-4 py-2 flex items-center gap-3">
                <span className="text-text-primary min-w-0 truncate">{b.service}</span>
                <span className="ml-auto font-data text-[11.5px] text-text-secondary whitespace-nowrap">{shortDate(b.date)} {b.start}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

export default ServicesTab;
