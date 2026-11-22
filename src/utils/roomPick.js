// ZNLY-365: what each room looks like for the chosen time, for the shared RoomPickRow list.
//   free = room (or a place in it) is open for the whole service   few = some places taken (rooms with capacity > 1)   full = nothing left.
// A full room says when it is free again ("free from 2:00 pm"). Pure, so it is table-tested.
import { fmt12 } from './errorGuide';

const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
// Beds / chairs come from the room's first amenity ("2 Beds"): the same rule as api.getRoomCapacity.
export const capacityOf = (room) => {
  const m = room?.amenities?.[0] ? String(room.amenities[0]).match(/^(\d+)/) : null;
  return m ? parseInt(m[1], 10) : 1;
};
// The server's check counts every status except Cancelled and No Show (a Completed booking still holds its room).
const IDLE = new Set(['cancelled', 'no show']);

// Windows per room on `date`, the same union the server counts (api.js room check / migration-171): a booking's own room_id, plus each
// companion's own room (booking_therapists.room_id) using that row's times, else the booking's. Raw calendar bookings: snake_case, HH:MM:SS.
const roomWindows = (bookings, date) => {
  const byRoom = new Map();
  const add = (room, s, e) => { if (!byRoom.has(room)) byRoom.set(room, []); byRoom.get(room).push([s, e]); };
  for (const b of bookings || []) {
    if (b.date !== date || IDLE.has(String(b.status || '').toLowerCase())) continue;
    const s = toMin(b.start_time);
    if (s == null) continue;
    const e = toMin(b.end_time) ?? s + 60;
    if (b.room_id) add(b.room_id, s, e);
    for (const bt of b.booking_therapists || []) {
      if (!bt.room_id) continue;
      const bs = toMin(bt.start_time) ?? s;
      const be = toMin(bt.end_time) ?? e;
      add(bt.room_id, bs, be);
    }
  }
  return byRoom;
};
const used = (wins, s, e) => (wins || []).filter(([ws, we]) => s < we && e > ws).length;

export function roomStates({ rooms, bookings, date, startTime, durationMin, minCapacity = 0 }) {
  const s = toMin(startTime);
  const list = (rooms || []).filter((r) => capacityOf(r) >= minCapacity);
  if (!date || s == null) return list.map((r) => ({ room: r, capacity: capacityOf(r), state: null, used: 0, remaining: capacityOf(r), freeFrom: null }));
  const dur = durationMin || 60;
  const e = s + dur;
  const wins = roomWindows(bookings, date);
  return list.map((r) => {
    const cap = capacityOf(r);
    const w = wins.get(r.id);
    const u = used(w, s, e);
    const remaining = Math.max(cap - u, 0);
    let state = 'free';
    let freeFrom = null;
    if (remaining === 0) {
      state = 'full';
      const ends = [...new Set((w || []).filter(([, we]) => we > s).map(([, we]) => we))].sort((a, b) => a - b);
      const t = ends.find((end) => used(w, end, end + dur) < cap);
      freeFrom = t == null ? null : `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    } else if (cap > 1 && u > 0) state = 'few';
    return { room: r, capacity: cap, state, used: u, remaining, freeFrom };
  });
}

// "4 of 6 rooms free at this time" for the closed "Any available" row; '' when no time is picked yet.
export function anyAvailableLine(states, roomWord = 'room') {
  if (!states.length || states[0].state == null) return '';
  const free = states.filter((x) => x.state !== 'full').length;
  return `${free} of ${states.length} ${roomWord}s free at this time`;
}

export const statusText = (st) => {
  if (st.state === 'full') return st.freeFrom ? `Full · free from ${fmt12(st.freeFrom)}` : 'Full';
  if (st.state === 'few') return `${st.remaining} of ${st.capacity} places left`;
  if (st.state === 'free') return 'Free';
  return '';
};
