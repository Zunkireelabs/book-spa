import React from 'react';
import CustomSelect from './CustomSelect';
import StaffPickRow from './StaffPickRow';
import StaffPicker from './StaffPicker';
import { formatClockTime } from '../../pages/branch-manager-dashboard/components/calendar/timeFormat';
import { pickedRowStatusMulti, staffDayRanges, clockToMin, rangeLabel } from '../../utils/staffFit';
import { nepalNow } from '../../utils/customerDirectory';
import { useUse24h } from '../../hooks/useUse24h';

// ZNLY-402 piece 4 (v3): the Staff tab of a booking with several services. EVERY service is a row with its own staff picker (and room
// picker where the org uses rooms), the same pickers and the same Free / Busy check as the single-service Staff tab. One Save for all rows.
// The edits live in the panel (`picks` = { [bookingId]: { ids, room } }); a row not in `picks` shows what is saved.

export const rowIds = (r, picks) => picks[r.id]?.ids ?? r.staffIds;
export const rowRoom = (r, picks) => (picks[r.id] ? picks[r.id].room : (r.roomId || '')) || '';
export const rowChanged = (r, picks) => !!picks[r.id] && (
  [...rowIds(r, picks)].sort().join(',') !== [...r.staffIds].sort().join(',') || rowRoom(r, picks) !== (r.roomId || '')
);

const BookingStaffRows = ({
  rows, picks, setPicks, editable, therapists, rooms, dayBookings, offStaff, allowOverlap,
  staffLabel, staffLabelPlural, use24h: use24hProp, notes, setNotes, error, notesDisabled,
}) => {
  const [use24hPref] = useUse24h();
  const use24h = use24hProp ?? use24hPref;
  const staffLower = (staffLabel || 'team member').toLowerCase();
  const setPick = (r, patch) => setPicks((prev) => ({ ...prev, [r.id]: { ids: rowIds(r, prev), room: rowRoom(r, prev), ...patch } }));
  return (
    <div className="space-y-4" data-staff-rows>
      {rows.map((r) => {
        const can = editable(r);
        const ids = rowIds(r, picks);
        const room = rowRoom(r, picks);
        const roomObj = rooms.find((x) => x.id === room);
        const optional = roomObj?.requires_therapist === false;
        const maxPick = r.isCouple ? 2 : 1;
        const people = ids.map((id) => (therapists || []).find((t) => t.id === id) || r.staffPeople.find((t) => t.id === id) || { id, name: 'Unknown' });
        const s0 = clockToMin(r.start); const e0 = clockToMin(r.end);
        const info = pickedRowStatusMulti(people, {
          slot: dayBookings && s0 != null ? { start: s0, end: e0 > s0 ? e0 : s0 + 60 } : null,
          rangesById: dayBookings && r.date ? staffDayRanges(dayBookings, { date: r.date, excludeBookingId: r.id }) : {},
          offById: offStaff || {}, date: r.date, today: nepalNow().today, busyOk: allowOverlap,
        });
        return (
          <div key={r.id} className="rounded-spa-lg border border-border p-3 space-y-2.5" data-staff-row={r.id}>
            <div>
              <p className="text-[13px] font-medium text-text-primary">{r.name}</p>
              <p className="text-[12px] text-text-secondary">{[r.start ? `${formatClockTime(r.start, use24h)}${r.end ? ` – ${formatClockTime(r.end, use24h)}` : ''}` : '', r.minutes ? `${r.minutes} min` : ''].filter(Boolean).join(' · ')}</p>
            </div>
            <StaffPickRow
              key={`${r.id}-${(r.staffIds || []).join(',')}`}
              people={people}
              max={maxPick}
              statusLine={can ? info.statusLine : ''}
              pill={can ? info.pill : null}
              problem={can ? info.problem : ''}
              note={can ? info.note : ''}
              assignedIds={r.staffIds}
              assignedNames={r.staff}
              disabled={!can}
              emptyLabel={`Pick ${staffLower}`}
              title={`${staffLabel || 'Team member'} for ${r.name}`}
              renderPicker={(close) => (
                <StaffPicker
                  people={therapists}
                  selectedIds={ids}
                  onChange={(next) => { setPick(r, { ids: next }); if (maxPick === 1) close(); }}
                  max={maxPick}
                  header={{ title: `${staffLabel || 'Team member'} for ${r.name}`, sub: [r.name, s0 != null && e0 != null ? rangeLabel(s0, e0) : ''].filter(Boolean).join(' · ') }}
                  onNone={optional ? () => { setPick(r, { ids: [] }); close(); } : null}
                  noneLabel={`No ${staffLower} · self-service`}
                  staffLabel={staffLabel || 'Team member'}
                  staffLabelPlural={staffLabelPlural || 'Team'}
                  slot={r.date && r.start ? { date: r.date, start: r.start, end: r.end } : null}
                  serviceId={r.serviceId}
                  bookings={dayBookings}
                  excludeBookingId={r.id}
                  offById={offStaff}
                  assignedIds={r.staffIds}
                  disabled={!can}
                />
              )}
            />
            {!can && <p className="text-[12px] text-text-secondary">{r.dead ? 'Cancelled.' : 'This service has started, so it cannot change.'}</p>}
            {can && rooms.length > 0 && (
              <CustomSelect
                value={room}
                onChange={(val) => setPick(r, { room: val })}
                options={[{ value: '', label: 'No room assigned' }, ...rooms.map((x) => ({ value: x.id, label: x.name, searchLabel: x.name }))]}
                placeholder="No room assigned"
                size="md"
                searchable
              />
            )}
          </div>
        );
      })}
      <div className="space-y-1.5">
        <label className="font-body font-body-medium text-xs sm:text-sm text-text-primary">Assignment notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={`Add any special instructions for the ${staffLower}...`}
          rows={3}
          disabled={notesDisabled}
          className="w-full px-3 py-2.5 border border-border rounded-spa bg-surface text-text-primary text-sm focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast resize-none disabled:opacity-60"
        />
      </div>
      {error}
    </div>
  );
};

export default BookingStaffRows;
