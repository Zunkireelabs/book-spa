import { describe, it, expect } from 'vitest';
import { buildTherapistOccupancy, isTherapistFree, anyProfessionalFree } from './therapistAvailability';

const DATE = '2026-10-10';
const T1 = 'therapist-1';
const T2 = 'therapist-2';

describe('buildTherapistOccupancy / isTherapistFree', () => {
  it('blocks a therapist for the full span of a booking that overlaps the candidate slot', () => {
    const occ = buildTherapistOccupancy([
      { therapist_id: T1, busy_date: DATE, start_time: '10:00', duration_minutes: 60, source: 'booking' },
    ]);
    // Candidate 60-min service starting 10:30 overlaps the 10:00-11:00 booking.
    expect(isTherapistFree(occ, T1, DATE, 630, 60)).toBe(false);
    // A different therapist is unaffected.
    expect(isTherapistFree(occ, T2, DATE, 630, 60)).toBe(true);
    // Fully after the booking ends — free.
    expect(isTherapistFree(occ, T1, DATE, 660, 30)).toBe(true);
  });

  it('aligns a non-boundary start down to the 30-min grid before blocking', () => {
    // 16:05 start, 20-min duration (ends 16:25, before the 16:30 boundary) ->
    // occupies only the 16:00 slot (aligned down), not 16:30.
    const occ = buildTherapistOccupancy([
      { therapist_id: T1, busy_date: DATE, start_time: '16:05', duration_minutes: 20, source: 'booking' },
    ]);
    expect(isTherapistFree(occ, T1, DATE, 16 * 60, 30)).toBe(false); // 16:00 slot blocked
    expect(isTherapistFree(occ, T1, DATE, 16 * 60 + 30, 30)).toBe(true); // 16:30 slot free
  });

  it('treats a full-day absence row as blocking every slot that day', () => {
    const occ = buildTherapistOccupancy([
      { therapist_id: T1, busy_date: DATE, start_time: '00:00', duration_minutes: 1440, source: 'absence' },
    ]);
    expect(isTherapistFree(occ, T1, DATE, 9 * 60, 60)).toBe(false);
    expect(isTherapistFree(occ, T1, DATE, 19 * 60 + 30, 30)).toBe(false);
  });

  it('treats a checkout tail as blocking only the remainder of the day', () => {
    // Checked out at 15:00 -> 15:00-24:00 blocked, before 15:00 still free.
    const occ = buildTherapistOccupancy([
      { therapist_id: T1, busy_date: DATE, start_time: '15:00', duration_minutes: 540, source: 'checkout' },
    ]);
    expect(isTherapistFree(occ, T1, DATE, 14 * 60, 30)).toBe(true);
    expect(isTherapistFree(occ, T1, DATE, 15 * 60, 30)).toBe(false);
    expect(isTherapistFree(occ, T1, DATE, 20 * 60, 30)).toBe(false);
  });

  it('counts unassigned (NULL-therapist) rows separately from any specific therapist', () => {
    const occ = buildTherapistOccupancy([
      { therapist_id: null, busy_date: DATE, start_time: '10:00', duration_minutes: 60, source: 'unassigned' },
    ]);
    expect(occ.unassigned[DATE].get(600)).toBe(1);
    expect(isTherapistFree(occ, T1, DATE, 600, 60)).toBe(true);
  });
});

describe('anyProfessionalFree', () => {
  it('is free when more eligible therapists are open than there are unassigned bookings claiming the slot', () => {
    const occ = buildTherapistOccupancy([
      { therapist_id: T1, busy_date: DATE, start_time: '10:00', duration_minutes: 60, source: 'booking' },
      { therapist_id: null, busy_date: DATE, start_time: '10:00', duration_minutes: 60, source: 'unassigned' },
    ]);
    // T1 busy, T2 free, 1 unassigned pending -> freeCount(1) > unassignedCount(1) is false -> blocked
    expect(anyProfessionalFree(occ, [T1, T2], DATE, 600, 60)).toBe(false);
  });

  it('is free when free staff outnumber pending unassigned bookings', () => {
    const occ = buildTherapistOccupancy([
      { therapist_id: null, busy_date: DATE, start_time: '10:00', duration_minutes: 60, source: 'unassigned' },
    ]);
    // Both T1 and T2 free, only 1 unassigned -> 2 > 1 -> true
    expect(anyProfessionalFree(occ, [T1, T2], DATE, 600, 60)).toBe(true);
  });

  it('returns false when the eligible staff list is empty', () => {
    const occ = buildTherapistOccupancy([]);
    expect(anyProfessionalFree(occ, [], DATE, 600, 60)).toBe(false);
  });

  it('is false if any slot in the span fails, even if others pass', () => {
    const occ = buildTherapistOccupancy([
      { therapist_id: T1, busy_date: DATE, start_time: '10:30', duration_minutes: 30, source: 'booking' },
      { therapist_id: T2, busy_date: DATE, start_time: '10:30', duration_minutes: 30, source: 'booking' },
    ]);
    // 90-min service from 10:00: slot 10:00 both free (2>0 true), slot 10:30 both busy (0>0 false)
    expect(anyProfessionalFree(occ, [T1, T2], DATE, 600, 90)).toBe(false);
  });
});
