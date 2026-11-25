import { describe, it, expect } from 'vitest';
import { roomStates, anyAvailableLine, statusText, capacityOf } from './roomPick';

const rooms = [
  { id: 'bkk', name: 'BANGKOK', amenities: ['1 Bed'] },
  { id: 'cm', name: 'CHAINGMAI', amenities: ['3 Beds'], capacity: 3 },
  { id: 'hh', name: 'HUA HIN', amenities: ['1 Bed'] },
  { id: 'fm', name: 'FOOT MASSAGE', amenities: ['2 Chairs'], capacity: 2 },
];
const bk = (room_id, start_time, end_time, o = {}) => ({ id: `${room_id}${start_time}`, date: '2026-11-22', status: 'Confirmed', room_id, start_time, end_time, ...o });
const args = { rooms, date: '2026-11-22', startTime: '12:00', durationMin: 120 };
const by = (st) => Object.fromEntries(st.map((x) => [x.room.id, x]));

describe('roomStates agrees with the server room check', () => {
  it('a room with capacity 1 and amenities "2 Beds" is full after one booking (the amenity text is a label only)', () => {
    const r = [{ id: 'x', name: 'X', amenities: ['2 Beds'], capacity: 1 }];
    expect(roomStates({ ...args, rooms: r, bookings: [bk('x', '12:00:00', '14:00:00')] })[0]).toMatchObject({ state: 'full', capacity: 1 });
  });
  it('a room with capacity 2 and no amenity text shows places left', () => {
    const r = [{ id: 'x', name: 'X', amenities: [], capacity: 2 }];
    expect(roomStates({ ...args, rooms: r, bookings: [bk('x', '12:00:00', '14:00:00')] })[0]).toMatchObject({ state: 'few', remaining: 1 });
  });
  it('a Completed booking still holds its room', () => {
    expect(by(roomStates({ ...args, bookings: [bk('hh', '12:00:00', '14:00:00', { status: 'Completed' })] })).hh.state).toBe('full');
  });
  it("a companion's own room (booking_therapists.room_id) counts, with the row's times", () => {
    const b = bk('bkk', '12:00:00', '14:00:00', { booking_therapists: [{ therapist_id: 't1', room_id: null }, { therapist_id: 't2', room_id: 'hh', start_time: '12:30:00', end_time: '13:30:00' }] });
    const st = by(roomStates({ ...args, bookings: [b] }));
    expect(st.hh.state).toBe('full'); expect(st.hh.freeFrom).toBe('13:30');
    expect(st.bkk.state).toBe('full');
  });
  it("a companion row without times uses the booking's; a cancelled booking's companion rooms are ignored", () => {
    const ok = bk('bkk', '12:00:00', '14:00:00', { booking_therapists: [{ therapist_id: 't2', room_id: 'hh' }] });
    expect(by(roomStates({ ...args, bookings: [ok] })).hh.freeFrom).toBe('14:00');
    const gone = { ...ok, status: 'Cancelled' };
    expect(by(roomStates({ ...args, bookings: [gone] })).hh.state).toBe('free');
  });
});

describe('roomStates', () => {
  it('free, few (places left) and full with the time it frees up', () => {
    const st = by(roomStates({ ...args, bookings: [bk('hh', '11:00:00', '14:00:00'), bk('cm', '12:00:00', '14:00:00'), bk('cm', '12:30:00', '13:00:00')] }));
    expect(st.bkk.state).toBe('free');
    expect(st.cm).toMatchObject({ state: 'few', remaining: 1, capacity: 3 });
    expect(st.hh).toMatchObject({ state: 'full', freeFrom: '14:00' });
    expect(statusText(st.cm)).toBe('1 of 3 places left');
    expect(statusText(st.hh)).toBe('Full · free from 2:00pm');
    expect(statusText(st.bkk)).toBe('Free');
  });
  it('a booking that ends exactly at the start, or starts exactly at the end, does not overlap', () => {
    const st = by(roomStates({ ...args, bookings: [bk('bkk', '10:00:00', '12:00:00'), bk('hh', '14:00:00', '15:00:00')] }));
    expect(st.bkk.state).toBe('free'); expect(st.hh.state).toBe('free');
  });
  it('cancelled, no-show and other-day and room-less bookings are ignored', () => {
    const st = by(roomStates({ ...args, bookings: [bk('hh', '12:00:00', '14:00:00', { status: 'Cancelled' }), bk('hh', '12:00:00', '14:00:00', { status: 'No Show' }), bk('hh', '12:00:00', '14:00:00', { date: '2026-11-23' })] }));
    expect(st.hh.state).toBe('free');
  });
  it('freeFrom waits for a long enough gap (a later booking can push it)', () => {
    const st = by(roomStates({ ...args, bookings: [bk('hh', '12:00:00', '13:00:00'), bk('hh', '14:00:00', '16:00:00')] }));
    expect(st.hh).toMatchObject({ state: 'full', freeFrom: '16:00' });
  });
  it('a booking that runs to the end of the day frees the room at its end', () => {
    const st = by(roomStates({ rooms: [rooms[2]], bookings: [bk('hh', '12:00:00', '23:59:00')], date: '2026-11-22', startTime: '12:00', durationMin: 120 }));
    expect(st.hh.state).toBe('full');
    expect(st.hh.freeFrom).toBe('23:59');
  });
  it('no time yet: no state, no status text', () => {
    const st = roomStates({ rooms, bookings: [], date: '', startTime: '' });
    expect(st.every((x) => x.state === null)).toBe(true); expect(statusText(st[0])).toBe(''); expect(anyAvailableLine(st)).toBe('');
  });
  it('minCapacity (shared group room) drops small rooms', () => {
    expect(roomStates({ ...args, bookings: [], minCapacity: 2 }).map((x) => x.room.id)).toEqual(['cm', 'fm']);
  });
  it('anyAvailableLine counts rooms that are not full', () => {
    const st = roomStates({ ...args, bookings: [bk('hh', '12:00:00', '14:00:00')] });
    expect(anyAvailableLine(st)).toBe('3 of 4 rooms free at this time');
  });
  it('capacityOf is the capacity column, default 1, exactly like api.getRoomCapacity', () => {
    expect(capacityOf({ capacity: 2 })).toBe(2); expect(capacityOf({})).toBe(1); expect(capacityOf({ amenities: ['Shower'] })).toBe(1);
    expect(capacityOf({ capacity: 0 })).toBe(0);
  });
});
