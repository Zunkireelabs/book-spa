import React, { useMemo, useState } from 'react';
import PickShell from './PickShell';
import { roomStates, anyAvailableLine, statusText } from '../../utils/roomPick';
import { formatClockNow } from '../../utils/clockTime';

// ZNLY-365: ONE "which room" row, built on PickShell exactly like ServicePickRow and StaffPickRow.
// Closed row: room name on top, a status line under it (Free / "1 of 3 places left" / Full), ›.
// Open list: "Any available" first, then "Free at this time" (green, or amber "1 of 3 places left"), then "Full at this time"
// greyed with "free from 2:00 pm" and not pickable. A search box only when there are more than 8 rooms.
// No time picked yet: just names and beds, no status. `value` '' = no particular room (the server picks a free one when it saves).
const SEARCH_OVER = 8;
const DOT = { free: 'bg-success', few: 'bg-warning', full: 'bg-error' };
const TEXT = { free: 'text-emerald-700', few: 'text-warning', full: 'text-error' };

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// List header sub line: "ENERGISE BODY · Sun 22 Nov · 12:00 pm–2:00 pm". Empty until a date and time are picked.
export const slotLine = ({ serviceName, date, startTime, durationMin }) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(startTime || '');
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
  if (!m || !d) return '';
  const day = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]));
  const s = Number(m[1]) * 60 + Number(m[2]);
  const hhmm = (v) => `${String(Math.floor(v / 60) % 24).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
  return [serviceName, `${DAYS[day.getDay()]} ${day.getDate()} ${MONTHS[day.getMonth()]}`, `${formatClockNow(startTime)}–${formatClockNow(hhmm(s + (durationMin || 60)))}`].filter(Boolean).join(' · ');
};

const beds = (r) => (r.amenities?.length ? r.amenities.join(', ') : '');
const Status = ({ st }) => (st.state ? (
  <span className={`inline-flex items-center gap-1 ${TEXT[st.state]}`}>
    <span aria-hidden="true" className={`inline-block h-[7px] w-[7px] rounded-full ${DOT[st.state]}`} />{statusText(st)}
  </span>
) : null);

const RoomPickRow = ({
  rooms, bookings = [], date = '', startTime = '', durationMin = 60, value = '', onChange, minCapacity = 0,
  anyLabel = 'Any available', anyHint = 'We pick a free room when you save', roomWord = 'room', title = 'Room', sub = '',
  disabled = false, invalid = false, ariaLabel, openSignal = 0, onSignalConsumed = null, serviceName = '',
}) => {
  const states = useMemo(() => roomStates({ rooms, bookings, date, startTime, durationMin, minCapacity }), [rooms, bookings, date, startTime, durationMin, minCapacity]);
  const selected = states.find((x) => x.room.id === value) || null;
  const line = anyAvailableLine(states, roomWord);
  const windowLine = slotLine({ serviceName, date, startTime, durationMin });
  const tone = invalid ? 'border-error ring-2 ring-error/20 bg-surface' : selected?.state === 'full' ? 'border-amber-300 bg-amber-50' : 'border-border bg-surface';

  const renderPicker = (close) => (
    <RoomList states={states} value={value} anyLabel={anyLabel} anyHint={anyHint} title={title} sub={sub || windowLine} roomWord={roomWord}
      onPick={(id) => { onChange(id); close(); }} />
  );

  return (
    <PickShell tone={tone} title={title} renderPicker={renderPicker} disabled={disabled} openSignal={openSignal} onSignalConsumed={onSignalConsumed}>
      {selected ? (
        <span className="flex-1 min-w-0" aria-label={ariaLabel}>
          <span className="block truncate text-sm font-body-medium text-text-primary">{selected.room.name}</span>
          <span className="block truncate text-xs text-text-secondary">{selected.state ? <Status st={selected} /> : beds(selected.room)}{selected.state && beds(selected.room) ? ` · ${beds(selected.room)}` : ''}</span>
        </span>
      ) : (
        <span className="flex-1 min-w-0" aria-label={ariaLabel}>
          <span className="block truncate text-sm font-body-medium text-text-primary">{anyLabel}</span>
          {line && <span className="block truncate text-xs text-text-secondary">{line}</span>}
        </span>
      )}
    </PickShell>
  );
};

const RoomList = ({ states, value, anyLabel, anyHint, title, sub, roomWord, onPick }) => {
  const [q, setQ] = useState('');
  const showSearch = states.length > SEARCH_OVER;
  const needle = q.trim().toLowerCase();
  const hits = needle ? states.filter((x) => x.room.name.toLowerCase().includes(needle)) : states;
  const timed = states.length > 0 && states[0].state != null;
  const Head = ({ children }) => <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{children}</div>;
  const row = (st) => {
    const on = st.room.id === value;
    const full = st.state === 'full';
    const inner = (
      <>
        <span className="flex-1 min-w-0">
          <span className={`block text-sm ${full ? 'text-[#8A8A90]' : 'text-text-primary'}`}>{st.room.name}</span>
          <span className={`block text-xs ${full ? 'text-[#8A8A90]' : 'text-text-secondary'}`}>
            {st.state ? <Status st={st} /> : null}{st.state && beds(st.room) ? ' · ' : ''}{beds(st.room)}
          </span>
        </span>
        {!full && <input type="radio" name="room-pick" checked={on} onChange={() => onPick(st.room.id)} className="accent-primary w-4 h-4 flex-shrink-0" aria-label={st.room.name} />}
      </>
    );
    return full
      ? <div key={st.room.id} data-room-full aria-disabled="true" className="flex items-center gap-2.5 px-4 py-2 min-h-[54px] border-t border-[#EEF0F1]">{inner}</div>
      : <label key={st.room.id} className={`flex items-center gap-2.5 px-4 py-2 min-h-[54px] border-t border-[#EEF0F1] cursor-pointer ${on ? 'bg-primary/5' : 'hover:bg-background'}`}>{inner}</label>;
  };
  const open = hits.filter((x) => x.state !== 'full');
  const full = hits.filter((x) => x.state === 'full');
  return (
    <div>
      <div className="px-4 pt-4 pb-3 pr-14 md:pr-4">
        <h3 className="font-heading font-heading-semibold text-[17px] leading-snug text-text-primary">{title}</h3>
        {sub && <p className="text-[13.5px] text-text-secondary">{sub}</p>}
      </div>
      {showSearch && (
        <div className="px-4 pt-2 pb-2 sticky top-0 bg-surface z-10">
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${roomWord}s…`} aria-label={`Search ${roomWord}s`}
            className="w-full h-10 px-3 border border-border rounded-spa text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        </div>
      )}
      {!needle && (
        <label className={`flex items-center gap-2.5 px-4 py-2 min-h-[54px] border-t border-[#EEF0F1] cursor-pointer ${!value ? 'bg-primary/5' : 'hover:bg-background'}`}>
          <span className="flex-1 min-w-0"><span className="block text-sm text-text-primary">{anyLabel}</span><span className="block text-xs text-text-secondary">{anyHint}</span></span>
          <input type="radio" name="room-pick" checked={!value} onChange={() => onPick('')} className="accent-primary w-4 h-4 flex-shrink-0" aria-label={anyLabel} />
        </label>
      )}
      {hits.length === 0 && <p className="px-4 py-6 text-sm text-text-secondary text-center">No {roomWord} matches “{q.trim()}”.</p>}
      {timed ? (
        <>
          {open.length > 0 && <><Head>Free at this time</Head>{open.map(row)}</>}
          {full.length > 0 && <><Head>Full at this time</Head>{full.map(row)}</>}
        </>
      ) : hits.map(row)}
    </div>
  );
};

export default RoomPickRow;
