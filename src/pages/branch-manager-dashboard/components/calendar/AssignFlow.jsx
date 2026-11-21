import React, { useEffect, useMemo, useState } from 'react';
import BottomSheet, { useMediaQuery } from '../../../../components/ui/BottomSheet';
import SidePanel, { PANEL_WIDTH_BOOKING } from '../../../../components/ui/SidePanel';
import StaffPicker from '../../../../components/ui/StaffPicker';
import StaffPickRow from '../../../../components/ui/StaffPickRow';
import Icon from '../../../../components/AppIcon';
import { fetchUnassignedBookings, getCalendarBookings, fetchAttendance, fetchShiftsForRange, assignTherapist, LEAVE_LIKE_ATTENDANCE_STATUSES } from '../../../../services/api';
import { indexShifts } from '../../../../services/availabilityShading';
import { useAvailabilityGuard } from '../../../../contexts/AvailabilityOverrideContext';
import { nepalNow } from '../../../../utils/customerDirectory';
import { addDays } from '../../../../utils/reportPeriod';
import { offStaffReasons, staffPickIncomplete, pickedRowStatusMulti, staffDayRanges, rangeLabel, clockToMin } from '../../../../utils/staffFit';
import { buildAssignList, clock12, durationLabel, listSummary, dayTag, firstGroupLabel } from '../../../../utils/unassignedList';

// ZNLY-299 step 3: the calendar's Assign flow. List (today + next 7 days) -> Staff (shared StaffPicker, time-aware for the
// booking's own day) -> Room (only when the branch has rooms). Phone: bottom sheet. Desktop: the standard side panel.
// Saves through the existing assignTherapist() + availability guard; the caller owns the toast / Undo / scroll.

const PHONE = '(max-width: 767px)';
const TAG = 'inline-flex items-center flex-shrink-0 whitespace-nowrap px-1.5 py-0.5 rounded text-[10px] font-bold uppercase';
const SECTION = 'px-4 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-text-tertiary';

// Free / Busy / Off for ONE day. The calendar's own data when that day is the one on screen, otherwise that day's bookings,
// roster and attendance (never another day's attendance).
function useDayContext({ branchId, date, currentDate, calendarData, attendanceMap, shiftsByTherapist, enabled }) {
  const same = date === currentDate;
  const [other, setOther] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled || !date || same) { setOther(null); setFailed(false); return undefined; }
    let live = true;
    setOther(null); setFailed(false);
    Promise.all([getCalendarBookings(branchId, date, date), fetchAttendance({ branchId, date }), fetchShiftsForRange({ branchId, startDate: date, endDate: date })])
      .then(([cal, att, sh]) => {
        if (!live) return;
        if (cal.error || !cal.data) { setFailed(true); return; }
        const attMap = {};
        for (const a of att.data || []) if (a.status === 'Absent' || LEAVE_LIKE_ATTENDANCE_STATUSES.includes(a.status)) attMap[a.therapistId] = a.status === 'Absent' ? 'Absent' : 'Leave';
        setOther({ bookings: cal.data.bookings || [], therapists: cal.data.therapists || [], attendanceMap: attMap, shifts: indexShifts(sh.data) });
      })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [enabled, date, same, branchId]);
  return useMemo(() => {
    if (!enabled || !date) return { ready: false, failed: false };
    const src = same
      ? { bookings: calendarData?.bookings || [], therapists: calendarData?.therapists || [], attendanceMap, shifts: shiftsByTherapist }
      : other;
    if (!src) return { ready: false, failed };
    const people = src.therapists.filter((t) => t.is_service_staff !== false);
    return { ready: true, failed: false, bookings: src.bookings, people, offById: offStaffReasons(people, { attendanceMap: src.attendanceMap, shiftsByTherapist: src.shifts, date }) };
  }, [enabled, date, same, other, failed, calendarData, attendanceMap, shiftsByTherapist]);
}

const AssignFlow = ({
  isOpen, onClose, branchId, startBookingId = null, currentDate, calendarData, attendanceMap, shiftsByTherapist,
  staffLabel = 'Therapist', staffLabelPlural = 'Therapists', locationLabel = 'Room', onAssigned, onCountChange,
}) => {
  const isPhone = useMediaQuery(PHONE);
  const { guard } = useAvailabilityGuard();
  const staffLower = staffLabel.toLowerCase();
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [item, setItem] = useState(null);
  const [step, setStep] = useState('list');
  const [picked, setPicked] = useState([]);
  const [pickOpen, setPickOpen] = useState(false); // phone: the staff list replaces the sheet body in place (ZNLY-318)
  const [roomId, setRoomId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const day = currentDate || nepalNow().today; // the first group is the day on screen; Upcoming = the 7 days after it
  const list = useMemo(() => {
    const { today, hm } = nepalNow();
    return buildAssignList(rows || [], { today: day, realToday: today, nowHm: hm });
  }, [rows, day]);
  const firstLabel = firstGroupLabel(day, nepalNow().today);

  // Load on open; reset on close.
  useEffect(() => {
    if (!isOpen) { setRows(null); setItem(null); setStep('list'); setPicked([]); setPickOpen(false); setRoomId(''); setSaveError(null); setLoadError(null); return undefined; }
    let live = true;
    fetchUnassignedBookings({ branchId, fromDate: day, toDate: addDays(day, 7) }).then((r) => {
      if (!live) return;
      if (r.error) setLoadError(r.error.message); else setRows(r.data || []);
    });
    return () => { live = false; };
  }, [isOpen, branchId, day]);

  const choose = (it) => { setItem(it); setPicked([]); setRoomId(it.roomId || ''); setSaveError(null); setPickOpen(false); setStep('staff'); };

  // Exactly one unassigned today (or the bar's interim target) goes straight to the Staff step; "‹" still shows the list.
  const [autoDone, setAutoDone] = useState(false);
  useEffect(() => { if (!isOpen) setAutoDone(false); }, [isOpen]);
  useEffect(() => {
    if (!isOpen || !rows || autoDone) return;
    setAutoDone(true);
    if (startBookingId) {
      const hit = [...list.today, ...list.upcoming].find((x) => x.id === startBookingId);
      if (hit) { choose(hit); return; }
    }
    if (list.today.length === 1) choose(list.today[0]);
  }, [isOpen, rows, autoDone, list, startBookingId]);

  useEffect(() => { onCountChange?.(rows ? list.today.length : null); }, [rows, list.today.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = useDayContext({ branchId, date: item?.date, currentDate, calendarData, attendanceMap, shiftsByTherapist, enabled: isOpen && !!item && step !== 'list' });
  const rooms = (calendarData?.rooms || []).filter((r) => r.is_active !== false);
  const hasRooms = rooms.length > 0;
  const incomplete = item ? staffPickIncomplete({ isCouple: item.isCouple, count: picked.length, zeroOk: false }) : true;
  const nameOf = (id) => (ctx.people || []).find((p) => p.id === id)?.name || '';

  const save = async () => {
    if (!item || saving || incomplete) return;
    setSaving(true); setSaveError(null);
    try {
      const roomChanged = hasRooms && (roomId || null) !== (item.roomId || null);
      const result = await guard((overrideReason) => assignTherapist({
        bookingId: item.id, therapistIds: picked, roomId: hasRooms ? (roomId || null) : undefined, overrideReason,
      }));
      if (result?.error) { setSaveError(result.error.message || `Could not assign ${staffLower}. Please try again.`); return; }
      if (result?.data?.warning) { setSaveError(result.data.warning); return; }
      onAssigned?.({ bookingId: item.id, date: item.date, names: picked.map(nameOf).filter(Boolean), prevRoomId: item.roomId || null, roomChanged });
      onClose();
    } catch {
      setSaveError(`Could not assign ${staffLower}. Please try again.`);
    } finally {
      setSaving(false);
    }
  };

  const backToList = () => { setStep('list'); setSaveError(null); };
  const backLabel = `Unassigned${rows ? ` (${list.today.length + list.upcoming.length})` : ''}`;

  // ── bodies ──
  const Row = ({ it, upcoming }) => (
    <button type="button" onClick={() => choose(it)} className="w-full flex items-center gap-3 px-4 py-3 min-h-[56px] border-t border-border text-left hover:bg-background spa-transition-fast">
      <span className="w-14 flex-shrink-0 font-body text-[13px] font-semibold text-text-primary leading-tight">
        {upcoming ? dayTag(it.date) : clock12(it.start).replace(/(am|pm)$/, '')}
        <span className="block text-[11px] font-normal text-text-secondary">{upcoming ? clock12(it.start) : clock12(it.start).slice(-2)}</span>
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="truncate font-body font-body-medium text-sm text-text-primary">{it.customer}</span>
          {it.late && <span className={`${TAG} bg-error/10 text-error`}>Late</span>}
          {it.online && <span className={`${TAG} bg-primary/10 text-primary`}>Online</span>}
        </span>
        <span className="block truncate text-xs text-text-secondary">{[it.service, upcoming ? durationLabel(it.minutes) : durationLabel(it.minutes)].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="flex-shrink-0 text-xs font-semibold text-primary border border-primary/30 rounded-full px-3 py-1.5">Assign</span>
    </button>
  );

  let body; let footer = null; let title = 'Unassigned'; let sub = ''; let listNode = null; let onBack;
  if (step === 'list') {
    sub = rows ? listSummary(list, firstLabel) : '';
    body = loadError ? <p className="p-4 text-sm text-error">{loadError}</p>
      : !rows ? <p className="p-4 text-sm text-text-secondary">Loading…</p>
      : (list.today.length + list.upcoming.length === 0) ? <p className="p-6 text-center text-sm text-text-secondary">Nothing is waiting for {staffLower === 'therapist' ? 'a therapist' : `a ${staffLower}`}.</p>
      : (
        <div>
          {list.today.length > 0 && <><p className={SECTION}>{day === nepalNow().today ? 'Today' : dayTag(day)}</p>{list.today.map((it) => <Row key={it.id} it={it} />)}</>}
          {list.upcoming.length > 0 && <><p className={SECTION}>Upcoming</p>{list.upcoming.map((it) => <Row key={it.id} it={it} upcoming />)}</>}
        </div>
      );
    footer = <p className="text-xs text-text-secondary">Showing {day === nepalNow().today ? 'today' : dayTag(day)} and the next 7 days</p>;
  } else if (step === 'staff' && item) {
    title = item.isCouple ? `Assign ${staffLabelPlural.toLowerCase()} · pick 2` : `Assign ${staffLower}`;
    const until = item.end ? ` · until ${clock12(item.end)}` : '';
    body = (
      <div className="px-4 pb-4">
        <button type="button" onClick={backToList} className="inline-flex items-center gap-1 min-h-[44px] -ml-1 pr-3 text-sm font-medium text-primary"><Icon name="ChevronLeft" size={16} />{backLabel}</button>
        <div className="flex gap-3 rounded-spa bg-background border border-border p-3 mb-2">
          <span className="w-12 flex-shrink-0 text-[13px] font-semibold text-text-primary leading-tight">{clock12(item.start)}{item.date !== nepalNow().today && <span className="block text-[11px] font-normal text-text-secondary">{dayTag(item.date)}</span>}</span>
          <span className="min-w-0"><span className="flex items-center gap-1.5 min-w-0"><span className="font-body-medium text-sm text-text-primary truncate">{item.customer}</span>{item.late && <span className={`${TAG} bg-error/10 text-error`}>Late</span>}{item.online && <span className={`${TAG} bg-primary/10 text-primary`}>Online</span>}</span><span className="block text-xs text-text-secondary">{[item.service, durationLabel(item.minutes)].filter(Boolean).join(' · ')}{until}</span></span>
        </div>
        {ctx.failed ? <p className="py-6 text-sm text-error">Could not load that day. Go back and try again.</p>
          : !ctx.ready ? <p className="py-6 text-sm text-text-secondary">Loading…</p>
          : (() => {
            const s0 = clockToMin(item.start); const e0 = clockToMin(item.end);
            const max = item.isCouple ? 2 : 1;
            const pickedPeople = picked.map((id) => ctx.people.find((t) => t.id === id) || { id, name: nameOf(id) });
            const info = pickedRowStatusMulti(pickedPeople, {
              slot: s0 != null ? { start: s0, end: e0 > s0 ? e0 : s0 + 60 } : null,
              rangesById: staffDayRanges(ctx.bookings, { date: item.date, excludeBookingId: item.id }),
              offById: ctx.offById, date: item.date, today: nepalNow().today,
            });
            const picker = (header, onPick) => (
              <StaffPicker
                key={item.id}
                people={ctx.people}
                selectedIds={picked}
                onChange={onPick}
                max={max}
                header={header}
                staffLabel={staffLabel}
                staffLabelPlural={staffLabelPlural}
                slot={{ date: item.date, start: item.start, end: item.end }}
                serviceId={item.serviceId}
                bookings={ctx.bookings}
                excludeBookingId={item.id}
                offById={ctx.offById}
                stickyClass="sticky top-0 z-sticky-filter bg-surface pt-1 pb-2"
              />
            );
            const sub = [item.service, s0 != null && e0 != null ? rangeLabel(s0, e0) : ''].filter(Boolean).join(' · ');
            if (isPhone && pickOpen) { listNode = picker({ title: '', sub }, (ids) => { setPicked(ids); if (max === 1) setPickOpen(false); }); return null; }
            return (
              <>
              <p className="mb-1.5 font-body font-body-medium text-[13px] text-text-primary">{item.isCouple ? staffLabelPlural : staffLabel}</p>
              <StaffPickRow
                people={pickedPeople}
                max={max}
                statusLine={info.statusLine}
                pill={info.pill}
                problem={info.problem}
                emptyLabel={`Pick ${staffLower}`}
                title={`Staff for ${item.customer}`}
                onOpenPhone={() => setPickOpen(true)}
                renderPicker={(close) => picker({ title: `Staff for ${item.customer}${item.isCouple ? ' · pick 2' : ''}`, sub }, (ids) => { setPicked(ids); if (max === 1) close(); })}
              />
              </>
            );
          })()}
      </div>
    );
    if (isPhone && pickOpen && listNode) { // the list opens in place of the sheet body: "‹ Staff for <customer>" (ZNLY-318)
      title = `Staff for ${item.customer}`; onBack = () => setPickOpen(false);
      body = <div className="pb-4">{listNode}</div>;
    }
    const need = item.isCouple ? (picked.length ? `${picked.length} of 2 picked` : 'Pick 2 people') : 'Pick 1 person';
    footer = (
      <div className="flex items-center gap-3 w-full">
        <span className={`flex-1 text-xs ${saveError ? 'text-error' : 'text-text-secondary'}`}>{saveError || (incomplete ? need : `${picked.length} picked`)}</span>
        <button type="button" disabled={incomplete || saving || !ctx.ready} onClick={() => (hasRooms ? setStep('room') : save())}
          className="min-h-[44px] px-5 rounded-spa bg-primary text-white text-sm font-semibold disabled:opacity-45">{saving ? 'Saving…' : hasRooms ? `Next: ${locationLabel.toLowerCase()}` : 'Assign'}</button>
      </div>
    );
  } else if (step === 'room' && item) {
    title = `Choose a ${locationLabel.toLowerCase()}`;
    const roomRow = (id, name) => (
      <label key={id || 'none'} className={`flex items-center gap-3 min-h-[44px] px-3 py-1.5 border-t border-border first:border-t-0 cursor-pointer ${roomId === id ? 'bg-primary/5' : 'hover:bg-background'}`}>
        <input type="radio" name="assign-room" checked={roomId === id} onChange={() => setRoomId(id)} className="w-5 h-5 text-primary focus:ring-primary" />
        <span className={`flex-1 truncate text-sm ${id ? 'font-body-medium text-text-primary' : 'text-text-secondary'}`}>{name}{item.roomId === id && id ? <span className={`ml-2 ${TAG} bg-success/10 text-success`}>Allocated</span> : null}</span>
      </label>
    );
    body = (
      <div className="px-4 pb-4">
        <button type="button" onClick={() => { setStep('staff'); setSaveError(null); }} className="inline-flex items-center gap-1 min-h-[44px] -ml-1 pr-3 text-sm font-medium text-primary"><Icon name="ChevronLeft" size={16} />{item.isCouple ? staffLabelPlural : staffLabel}: {picked.map(nameOf).join(', ')}</button>
        <div className="mt-1 border border-border rounded-spa overflow-hidden">{roomRow('', `No ${locationLabel.toLowerCase()} assigned`)}{rooms.map((r) => roomRow(r.id, r.name))}</div>
      </div>
    );
    footer = (
      <div className="flex items-center gap-3 w-full">
        <span className={`flex-1 text-xs ${saveError ? 'text-error' : 'text-text-secondary'}`}>{saveError || ''}</span>
        <button type="button" disabled={saving} onClick={save} className="min-h-[44px] px-5 rounded-spa bg-primary text-white text-sm font-semibold disabled:opacity-45">{saving ? 'Saving…' : 'Assign'}</button>
      </div>
    );
  }

  const headerExtra = sub ? <p className="px-4 pb-1 text-xs text-text-secondary">{sub}</p> : null;
  const common = { isOpen, title, onClose, children: body, footer, headerExtra };
  if (onBack) common.onBack = onBack;
  return isPhone ? <BottomSheet {...common} /> : <SidePanel {...common} width={PANEL_WIDTH_BOOKING} />;
};

export default AssignFlow;
