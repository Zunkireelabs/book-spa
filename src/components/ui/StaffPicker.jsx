import React, { useEffect, useId, useMemo, useState } from 'react';
import Icon from '../AppIcon';
import { arrangeAssignees, STICKY_SEARCH_MIN } from '../../utils/assignList';
import { arrangeByTime, offDayLabel, offReasonFor, staffDayRanges, rangeClock, clockAmPm, clockShort, pillRange } from '../../utils/staffFit';
import { avatarColor } from '../../pages/branch-manager-dashboard/components/calendar/phoneCalendarLayout';
import { fetchServiceEligibility } from '../../services/api';
import { nepalNow } from '../../utils/customerDirectory';
import { dayTag } from '../../utils/unassignedList';

// ONE staff picker for the booking panel's Staff tab and the New booking panel (ZNLY-286 look, ZNLY-300 time awareness).
// One list, 44px rows, no inner scroll box (the parent scrolls). "Assigned" only ever means "on this booking" (assignedIds).
// With a `slot` + `bookings` the list is grouped "Free <range>" / "Busy then" / "Off today" and the best-fit people are tagged.
// Without them it is the plain list (Inbox and other callers that have no day data).
// Look (ZNLY-303 mockup step 4): flat full-width 56px rows with a hairline, 32px avatar in the person's calendar colour, name + BEST FIT,
// a grey subline, a right-hand pill (Busy / With <guest> / Off) and a radio (max=1) or a checkbox (several can be picked).
// `header` {title, sub}: opened from a row (sheet / popover). `onNone`: adds the last "No staff · assign later" row.
// `lockedById` values: a string ("Person 2") or { pill, line } for people held by another guest of the group.

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
const SECTION = 'px-4 pt-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-text-tertiary';
const PILL = 'flex-shrink-0 whitespace-nowrap text-[11.5px] rounded-full px-2.5 py-0.5';
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

const StaffPicker = ({
  people = [], selectedIds = [], onChange, max = Infinity,
  heading, note, header = null, onNone = null, noneLabel = 'No staff · assign later', staffLabel = 'Team member', staffLabelPlural = 'Team',
  slot = null, serviceId = null, bookings = null, excludeBookingId = null, offById = {}, lastStaffId = null,
  assignedIds = [], lockedById = {}, disabled = false, stickyClass = 'sticky top-0 z-sticky-filter bg-surface pt-1 pb-2',
}) => {
  const [query, setQuery] = useState('');
  const groupName = useId();
  const staffLower = staffLabel.toLowerCase();
  const staffPluralLower = staffLabelPlural.toLowerCase();
  const timed = !!(slot && slot.date && slot.start && bookings);
  const eligibility = useServiceEligibility(timed && !!serviceId);
  const finite = Number.isFinite(max);
  const single = max === 1;

  const arr = useMemo(() => arrangeAssignees(people, { assignedIds, selectedIds, query }), [people, assignedIds, selectedIds, query]);
  const fit = useMemo(() => {
    if (!timed) return null;
    const s = toMin(slot.start);
    const e = toMin(slot.end) ?? s + 60;
    const rangesById = staffDayRanges(bookings, { date: slot.date, excludeBookingId, defaultMinutes: e - s });
    return { s, e, ...arrangeByTime(people, { slotStart: s, slotEnd: e, rangesById, offById, eligibleIds: serviceId && eligibility ? eligibility[serviceId] : null, lastStaffId, max: finite ? max : 1, excludeIds: Object.keys(lockedById).length ? new Set(Object.keys(lockedById)) : null }) };
  }, [timed, slot?.date, slot?.start, slot?.end, bookings, excludeBookingId, people, offById, serviceId, eligibility, lastStaffId, max, finite, lockedById]);
  const best = fit ? new Set(fit.bestIds) : null;
  const matchIds = new Set(arr.rows.map((p) => p.id));
  const assigned = new Set(assignedIds);

  const toggle = (id) => {
    if (disabled) return;
    if (selectedIds.includes(id)) { if (!single) onChange(selectedIds.filter((x) => x !== id)); }
    else if (single) onChange([id]);
    else if (selectedIds.length < max) onChange([...selectedIds, id]);
  };

  const row = (p, extra = {}) => {
    const isSelected = selectedIds.includes(p.id);
    const hold = lockedById[p.id];
    const holdObj = typeof hold === 'string' ? { pill: hold, line: `${hold} at this time` } : hold;
    const dim = !!extra.off || (!!holdObj && !isSelected);
    const locked = disabled || dim || (!isSelected && finite && max > 1 && selectedIds.length >= max);
    const order = selectedIds.indexOf(p.id) + 1;
    const gender = p.gender && String(p.gender).replace(/^./, (c) => c.toUpperCase());
    const today = extra.bookings != null && fit ? (extra.bookings ? `${extra.bookings} ${slot?.date && slot.date !== nepalNow().today ? `on ${dayTag(slot.date)}` : 'today'}` : null) : null;
    const sub = holdObj ? holdObj.line
      : extra.off ? offReasonFor(extra.off, slot?.date, nepalNow().today)
        : extra.busy ? `Busy ${pillRange(extra.busy.start, extra.busy.end)} · free after ${clockShort(extra.busy.end)}`
          : [gender, fit ? today : (p.specialties?.length ? p.specialties.join(', ') : null)].filter(Boolean).join(' · ');
    const pill = holdObj ? { text: holdObj.pill, cls: 'bg-indigo-50 text-indigo-600' }
      : extra.off ? { text: 'Off', cls: 'bg-background text-text-secondary' }
        : extra.busy ? { text: 'Busy', cls: 'bg-amber-100 text-amber-800' } : null;
    return (
      <label key={p.id} className={`flex items-center gap-3 min-h-[56px] px-4 py-2 border-t border-border first:border-t-0 spa-transition-fast ${locked && !isSelected ? 'cursor-not-allowed' : 'cursor-pointer'} ${dim ? 'opacity-50' : ''} ${isSelected ? 'bg-primary/5' : locked ? '' : 'hover:bg-background'}`}>
        <input type={single ? 'radio' : 'checkbox'} name={single ? groupName : undefined} value={p.id} className="sr-only" checked={isSelected} disabled={locked} onChange={() => toggle(p.id)} />
        <span aria-hidden="true" className="w-8 h-8 flex-shrink-0 rounded-full text-white flex items-center justify-center text-[11px] font-semibold" style={{ background: extra.off ? '#D1D5DB' : avatarColor(p.id) }}>{initials(p.name)}</span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="truncate font-body text-[15px] text-text-primary">{p.name}</span>
            {assigned.has(p.id) && <span className={`${TAG} bg-success/10 text-success`}>Assigned</span>}
            {best?.has(p.id) && <span className={`${TAG} bg-primary/10 text-primary`}>Best fit</span>}
          </span>
          {sub && <span className="block text-[13px] leading-snug text-text-secondary">{sub}</span>}
        </span>
        {pill && <span className={`${PILL} ${pill.cls}`}>{pill.text}</span>}
        {!single && finite ? (
          <span aria-hidden="true" className={`w-5 h-5 flex-shrink-0 rounded flex items-center justify-center text-[11px] font-bold ${isSelected ? 'bg-primary text-white' : 'border border-border bg-surface'}`}>{isSelected ? order : ''}</span>
        ) : !single ? (
          <span aria-hidden="true" className={`w-5 h-5 flex-shrink-0 rounded flex items-center justify-center ${isSelected ? 'bg-primary text-white' : 'border border-border bg-surface'}`}>{isSelected && <Icon name="Check" size={13} />}</span>
        ) : (
          <span aria-hidden="true" className={`w-[22px] h-[22px] flex-shrink-0 rounded-full flex items-center justify-center ${isSelected ? 'bg-primary' : 'border-2 border-border bg-surface'}`}>{isSelected && <span className="w-2 h-2 rounded-full bg-white" />}</span>
        )}
      </label>
    );
  };

  const flat = (children) => <div className="border-y border-border">{children}</div>;
  const section = (label, items) => (items.length === 0 ? null : (
    <div key={label}>
      <p className={SECTION}>{label}</p>
      {flat(items)}
    </div>
  ));

  let body;
  if (people.length === 0) body = <p className="px-4 font-body font-body-normal text-sm text-text-secondary">No {staffPluralLower} available.</p>;
  else if (!fit) {
    body = (
      <>
        {arr.pinned.length > 0 && (<><p className={SECTION}>Selected</p>{flat(arr.pinned.map((p) => row(p)))}<p className={SECTION}>Matches</p></>)}
        {flat(arr.rows.length === 0 ? <NoMatch query={query} staffPluralLower={staffPluralLower} onClear={() => setQuery('')} /> : arr.rows.map((p) => row(p)))}
      </>
    );
  } else {
    const keep = (x) => matchIds.has(x.person.id);
    const aFirst = (list) => [...list.filter((x) => assigned.has(x.person.id)), ...list.filter((x) => !assigned.has(x.person.id))];
    const free = aFirst(fit.free.filter(keep)); const busy = fit.busy.filter(keep); const off = fit.off.filter(keep);
    body = (
      <>
        {fit.noneFree && fit.free.length === 0 && !query && (
          <div className="mx-4 mt-2 rounded-spa border border-amber-300 bg-amber-50 px-3 py-2.5 text-[12.5px] leading-snug text-amber-800">
            <b>No one is free {rangeClock(fit.s, fit.e)}.</b> You can still assign someone (they&apos;ll be double-booked), or change the time.
          </div>
        )}
        {arr.pinned.length > 0 && (<><p className={SECTION}>Selected</p>{flat(arr.pinned.map((p) => row(p)))}</>)}
        {arr.rows.length === 0 && <NoMatch query={query} staffPluralLower={staffPluralLower} onClear={() => setQuery('')} />}
        {section(`Free ${rangeClock(fit.s, fit.e)}`, free.map((x) => row(x.person, { bookings: x.bookings })))}
        {section(`Busy at ${clockAmPm(fit.s)}`, busy.map((x) => row(x.person, { busy: x.busyRange, bookings: x.bookings })))}
        {section(offDayLabel(slot?.date, nepalNow().today), off.map((x) => row(x.person, { off: x.reason })))}
      </>
    );
  }

  return (
    <div>
      <div className={people.length >= STICKY_SEARCH_MIN ? stickyClass : ''}>
        {header && (
          <div className="px-4 pt-4 pb-3 pr-14 md:pr-4">
            <h3 className="font-heading font-heading-semibold text-[17px] leading-snug text-text-primary">{header.title}</h3>
            {header.sub && <p className="text-[13.5px] text-text-secondary">{header.sub}</p>}
          </div>
        )}
        {heading && <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">{heading}{finite && max > 1 && <span className="ml-2 text-xs font-normal text-text-secondary">Pick {max}</span>}</h3>}
        {note}
        {people.length > 0 && (
          <>
            <div className={`relative ${header ? 'px-3' : 'mt-2'}`}>
              <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${staffPluralLower}...`}
                className="w-full h-11 px-4 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
            </div>
            {!header && !single && (
              <>
                <div className="mt-1.5 flex justify-between text-xs text-text-secondary">
                  <span>{finite && max > 1 ? <><b className="text-text-primary">{arr.selectedVisible} of {max}</b> picked</> : `${arr.selectedVisible} selected`}</span>
                  <span>{arr.filtering ? `${arr.matchCount} of ${arr.total} match` : `${arr.total} ${arr.total === 1 ? staffLower : staffPluralLower}`}</span>
                </div>
                {arr.hiddenSelected > 0 && <p className="mt-0.5 text-xs text-text-tertiary">+{arr.hiddenSelected} assigned outside your view</p>}
              </>
            )}
          </>
        )}
      </div>
      {body}
      {onNone && (
        <button type="button" data-pick-none onClick={onNone} className="w-full min-h-[56px] px-4 text-left text-[15px] text-text-secondary hover:bg-background spa-transition-fast">{noneLabel}</button>
      )}
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
