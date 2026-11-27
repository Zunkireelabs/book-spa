import React from 'react';
import Icon from '../AppIcon';
import { formatClockTime, formatClockRange } from '../../utils/clockTime';
import { useUse24h } from '../../hooks/useUse24h';

// ZNLY-402 piece 4 / ZNLY-435: the constant "This booking" card of the booking panel: every booking, every org (1 service = a card with 1 row).
// Pure display: the numbers come from utils/bookingBlock.js, the actions from the panel. Words (U1): "booking" and "services" only.
//   mode 'full'  : Details = the home. Every service with its own Start / Done / Remove, total, paid state.
//   mode 'strip' : Staff / Discount / Payment. A compact list (header only on a phone until opened).
// Clicking a service row switches the panel to that service (onSelect); the opened one is marked.

const npr = (n) => `NPR ${Number(n || 0).toLocaleString('en-IN')}`;
const CHIP = {
  pending: ['Waiting', 'bg-warning/10 text-warning'],
  confirmed: ['Booked', 'bg-success/10 text-success'],
  'in-progress': ['Started', 'bg-primary/10 text-primary'],
  completed: ['Done', 'bg-gray-100 text-gray-500'],
  cancelled: ['Cancelled', 'bg-error/10 text-error'],
  'no show': ['No show', 'bg-gray-100 text-gray-500'],
};

export const waitingNote = (n) => `${n} service${n === 1 ? ' is' : 's are'} waiting for confirmation: confirm ${n === 1 ? 'it' : 'them'} to include ${n === 1 ? 'it' : 'them'} in the payment.`;

const Chip = ({ status }) => {
  const [label, cls] = CHIP[status] || [status, 'bg-gray-100 text-gray-500'];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium flex-shrink-0 ${cls}`}>{label}</span>;
};

const RowMain = ({ r, compact, use24h }) => {
  return (
  <div className="flex-1 min-w-0">
    <p className={`text-[13px] font-medium truncate ${r.dead ? 'line-through text-text-tertiary' : 'text-text-primary'}`}>{r.name}</p>
    <p className="text-[12px] text-text-secondary truncate">
      {[r.start ? (compact ? formatClockTime(r.start, use24h) : formatClockRange(r.start, r.end, use24h)) : '', r.minutes ? `${r.minutes} min` : '', r.staff.length ? r.staff.join(', ') : '', r.room || ''].filter(Boolean).join(' · ')}
    </p>
  </div>
  );
};

const Bar = ({ cls }) => <div className={`bg-gray-100 rounded ${cls}`} />;
const BlockSkeleton = ({ dateLabel }) => (
  <section className="rounded-spa-lg border border-border bg-surface mb-5 animate-pulse" data-booking-block data-loading="true" aria-busy="true" aria-label="This booking">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 min-h-11 py-1.5 border-b border-border">
      <span className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">This booking</span>
      {dateLabel && <span className="text-[13px] text-text-secondary">{dateLabel}</span>}
      <Bar cls="h-3.5 w-16" /><Bar cls="h-3.5 w-20" />
    </div>
    <div className="flex items-center gap-2 px-3 py-2.5">
      <div className="flex-1 min-w-0 space-y-1.5"><Bar cls="h-3.5 w-40" /><Bar cls="h-3 w-56" /></div>
      <Bar cls="h-3.5 w-16" /><div className="h-5 w-14 bg-gray-100 rounded-full" />
    </div>
    <div className="flex items-center gap-2 px-3 pb-2.5"><div className="h-8 w-14 bg-gray-100 rounded-spa" /></div>
  </section>
);

const BookingServicesBlock = ({
  block,            // buildBookingBlock() result
  mode = 'full',
  paidState,        // e.g. { label: 'Not paid yet', tone: 'warning' }: the same word the panel uses for money state
  canViewPrices = true,
  onSelect,         // (bookingId) => switch the panel to that service; undefined = rows are not clickable
  rowAction,        // (row) => { start?: {disabled, reason, run}, done?: {...}, remove?: {...} } for the full mode
  busyId = null,
  use24h: use24hProp,
  dateLabel = '',
  collect,          // { disabled, reason, run } | null: the ONE main button of the Details home
  note,             // small hint under the list (Staff tab)
  earlierRows = [], // the unpaid earlier bookings behind `earlier`: tap the line to list them (ZNLY-403)
  onViewEarlier,
  earlier = 0,      // the client's balance from earlier bookings: shown under To pay, never added to it
  loading = false,  // rows not loaded yet: the pulse placeholder (never another layout)
}) => {
  const [use24hPref] = useUse24h();
  const use24h = use24hProp ?? use24hPref;
  const [showEarlier, setShowEarlier] = React.useState(false);
  if (loading) return <BlockSkeleton dateLabel={dateLabel} />;
  if (!block?.show) return null;
  // Staff / Discount / Payment: just ONE plain summary line (the tab body lists the services itself, with that tab's control on each row).
  if (mode === 'strip') {
    return (
      <section className="rounded-spa-lg border border-border bg-surface mb-5 flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 min-h-11 py-1.5" data-booking-block data-mode="strip" aria-label="This booking">
        <span className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">This booking</span>
        {dateLabel && <span className="text-[13px] text-text-secondary">{dateLabel}</span>}
        <span className="text-[13px] font-semibold text-text-primary tabular-nums" data-block-count>{block.count} service{block.count === 1 ? '' : 's'}</span>
        {canViewPrices && <span className="text-[13px] font-semibold text-text-primary tabular-nums" data-block-total>{npr(block.total)}</span>}
      </section>
    );
  }
  const collapsed = false;
  const head = (
    <>
      <span className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">This booking</span>
      {dateLabel && <span className="text-[13px] text-text-secondary">{dateLabel}</span>}
      <span className="text-[13px] font-semibold text-text-primary tabular-nums" data-block-count>{block.count} service{block.count === 1 ? '' : 's'}</span>
      {canViewPrices && <span className="text-[13px] font-semibold text-text-primary tabular-nums" data-block-total>{npr(block.total)}</span>}
    </>
  );
  return (
    <section className="rounded-spa-lg border border-border bg-surface mb-5" data-booking-block data-mode={mode} aria-label="This booking">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 min-h-11 py-1.5 border-b border-border">{head}</div>
      {!collapsed && (
        <ul className="divide-y divide-border">
          {block.rows.map((r) => {
            const here = r.id === block.openId;
            const acts = mode === 'full' && rowAction ? rowAction(r) : null;
            const clickable = !!onSelect && !here;
            return (
              <li key={r.id} data-block-row={r.id} data-open={here ? 'true' : undefined} className={here && block.rows.length > 1 ? 'bg-primary/5' : ''}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button type="button" disabled={!clickable} onClick={() => clickable && onSelect(r.id)}
                    aria-current={here ? 'true' : undefined}
                    className={`flex items-center gap-2 flex-1 min-w-0 text-left ${clickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}>
                    {here && block.rows.length > 1 && <span className="w-1.5 h-6 rounded-full bg-primary flex-shrink-0" aria-hidden="true" />}
                    <RowMain r={r} compact={mode === 'strip'} use24h={use24h} />
                    {canViewPrices && <span className={`text-[13px] tabular-nums flex-shrink-0 ${r.dead ? 'line-through text-text-tertiary' : 'text-text-primary'}`}>{npr(r.final)}</span>}
                    <Chip status={r.status} />
                  </button>
                </div>
                {acts && (acts.start || acts.done || acts.confirm || acts.remove || acts.lock) && (
                  <div className="flex items-center gap-2 px-3 pb-2.5 -mt-1">
                    {acts.start && <button type="button" disabled={acts.start.disabled || busyId === r.id} title={acts.start.reason || undefined} onClick={acts.start.run} className="h-8 px-3 rounded-spa border border-border text-[12px] font-medium text-text-primary hover:bg-background disabled:opacity-40">Start</button>}
                    {acts.confirm && <button type="button" disabled={acts.confirm.disabled || busyId === r.id} onClick={acts.confirm.run} className="h-8 px-3 rounded-spa border border-border text-[12px] font-medium text-text-primary hover:bg-background disabled:opacity-40">Confirm</button>}
                    {acts.done && <button type="button" disabled={acts.done.disabled || busyId === r.id} title={acts.done.reason || undefined} onClick={acts.done.run} className="h-8 px-3 rounded-spa border border-border text-[12px] font-medium text-text-primary hover:bg-background disabled:opacity-40">Done</button>}
                    {acts.lock && <span className="inline-flex items-center gap-1 text-[12px] text-text-secondary" data-row-locked><Icon name="Lock" size={12} />{acts.lock}</span>}
                    {acts.remove && <button type="button" disabled={acts.remove.disabled} title={acts.remove.reason || undefined} onClick={acts.remove.run} className="h-8 px-3 rounded-spa text-[12px] text-error hover:bg-error/5 disabled:opacity-40">Remove</button>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {mode === 'full' && canViewPrices && (
        <div className="px-3 py-2.5 border-t border-border space-y-1" data-block-money>
          {block.discount > 0 && <div className="flex justify-between text-[12px] text-text-secondary"><span>Includes a discount of</span><span className="tabular-nums">{npr(block.discount)}</span></div>}
          <div className="flex justify-between text-[13px] font-semibold text-text-primary"><span>Total</span><span className="tabular-nums">{npr(block.total)}</span></div>
          {block.paid > 0 && <div className="flex justify-between text-[12px] text-text-secondary"><span>Paid so far</span><span className="tabular-nums">{npr(block.paid)}</span></div>}
          <div className="flex justify-between items-center text-[12px]">
            <span className="text-text-secondary">To pay</span>
            <span className="flex items-center gap-2">
              <span className="tabular-nums font-medium text-text-primary">{npr(block.toPay)}</span>
              {paidState && <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${paidState.cls}`}>{paidState.label}</span>}
            </span>
          </div>
          {earlier > 0 && (
            <>
              <button type="button" onClick={() => setShowEarlier((v) => !v)} aria-expanded={showEarlier} className="w-full flex justify-between text-[12px] text-warning hover:underline" data-block-earlier>
                <span>Earlier balance · {earlierRows.length} booking{earlierRows.length === 1 ? '' : 's'} {showEarlier ? '⌃' : '›'}</span><span className="tabular-nums">{npr(earlier)}</span>
              </button>
              {showEarlier && (
                <div className="border border-border rounded-spa divide-y divide-border overflow-hidden" data-earlier-list>
                  {earlierRows.map((pb) => (
                    <button key={pb.bookingId} type="button" disabled={!onViewEarlier} onClick={() => onViewEarlier?.(pb.bookingId)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-background">
                      <span className="flex-1 min-w-0 text-xs text-text-primary truncate">{pb.serviceName} · #{pb.bookingNumber}</span>
                      <span className="text-xs tabular-nums text-warning">{npr(pb.amountDue)}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {block.waiting > 0 && <p className="text-[12px] text-warning" data-block-waiting>{waitingNote(block.waiting)}</p>}
          {collect && (
            <div className="pt-2">
              <button type="button" disabled={collect.disabled} title={collect.reason || undefined} onClick={collect.run}
                className="w-full h-11 rounded-spa bg-primary text-white text-[14px] font-medium disabled:opacity-40 hover:opacity-90 spa-transition-fast">Collect payment</button>
              {collect.disabled && collect.reason && <p className="mt-1.5 text-[12px] text-text-secondary">{collect.reason}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default BookingServicesBlock;
