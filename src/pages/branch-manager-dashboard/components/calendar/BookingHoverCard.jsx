import ClientDayLine from './ClientDayLine';
import { isNoShow } from '../../../../services/bookingTransformers';
import { nameForList } from '../../../../services/dataMasking';
import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../../components/AppIcon';
import AvailabilityNoteLine from '../../../../components/ui/AvailabilityNoteLine';
import { getBookingStatusColors } from '../../../../utils/bookingStatusColors';
import { paymentStatusLabel } from '../../../../utils/paymentStatusLabel';
import { formatClockRange } from '../../../../utils/clockTime';
import { useUse24h } from '../../../../hooks/useUse24h';

// ── Hover-card controller (module singleton) ──────────────────────────────────────────────────────────────────────────
// One popover for the whole calendar. Cards report enter/leave/focus; this decides when to show it:
//  * ~350ms hover intent on first open; once something is open (or was closed < 600ms ago, "warm"), switching to another
//    booking is instant. Closing waits 150ms after the pointer leaves BOTH the card and the popover, so the pointer can
//    travel into the popover (it is interactive: phone link, copy buttons).
//  * suppressed while a mouse button is down (any drag: booking, block, drag-to-create), while a modal dialog is open,
//    and for touch pointers.
export const HOVER_CARD_ID = 'booking-hover-card';
const OPEN_DELAY = 350;
const CLOSE_DELAY = 150;
const WARM_MS = 600;

let state = { booking: null, anchor: null, draggable: false, id: 0 };
const listeners = new Set();
let openTimer = null;
let closeTimer = null;
let lastClosedAt = 0;
let pointerDown = false;
const emit = () => listeners.forEach((l) => l());
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const getState = () => state;

const modalOpen = () => !!document.querySelector('[aria-modal="true"]');
const canHoverDevice = () => typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(hover: hover)').matches;

function setOpen(booking, anchor, draggable) {
  clearTimeout(openTimer); clearTimeout(closeTimer);
  state = { booking, anchor, draggable, id: state.id + 1 };
  emit();
}
function hide() {
  clearTimeout(openTimer); clearTimeout(closeTimer);
  if (state.booking) { lastClosedAt = Date.now(); state = { booking: null, anchor: null, draggable: false, id: state.id + 1 }; emit(); }
}
function scheduleClose() {
  clearTimeout(openTimer); clearTimeout(closeTimer);
  closeTimer = setTimeout(hide, CLOSE_DELAY);
}
function request(booking, anchor, draggable, { immediate = false } = {}) {
  clearTimeout(closeTimer); clearTimeout(openTimer);
  if (pointerDown || modalOpen()) return;
  const warm = state.booking || Date.now() - lastClosedAt < WARM_MS;
  if (immediate || warm) setOpen(booking, anchor, draggable);
  else openTimer = setTimeout(() => { if (!pointerDown && !modalOpen()) setOpen(booking, anchor, draggable); }, OPEN_DELAY);
}

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => {
    if (e.target?.closest?.(`#${HOVER_CARD_ID}`)) return; // pressing inside the popover (copy buttons, phone link) must not dismiss it
    pointerDown = true; hide();
  }, true);
  const up = () => { pointerDown = false; };
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);
  window.addEventListener('blur', hide);
  window.addEventListener('scroll', hide, true);
}

// Props to spread on a booking element (card or overflow row). `suppress` = e.g. the booking open in the side panel.
export function useBookingHover(booking, { draggable = false, suppress = false } = {}) {
  const ref = useRef(null);
  const key = booking.bookingId || booking.id;
  const open = useSyncExternalStore(subscribe, () => (getState().booking && (getState().booking.bookingId || getState().booking.id) === key && getState().anchor === ref.current));
  useEffect(() => () => { if (getState().anchor === ref.current) hide(); }, []);
  const handlers = {
    onPointerEnter: (e) => {
      if (e.pointerType !== 'mouse' || suppress || !canHoverDevice()) return;
      request(booking, ref.current, draggable);
    },
    onPointerLeave: (e) => { if (e.pointerType === 'mouse') scheduleClose(); },
    onFocus: (e) => {
      if (suppress || e.target !== e.currentTarget || !e.target.matches?.(':focus-visible')) return;
      request(booking, ref.current, draggable);
    },
    onBlur: (e) => { if (e.target === e.currentTarget) hide(); },
    onKeyDown: (e) => {
      if (e.key === 'Escape' && getState().booking) { e.preventDefault(); hide(); }
    },
  };
  return { ref, handlers, open, hideNow: hide };
}

// id of the booking whose popover is open, so linked highlights (shared-booking copies) survive the pointer moving
// from the card onto its popover.
export function useHoverCardBookingId() {
  return useSyncExternalStore(subscribe, () => (getState().booking ? (getState().booking.bookingId || getState().booking.id) : null));
}

// ── Content ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const AMBER = { fill: '#FBF5E6', text: '#7A5408' };
const PILL_COLORS = { success: { fill: '#EAF6F0', text: '#125E41' }, warning: AMBER, neutral: { fill: '#F1F1EF', text: '#515152' } };

export const compactRange = formatClockRange; // kept so existing imports work
const npr = (n) => `NPR ${Number(n || 0).toLocaleString('en-IN')}`;
export const formatPhone = (raw) => {
  if (!raw) return '';
  const s = String(raw).replace(/[\s-]/g, '');
  const m = s.match(/^\+?(977)?(\d{10})$/);
  if (m) return `+977 ${m[2]}`;
  const m2 = s.match(/^(\+\d{1,3})(\d{6,})$/);
  return m2 ? `${m2[1]} ${m2[2]}` : String(raw);
};
export const initialsOf = (name) => String(name || '').split(/\s+/).filter((w) => w && !/^dr\.?$/i.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function CopyButton({ value, label }) {
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return undefined; const t = setTimeout(() => setDone(false), 1500); return () => clearTimeout(t); }, [done]);
  return (
    <button
      type="button"
      aria-label={done ? 'Copied' : label}
      title={done ? 'Copied' : label}
      onClick={(e) => { e.stopPropagation(); try { navigator.clipboard?.writeText(value); setDone(true); } catch (_) { /* clipboard unavailable */ } }}
      className="p-1 rounded-spa text-text-tertiary hover:text-primary hover:bg-background spa-transition-fast"
    >
      <Icon name={done ? 'Check' : 'Copy'} size={12} />
    </button>
  );
}

// "ALERTS" block shared by the hover card and the side panel's Details tab: customer notes + this visit's special request.
export function AlertsBlock({ customerNotes, specialRequests, className = '' }) {
  if (!customerNotes && !specialRequests) return null;
  const rows = [
    customerNotes && { key: 'p', icon: 'AlertTriangle', text: customerNotes, tag: 'Customer' },
    specialRequests && { key: 'v', icon: 'MessageSquare', text: specialRequests, tag: 'This visit' },
  ].filter(Boolean);
  return (
    <div className={`rounded-spa px-3 py-2 space-y-1.5 ${className}`} style={{ backgroundColor: AMBER.fill, color: AMBER.text }} role="note" aria-label="Alerts">
      {rows.map((r) => (
        <div key={r.key} className="flex items-start gap-2 text-[13px] leading-snug">
          <Icon name={r.icon} size={14} className="mt-0.5 flex-shrink-0" />
          <span className="flex-1 min-w-0 break-words" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.text}</span>
          <span className="flex-shrink-0 text-[10px] uppercase tracking-wider opacity-70 mt-0.5">{r.tag}</span>
        </div>
      ))}
    </div>
  );
}

function Avatars({ names }) {
  return (
    <span className="flex -space-x-1.5 flex-shrink-0">
      {names.slice(0, 3).map((n) => (
        <span key={n} className="w-5 h-5 rounded-full bg-gray-100 text-gray-700 ring-2 ring-surface flex items-center justify-center text-[9px] font-medium">{initialsOf(n)}</span>
      ))}
    </span>
  );
}

export function BookingHoverContent({ booking, draggable }) {
  const [use24h] = useUse24h();
  const colors = getBookingStatusColors(isNoShow(booking) ? 'No Show' : booking.status);
  const range = compactRange(booking.startTime, booking.endTime, use24h);
  const names = (booking.therapistName || '').split(/,\s*/).filter(Boolean);
  const shownNames = names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  const amount = booking.finalAmount ?? booking.baseAmount;
  const phone = formatPhone(booking.customerPhone);
  const payState = paymentStatusLabel(booking);
  const pill = { label: payState.label, ...PILL_COLORS[payState.tone] };
  const prev = booking.previousDue;
  const touch = typeof window !== 'undefined' && window.matchMedia && !window.matchMedia('(hover: hover)').matches;
  return (
    <div className="p-4 space-y-2 text-[13px] text-text-primary">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-body text-[15px] font-semibold text-text-primary truncate min-w-0">{nameForList(booking.customerName, booking.customerPhone)}</span>
        {booking.isNewCustomer && <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium">New</span>}
        <span className="ml-auto flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap" style={{ backgroundColor: colors.fill, color: colors.text }}>{booking.status}</span>
      </div>
      <div className="font-body text-text-primary">{[range, booking.serviceName].filter(Boolean).join(' · ')}</div>
      {(names.length > 0 || booking.roomName) && (
        <div className="flex items-center gap-2 text-text-secondary min-w-0">
          {names.length > 0 && <Avatars names={names} />}
          <span className="truncate">{[shownNames, booking.roomName].filter(Boolean).join(' · ')}</span>
        </div>
      )}

      <AvailabilityNoteLine note={booking.availabilityNote} />
      <ClientDayLine info={booking._clientDay} range={booking._clientDay ? compactRange(booking._clientDay.first, booking._clientDay.last, use24h) : ''} className="!mt-2" />
      <AlertsBlock customerNotes={booking.customerNotes} specialRequests={booking.specialRequests} className="!mt-3" />
      {booking.referredBy && <div className="text-xs text-text-secondary">Referred by {booking.referredBy}</div>}

      <div className="border-t border-border pt-2 !mt-3 space-y-2">
        <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
          {booking.pricesWithheld ? <span className="font-semibold tabular-nums text-text-primary">NPR •••</span> : amount != null && <span className="font-semibold tabular-nums text-text-primary">{npr(amount)}</span>}
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ backgroundColor: pill.fill, color: pill.text }}>{pill.label}</span>
          {booking.discountAmount > 0 && !booking.pricesWithheld && <span className="text-xs text-text-tertiary tabular-nums">−{npr(booking.discountAmount)} discount</span>}
          {prev?.amount > 0 && <span className="text-xs tabular-nums" style={{ color: AMBER.text }}>· Prev. due {npr(prev.amount)}</span>}
        </div>
        {phone && (
          <div className="group flex items-center gap-2">
            <Icon name="Phone" size={14} className="text-text-tertiary flex-shrink-0" />
            {String(booking.customerPhone).includes('•') ? <span className="tabular-nums">{phone}</span> : <a href={`tel:${String(booking.customerPhone).replace(/\s/g, '')}`} className="tabular-nums hover:underline">{phone}</a>}
            <span className="ml-auto opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"><CopyButton value={String(booking.customerPhone)} label="Copy phone" /></span>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-2 !mt-3 flex items-center gap-1 text-[11px] text-text-tertiary">
        {booking.bookingNumber && (
          <>
            <span className="tabular-nums">{booking.bookingNumber}</span>
            <CopyButton value={String(booking.bookingNumber)} label="Copy booking number" />
          </>
        )}
        {!touch && <span>· {draggable ? 'Drag to reschedule' : 'Click for details'}</span>}
      </div>
    </div>
  );
}

// ── Layer: positions + renders the single popover ─────────────────────────────────────────────────────────────────────
export function BookingHoverLayer() {
  const { booking, anchor, draggable, id } = useSyncExternalStore(subscribe, getState);
  const tooltipRef = useRef(null);
  const [pos, setPos] = useState(null);
  const [shown, setShown] = useState(false);
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useLayoutEffect(() => {
    if (!booking || !anchor || !tooltipRef.current) { setPos(null); return; }
    const W = 340;
    const H = tooltipRef.current.offsetHeight;
    const r = anchor.getBoundingClientRect();
    const M = 8; const GAP = 6;
    const panel = document.querySelector('[data-side-panel]');
    const pr = panel ? panel.getBoundingClientRect() : null;
    const rightBound = (pr && pr.width > 0 && pr.left < window.innerWidth ? Math.min(window.innerWidth, pr.left) : window.innerWidth) - M;
    const clampTop = (t) => Math.max(M, Math.min(t, window.innerHeight - M - H));
    let left; let top; let side;
    if (r.right + GAP + W <= rightBound) { side = 'right'; left = r.right + GAP; top = clampTop(r.top); }
    else if (r.left - GAP - W >= M) { side = 'left'; left = r.left - GAP - W; top = clampTop(r.top); }
    else {
      // Not enough room beside the card: below, else above, centred on the card and clamped inside the usable width.
      left = Math.max(M, Math.min(r.left + r.width / 2 - W / 2, rightBound - W));
      if (r.bottom + GAP + H <= window.innerHeight - M) { side = 'below'; top = r.bottom + GAP; }
      else { side = 'above'; top = Math.max(M, r.top - GAP - H); }
    }
    setPos({ left, top, side });
  }, [id, booking, anchor]);

  useEffect(() => {
    setShown(false);
    if (!booking) return undefined;
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [id, !!booking]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!booking) return null;
  const hiddenUntilPlaced = !pos;
  const offset = { right: '-4px, 0', left: '4px, 0', below: '0, -4px', above: '0, 4px' }[pos?.side || 'right'];
  // Invisible bridge across the 6px gap so the pointer never leaves the card+popover union while crossing.
  const bridge = { right: { left: -8, top: 0, bottom: 0, width: 8 }, left: { right: -8, top: 0, bottom: 0, width: 8 }, below: { top: -8, left: 0, right: 0, height: 8 }, above: { bottom: -8, left: 0, right: 0, height: 8 } }[pos?.side || 'right'];
  return createPortal(
    <div
      id={HOVER_CARD_ID}
      role="tooltip"
      ref={tooltipRef}
      onPointerEnter={() => { clearTimeout(closeTimer); }}
      onPointerLeave={scheduleClose}
      className="fixed z-dropdown"
      style={{
        top: pos?.top ?? 0, left: pos?.left ?? 0, width: 340,
        visibility: hiddenUntilPlaced ? 'hidden' : 'visible',
        opacity: shown || reduce ? 1 : 0,
        transform: shown || reduce ? 'translate(0, 0)' : `translate(${offset})`,
        transition: reduce ? 'none' : 'opacity 120ms ease-out, transform 120ms ease-out',
      }}
    >
      <div aria-hidden="true" className="absolute" style={bridge} />
      <div className="bg-surface rounded-spa-lg border border-border shadow-spa-elevated">
        <BookingHoverContent booking={booking} draggable={draggable} />
      </div>
    </div>,
    document.body
  );
}
