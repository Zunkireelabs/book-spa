import { describe, it, expect } from 'vitest';
import { computeGroupSlots } from './groupAvailability';

const baseArgs = (overrides = {}) => ({
  dates: [{ dayName: 'Mon', dayNumber: 2, monthName: 'Nov', fullDate: '2026-11-02', isToday: false, isWeekend: false }],
  availabilityWindow: { rooms: [], bookings: [] },
  therapistWindow: { bookings: [] },
  closedRanges: [],
  enableRooms: false,
  onlineCapacity: null,
  people: [],
  allTherapists: [{ id: 't1' }, { id: 't2' }],
  ...overrides,
});

describe('computeGroupSlots — two "any professional" guests never collapse onto one therapist', () => {
  it('marks a slot unavailable when only one therapist is free but two guests both want "any professional"', () => {
    const result = computeGroupSlots(baseArgs({
      people: [
        { id: 'lead', service: { id: 's1', duration_minutes: 60 }, professional: { mode: 'any' } },
        { id: 'guest-2', service: { id: 's1', duration_minutes: 60 }, professional: { mode: 'any' } },
      ],
      allTherapists: [{ id: 't1' }], // only one therapist exists at all
    }));
    const day = result.find((d) => d.date === '2026-11-02');
    const slot10am = day.slots.find((s) => s.time24 === '10:00');
    expect(slot10am.isAvailable).toBe(false);
  });

  it('marks the same slot available once a second therapist exists for the second guest', () => {
    const result = computeGroupSlots(baseArgs({
      people: [
        { id: 'lead', service: { id: 's1', duration_minutes: 60 }, professional: { mode: 'any' } },
        { id: 'guest-2', service: { id: 's1', duration_minutes: 60 }, professional: { mode: 'any' } },
      ],
    }));
    const day = result.find((d) => d.date === '2026-11-02');
    const slot10am = day.slots.find((s) => s.time24 === '10:00');
    expect(slot10am.isAvailable).toBe(true);
  });
});

describe('computeGroupSlots — a guest with zero eligible therapists blocks the whole group', () => {
  it('never offers a slot when one guest has no eligible therapist at all', () => {
    const result = computeGroupSlots(baseArgs({
      people: [{ id: 'lead', service: { id: 's1', duration_minutes: 60 }, professional: { mode: 'any' } }],
      allTherapists: [],
    }));
    const day = result.find((d) => d.date === '2026-11-02');
    expect(day.slots.every((s) => !s.isAvailable)).toBe(true);
  });
});

describe('computeGroupSlots — online capacity counts only "any professional" people', () => {
  it('does not shrink capacity for a person with a specific-therapist pick', () => {
    const result = computeGroupSlots(baseArgs({
      onlineCapacity: 1,
      people: [{ id: 'lead', service: { id: 's1', duration_minutes: 60 }, professional: { mode: 'specific', therapist: { id: 't1' } } }],
    }));
    const day = result.find((d) => d.date === '2026-11-02');
    expect(day.slots.find((s) => s.time24 === '10:00').isAvailable).toBe(true);
  });

  it('counts an EXISTING branch-wide online booking against the cap, not just the group\'s own members', () => {
    const result = computeGroupSlots(baseArgs({
      onlineCapacity: 1,
      availabilityWindow: {
        rooms: [],
        bookings: [{
          booking_date: '2026-11-02', start_time: '10:00:00', duration_minutes: 60,
          room_id: null, therapist_gender: null, counts_as_online_capacity: true,
        }],
      },
      people: [{ id: 'lead', service: { id: 's1', duration_minutes: 60 }, professional: { mode: 'any' } }],
    }));
    const day = result.find((d) => d.date === '2026-11-02');
    // cap is 1, one online booking already occupies it -- the group's own "any" person must not fit
    expect(day.slots.find((s) => s.time24 === '10:00').isAvailable).toBe(false);
  });
});

describe('computeGroupSlots — room capacity is actually consumed across people, not just checked', () => {
  it('does not offer a slot when N people would need N room-units but only one exists', () => {
    const result = computeGroupSlots(baseArgs({
      enableRooms: true,
      availabilityWindow: { rooms: [{ id: 'r1', capacity: 1 }], bookings: [] },
      people: [
        { id: 'lead', service: { id: 's1', duration_minutes: 60 }, professional: { mode: 'specific', therapist: { id: 't1' } } },
        { id: 'guest-2', service: { id: 's1', duration_minutes: 60 }, professional: { mode: 'specific', therapist: { id: 't2' } } },
      ],
    }));
    const day = result.find((d) => d.date === '2026-11-02');
    expect(day.slots.find((s) => s.time24 === '10:00').isAvailable).toBe(false);
  });

  it('offers the slot once a second room exists', () => {
    const result = computeGroupSlots(baseArgs({
      enableRooms: true,
      availabilityWindow: { rooms: [{ id: 'r1', capacity: 1 }, { id: 'r2', capacity: 1 }], bookings: [] },
      people: [
        { id: 'lead', service: { id: 's1', duration_minutes: 60 }, professional: { mode: 'specific', therapist: { id: 't1' } } },
        { id: 'guest-2', service: { id: 's1', duration_minutes: 60 }, professional: { mode: 'specific', therapist: { id: 't2' } } },
      ],
    }));
    const day = result.find((d) => d.date === '2026-11-02');
    expect(day.slots.find((s) => s.time24 === '10:00').isAvailable).toBe(true);
  });
});

describe('computeGroupSlots — "any professional" respects the unassigned-backlog reserve', () => {
  it('refuses a 2nd "any" guest when an existing unassigned booking already claims the slack', () => {
    const result = computeGroupSlots(baseArgs({
      allTherapists: [{ id: 't1' }, { id: 't2' }],
      therapistWindow: {
        bookings: [{ therapist_id: null, busy_date: '2026-11-02', start_time: '10:00:00', duration_minutes: 60 }],
      },
      people: [
        { id: 'lead', service: { id: 's1', duration_minutes: 60 }, professional: { mode: 'any' } },
        { id: 'guest-2', service: { id: 's1', duration_minutes: 60 }, professional: { mode: 'any' } },
      ],
    }));
    const day = result.find((d) => d.date === '2026-11-02');
    expect(day.slots.find((s) => s.time24 === '10:00').isAvailable).toBe(false);
  });
});
