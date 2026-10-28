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
});
