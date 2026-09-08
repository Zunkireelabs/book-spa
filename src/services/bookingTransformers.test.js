import { describe, it, expect } from 'vitest';
import { excludeRelatedFromPreviousDue } from './bookingTransformers';

describe('excludeRelatedFromPreviousDue', () => {
  it('removes a previousDue booking whose bookingId matches a related booking id', () => {
    const previousDue = [
      { bookingId: 'booking-0011', bookingNumber: 'BK-20260908-0011', amountDue: 4200 },
    ];
    const related = [
      { id: 'booking-0011', booking_number: 'BK-20260908-0011', base_amount: 4200 },
    ];
    expect(excludeRelatedFromPreviousDue(previousDue, related)).toEqual([]);
  });

  it('keeps a previousDue booking that has no matching related booking (genuine separate due)', () => {
    const previousDue = [
      { bookingId: 'booking-old-01', bookingNumber: 'BK-20260801-0003', amountDue: 1500 },
    ];
    const related = [
      { id: 'booking-0011', booking_number: 'BK-20260908-0011', base_amount: 4200 },
    ];
    expect(excludeRelatedFromPreviousDue(previousDue, related)).toEqual(previousDue);
  });

  it('only removes the overlapping entry, keeping the rest, when previousDue has a mix', () => {
    const previousDue = [
      { bookingId: 'booking-0011', bookingNumber: 'BK-20260908-0011', amountDue: 4200 },
      { bookingId: 'booking-old-01', bookingNumber: 'BK-20260801-0003', amountDue: 1500 },
    ];
    const related = [
      { id: 'booking-0011', booking_number: 'BK-20260908-0011', base_amount: 4200 },
    ];
    expect(excludeRelatedFromPreviousDue(previousDue, related)).toEqual([
      { bookingId: 'booking-old-01', bookingNumber: 'BK-20260801-0003', amountDue: 1500 },
    ]);
  });

  it('returns an empty array when previousDue is empty', () => {
    const related = [{ id: 'booking-0011' }];
    expect(excludeRelatedFromPreviousDue([], related)).toEqual([]);
  });

  it('returns the full previousDue array when related is empty', () => {
    const previousDue = [{ bookingId: 'booking-old-01', amountDue: 1500 }];
    expect(excludeRelatedFromPreviousDue(previousDue, [])).toEqual(previousDue);
  });

  it('treats null/undefined inputs as empty arrays', () => {
    expect(excludeRelatedFromPreviousDue(null, null)).toEqual([]);
    expect(excludeRelatedFromPreviousDue(undefined, undefined)).toEqual([]);
    const previousDue = [{ bookingId: 'booking-old-01', amountDue: 1500 }];
    expect(excludeRelatedFromPreviousDue(previousDue, null)).toEqual(previousDue);
  });
});
