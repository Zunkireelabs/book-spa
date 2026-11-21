import React, { useLayoutEffect, useRef, useState } from 'react';
import Icon from '../../components/AppIcon';
import { axisBounds, fmtClock, fmtDuration, upcomingGaps } from '../../lib/dashboardFloor';

const KIND_STYLE = {
  done: 'bg-gray-100 text-gray-500',
  now: 'bg-primary text-white',
  booked: 'bg-primary/10 text-primary border border-primary/30',
  unconfirmed: 'bg-warning/10 text-warning border border-dashed border-warning/60',
  break: 'bg-gray-50 text-gray-400 border border-gray-200',
  leave: 'bg-gray-50 text-gray-400 border border-gray-200',
};

const LEGEND = [
  ['Done', 'bg-gray-100'],
  ['With client', 'bg-primary'],
  ['Booked', 'bg-primary/10 border border-primary/30'],
  ['Not confirmed', 'bg-warning/10 border border-dashed border-warning/60'],
  ['Free 1h+', 'bg-accent/20 border border-accent/60'],
];

const hourLabel = (m) => `${(m / 60) % 12 || 12}${m === 720 ? 'pm' : ''}`;
const initials = (name) => String(name || '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

const compact = (m) => fmtClock(m).replace(' ', ''); // "11:45 am" -> "11:45am" (the app's compact time), so the status stays on one line
const subline = (t, nowMin) => {
  if (nowMin == null) return t.blocks[0] ? `first ${t.blocks.find((b) => b.booking_id)?.from || t.shift_from}` : 'free all day';
  const cur = t.blocks.find((b) => b.from_min <= nowMin && nowMin < b.to_min);
  if (cur?.kind === 'now') return `with client till ${compact(cur.to_min)}`;
  if (cur && (cur.kind === 'break' || cur.kind === 'leave')) return `${cur.kind === 'break' ? 'break' : 'off'} till ${compact(cur.to_min)}`;
  const next = t.blocks.find((b) => b.from_min > nowMin && b.booking_id);
  return next ? `free till ${compact(next.from_min)}` : 'free';
};

/** A free gap: "+ Free 1h 1m" when it fits on one line, else just "Free" (the full text is in the tooltip). */
const GapBlock = ({ g, onClick, style }) => {
  const box = useRef(null);
  const full = useRef(null);
  const [short, setShort] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !full.current || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setShort(full.current.offsetWidth + 10 > el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [g.from_min, g.to_min]);
  const dur = fmtDuration(g.to_min - g.from_min);
  return (
    <button ref={box} type="button" onClick={onClick} title={`Free ${dur}, ${fmtClock(g.from_min)}–${fmtClock(g.to_min)}: book it`}
      className="absolute top-0 bottom-0 rounded px-1 text-[11px] flex items-center gap-0.5 whitespace-nowrap overflow-hidden bg-accent/20 text-secondary border border-accent/60 hover:bg-accent/30" style={style}>
      <span ref={full} aria-hidden="true" className="absolute invisible whitespace-nowrap pointer-events-none flex items-center gap-0.5"><Icon name="Plus" size={11} /> Free {dur}</span>
      {short ? 'Free' : <><Icon name="Plus" size={11} /> Free {dur}</>}
    </button>
  );
};

/**
 * One branch's floor: working people first, busiest on top, a now-line, click a block to open the booking and a gap to start a booking.
 * nowMin is null outside today/Live (no now-line, all gaps shown).
 */
const Floor = ({ floor, nowMin, open, close, collapsedCount = 6, onOpenBooking, onBookGap, staffPlural = 'people' }) => {
  const [all, setAll] = useState(false);
  const people = floor?.therapists || [];
  const { start, end } = axisBounds(people, open, close);
  const span = end - start;
  const pos = (m) => `${(((m - start) / span) * 100).toFixed(2)}%`;
  const hours = [];
  for (let m = start; m <= end; m += 60) hours.push(m);
  const shown = all ? people : people.slice(0, collapsedCount);
  const others = Math.max(0, (floor?.headcount || 0) - (floor?.working || 0));
  // Phone (< md): the timeline scrolls sideways inside the card at 64px per hour with the staff column pinned; desktop keeps the fluid 190px | 1fr grid.
  const PHONE_NAME_W = 164; // 16px card gutter + 148px name column
  const tlPx = Math.round((span / 60) * 64);
  const scrollRef = useRef(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!floor || !el || nowMin == null || nowMin < start || nowMin > end || !window.matchMedia?.('(max-width: 767px)').matches) return;
    el.scrollLeft = Math.max(0, PHONE_NAME_W + tlPx * ((nowMin - start) / span) - el.clientWidth / 3); // "now" about a third from the left
  }, [nowMin, start, end, span, tlPx, people.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!floor) return null; // every hook sits above this, so floor going null -> data keeps hook order

  return (
    <div>
      <div ref={scrollRef} className="max-md:overflow-x-auto max-md:-mx-4 max-md:pb-1 md:overflow-hidden" data-floor-scroll>
        <div className="relative isolate max-md:min-w-max max-md:pr-4 [--nc:164px] md:[--nc:190px]" style={{ '--tl': `${tlPx}px` }}>
          <div className="grid grid-cols-[var(--nc)_minmax(0,1fr)] max-md:grid-cols-[var(--nc)_var(--tl)] text-[10px] text-gray-400 mb-1">
            <div className="max-md:sticky max-md:left-0 max-md:z-header max-md:bg-surface" />
            <div className="relative h-4">
              {hours.map((m) => (
                <span key={m} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pos(m) }}><span className="md:hidden">{`${Math.floor(m / 60) % 12 || 12}${Math.floor(m / 60) % 24 >= 12 ? 'pm' : 'am'}`}</span><span className="max-md:hidden">{hourLabel(m)}</span></span>
              ))}
            </div>
          </div>
          <div className="relative">
            {nowMin != null && nowMin >= start && nowMin <= end && (
              <div className="absolute top-0 bottom-0 pointer-events-none md:right-0 max-md:w-[var(--tl)]" style={{ left: 'var(--nc)' }}>
                <div className="absolute top-0 bottom-0 w-px bg-error z-sticky-filter" style={{ left: pos(nowMin) }} />
              </div>
            )}
            {shown.map((t) => (
              <div key={t.therapist_id} className="grid grid-cols-[var(--nc)_minmax(0,1fr)] max-md:grid-cols-[var(--nc)_var(--tl)] items-stretch border-t border-gray-100 max-md:min-h-11">
                <div className="flex items-center gap-2 pr-2 py-1.5 min-w-0 max-md:sticky max-md:left-0 max-md:z-header max-md:bg-surface max-md:pl-4 max-md:border-r max-md:border-gray-100">
                  <span className="w-7 h-7 rounded-full bg-primary/10 text-primary text-[11px] font-medium flex items-center justify-center flex-shrink-0">{initials(t.name)}</span>
                  <div className="min-w-0">
                    <div className="text-sm text-gray-900 leading-tight line-clamp-2 break-words" title={t.name}>{t.name}</div>
                    <div className="text-[11px] text-gray-500 leading-tight truncate" title={subline(t, nowMin)}>{subline(t, nowMin)}</div>
                  </div>
                </div>
                <div className="relative h-9 my-1.5 self-center">
                  {t.blocks.map((b, i) => {
                    const clickable = !!b.booking_id;
                    const Tag = clickable ? 'button' : 'div';
                    return (
                      <Tag
                        key={`${b.from}-${i}`}
                        {...(clickable ? { type: 'button', onClick: () => onOpenBooking?.(b.booking_id) } : {})}
                        title={`${b.label || b.kind} · ${b.from}–${b.to}`}
                        className={`absolute top-0 bottom-0 rounded px-1.5 text-[11px] leading-tight flex items-center overflow-hidden whitespace-nowrap ${KIND_STYLE[b.kind] || KIND_STYLE.booked} ${clickable ? 'hover:brightness-95' : ''}`}
                        style={{ left: pos(b.from_min), width: `calc(${(((b.to_min - b.from_min) / span) * 100).toFixed(2)}% - 3px)` }}
                      >
                        <span className="truncate">{b.label || (b.kind === 'break' ? 'Break' : 'Off')}</span>
                      </Tag>
                    );
                  })}
                  {upcomingGaps(t.gaps, nowMin).map((g) => (
                    <GapBlock key={`g${g.from_min}`} g={g} onClick={() => onBookGap?.(t, g)} style={{ left: pos(g.from_min), width: `calc(${(((g.to_min - g.from_min) / span) * 100).toFixed(2)}% - 3px)` }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {people.length === 0 && <p className="text-sm text-gray-500 py-4 text-center">No {staffPlural} are scheduled today.</p>}
      <div className="flex items-center justify-between gap-2 pt-2 text-xs text-gray-500 flex-wrap">
        <span>Working today first, busiest on top{others ? ` · ${others} others not scheduled today` : ''}</span>
        {people.length > collapsedCount && (
          <button type="button" onClick={() => setAll((v) => !v)} className="text-primary font-medium hover:underline">
            {all ? 'Show fewer' : `Show all ${people.length}`} ›
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-[11px] text-gray-500">
        {LEGEND.map(([label, cls]) => (
          <span key={label} className="inline-flex items-center gap-1.5"><i className={`inline-block w-3 h-3 rounded-sm ${cls}`} />{label}</span>
        ))}
      </div>
    </div>
  );
};

export default Floor;
