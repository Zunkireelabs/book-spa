import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../AppIcon';
import { arrangeAssignees, STICKY_SEARCH_MIN } from '../../utils/assignList';
import { arrangeByTime, staffDayRanges, rangeLabel, pillRange } from '../../utils/staffFit';
import { fetchServiceEligibility } from '../../services/api';

// ONE staff picker for the booking panel's Staff tab and the New booking panel (ZNLY-286 look, ZNLY-300 time awareness).
// One list, 44px rows, no inner scroll box (the parent scrolls). "Assigned" only ever means "on this booking" (assignedIds).
// With a `slot` + `bookings` the list is grouped "Free <range>" / "Busy then" / "Off today" and the best-fit people are tagged.
// Without them it is the plain list (Inbox and other callers that have no day data).

let eligibilityPromise = null; // service_therapists is small and static for a session: fetch once, share
const loadEligibility = () => (eligibilityPromise ||= fetchServiceEligibility().then((r) => r.data || {}).catch(() => ({})));
export function useServiceEligibility(enabled) {
  const [map, setMap] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    loadEligibility().then((m) => { if (live) setMap(m); });
    return () => { live = false; };
  }, [enabled]);
  return map;
}

const toMin = (t) => { if (!t) return null; const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + (m || 0); };
const TAG = 'inline-flex items-center flex-shrink-0 whitespace-nowrap px-1.5 py-0.5 rounded text-[10px] font-bold uppercase';
const SECTION = 'px-3 pt-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-text-tertiary';

const StaffPicker = ({
  people = [], selectedIds = [], onChange, max = Infinity,
  heading, note, staffLabel = 'Team member', staffLabelPlural = 'Team',
  slot = null, serviceId = null, bookings = null, excludeBookingId = null, offById = {}, lastStaffId = null,
  assignedIds = [], disabled = false, stickyClass = 'sticky top-0 z-sticky-filter bg-surface pt-1 pb-2',
}) => {
  const [query, setQuery] = useState('');
  const staffLower = staffLabel.toLowerCase();
  const staffPluralLower = staffLabelPlural.toLowerCase();
  const timed = !!(slot && slot.date && slot.start && bookings);
  const eligibility = useServiceEligibility(timed && !!serviceId);
  const finite = Number.isFinite(max);

  const arr = useMemo(() => arrangeAssignees(people, { assignedIds, selectedIds, query }), [people, assignedIds, selectedIds, query]);
  const fit = useMemo(() => {
    if (!timed) return null;
    const s = toMin(slot.start);
    const e = toMin(slot.end) ?? s + 60;
    const rangesById = staffDayRanges(bookings, { date: slot.date, excludeBookingId, defaultMinutes: e - s });
    return { s, e, ...arrangeByTime(people, { slotStart: s, slotEnd: e, rangesById, offById, eligibleIds: serviceId && eligibility ? eligibility[serviceId] : null, lastStaffId, max: finite ? max : 1 }) };
  }, [timed, slot?.date, slot?.start, slot?.end, bookings, excludeBookingId, people, offById, serviceId, eligibility, lastStaffId, max, finite]);
  const best = fit ? new Set(fit.bestIds) : null;
  const matchIds = new Set(arr.rows.map((p) => p.id));
  const assigned = new Set(assignedIds);

  const toggle = (id) => {
    if (disabled) return;
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id));
    else if (max === 1) onChange([id]);
    else if (selectedIds.length < max) onChange([...selectedIds, id]);
  };

  const rowBase = `flex items-center gap-3 min-h-[44px] px-3 py-1 border-t border-border first:border-t-0 spa-transition-fast`;
  const row = (p, extra = {}) => {
    const isSelected = selectedIds.includes(p.id);
    const locked = disabled || extra.off || (!isSelected && finite && max > 1 && selectedIds.length >= max);
    const order = selectedIds.indexOf(p.id) + 1;
    const sub = [p.gender && String(p.gender).replace(/^./, (c) => c.toUpperCase()),
      extra.bookings != null && fit ? (extra.bookings ? `${extra.bookings} today` : null) : (p.specialties?.length ? p.specialties.join(', ') : null)].filter(Boolean).join(' · ');
    return (
      <label key={p.id} className={`${rowBase} ${locked && !isSelected ? 'cursor-not-allowed' : 'cursor-pointer'} ${extra.off || extra.busy ? 'opacity-70' : ''} ${isSelected ? 'bg-primary/5' : locked ? '' : 'hover:bg-background'}`}>
        {finite && max > 1 ? (
          <>
            <input type="checkbox" className="sr-only" checked={isSelected} disabled={locked} onChange={() => toggle(p.id)} />
            <span aria-hidden="true" className={`w-5 h-5 flex-shrink-0 rounded flex items-center justify-center text-[11px] font-bold ${isSelected ? 'bg-primary text-white' : 'border border-border bg-surface'}`}>{isSelected ? order : ''}</span>
          </>
        ) : (
          <input type="checkbox" value={p.id} checked={isSelected} disabled={locked} onChange={() => toggle(p.id)} className="w-5 h-5 flex-shrink-0 rounded text-primary focus:ring-primary disabled:cursor-not-allowed" />
        )}
        <span className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="truncate min-w-0 font-body font-body-medium text-sm text-text-primary" style={{ flex: '0 1 auto' }}>{p.name}</span>
          {assigned.has(p.id) && <span className={`${TAG} bg-success/10 text-success`}>Assigned</span>}
          {best?.has(p.id) && <span className={`${TAG} bg-primary/10 text-primary`}>Best fit</span>}
          {sub && <span className="truncate min-w-0 text-xs font-caption text-text-secondary" style={{ flex: '1 1 0%' }}>· {sub}</span>}
        </span>
        {extra.busy && <span className="flex-shrink-0 whitespace-nowrap text-[11.5px] text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">Busy {pillRange(extra.busy.start, extra.busy.end)}</span>}
        {extra.off && <span className="flex-shrink-0 whitespace-nowrap text-[11.5px] text-text-secondary bg-background border border-border rounded-full px-2 py-0.5">{extra.off}</span>}
      </label>
    );
  };

  const box = (children) => <div className="mt-1 border border-border rounded-spa overflow-hidden">{children}</div>;
  const section = (label, items) => (items.length === 0 ? null : (
    <div key={label}>
      <p className={SECTION}>{label}</p>
      {box(items)}
    </div>
  ));

  let body;
  if (people.length === 0) body = <p className="font-body font-body-normal text-sm text-text-secondary">No {staffPluralLower} available.</p>;
  else if (!fit) {
    body = (
      <>
        {arr.pinned.length > 0 && (<><p className="mt-2 mb-1 text-[11px] font-medium uppercase tracking-wider text-text-tertiary">Selected</p><div className="border border-border rounded-spa overflow-hidden">{arr.pinned.map((p) => row(p))}</div><p className="mt-3 mb-1 text-[11px] font-medium uppercase tracking-wider text-text-tertiary">Matches</p></>)}
        <div className="mt-2 border border-border rounded-spa overflow-hidden">
          {arr.rows.length === 0 ? <NoMatch query={query} staffPluralLower={staffPluralLower} onClear={() => setQuery('')} /> : arr.rows.map((p) => row(p))}
        </div>
      </>
    );
  } else {
    const keep = (x) => matchIds.has(x.person.id);
    const aFirst = (list) => [...list.filter((x) => assigned.has(x.person.id)), ...list.filter((x) => !assigned.has(x.person.id))];
    const free = aFirst(fit.free.filter(keep)); const busy = fit.busy.filter(keep); const off = fit.off.filter(keep);
    body = (
      <>
        {fit.noneFree && fit.free.length === 0 && !query && (
          <div className="mt-2 rounded-spa border border-amber-300 bg-amber-50 px-3 py-2.5 text-[12.5px] leading-snug text-amber-800">
            <b>No one is free {rangeLabel(fit.s, fit.e)}.</b> You can still assign someone (they&apos;ll be double-booked), or change the time.
          </div>
        )}
        {arr.pinned.length > 0 && (<><p className={SECTION}>Selected</p>{box(arr.pinned.map((p) => row(p)))}</>)}
        {arr.rows.length === 0 && <NoMatch query={query} staffPluralLower={staffPluralLower} onClear={() => setQuery('')} />}
        {section(`Free ${rangeLabel(fit.s, fit.e)}`, free.map((x) => row(x.person, { bookings: x.bookings })))}
        {section('Busy then', busy.map((x) => row(x.person, { busy: x.busyRange, bookings: x.bookings })))}
        {section('Off today', off.map((x) => row(x.person, { off: x.reason })))}
      </>
    );
  }

  return (
    <div>
      <div className={people.length >= STICKY_SEARCH_MIN ? stickyClass : ''}>
        {heading && <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">{heading}{finite && max > 1 && <span className="ml-2 text-xs font-normal text-text-secondary">Pick {max}</span>}</h3>}
        {note}
        {people.length > 0 && (
          <>
            <div className="relative mt-2">
              <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${staffPluralLower}...`}
                className="w-full h-11 pl-9 pr-3 bg-background border border-border rounded-spa text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
            </div>
            <div className="mt-1.5 flex justify-between text-xs text-text-secondary">
              <span>{finite && max > 1 ? <><b className="text-text-primary">{arr.selectedVisible} of {max}</b> picked</> : `${arr.selectedVisible} selected`}</span>
              <span>{arr.filtering ? `${arr.matchCount} of ${arr.total} match` : `${arr.total} ${arr.total === 1 ? staffLower : staffPluralLower}`}</span>
            </div>
            {arr.hiddenSelected > 0 && <p className="mt-0.5 text-xs text-text-tertiary">+{arr.hiddenSelected} assigned outside your view</p>}
          </>
        )}
      </div>
      {body}
    </div>
  );
};

const NoMatch = ({ query, staffPluralLower, onClear }) => (
  <div className="py-5 px-3 text-center text-sm text-text-secondary">
    No {staffPluralLower} match &ldquo;{query.trim()}&rdquo;.
    <button type="button" onClick={onClear} className="block mx-auto mt-1 min-h-[44px] px-3 text-sm font-medium text-primary hover:underline">Clear search</button>
  </div>
);

export default StaffPicker;
