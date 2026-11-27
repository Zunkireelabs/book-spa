import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/api', () => ({
  fetchRelatedUnpaidBookings: vi.fn(() => 'old-related'),
  fetchGroupBookings: vi.fn(() => 'old-siblings'),
  fetchVisitRelatedUnpaidBookings: vi.fn(() => 'visit-related'),
  fetchVisitSiblings: vi.fn(() => 'visit-siblings'),
}));

import * as api from '../services/api';
import { relatedFetchers, clientRules } from './visitGate';
import { buildClientIndex, clientDayInfo } from '../pages/branch-manager-dashboard/components/calendar/sameClient';
import { buildVisitIndex, visitDayInfo } from '../pages/branch-manager-dashboard/components/calendar/sameVisit';

const b = { bookingId: 'a', visitId: 'v1', customerId: 'c1', customerName: 'Mira', date: '2026-11-20', bookingGroupId: 'g1' };

describe('multi_service_bookings gate', () => {
  it('false: original functions and original arguments', () => {
    const f = relatedFetchers(false);
    expect(f.related(b)).toBe('old-related');
    expect(f.siblings(b)).toBe('old-siblings');
    expect(api.fetchRelatedUnpaidBookings).toHaveBeenCalledWith({ customerName: 'Mira', date: '2026-11-20', excludeBookingId: 'a', bookingGroupId: 'g1', customerId: 'c1' });
    expect(api.fetchVisitRelatedUnpaidBookings).not.toHaveBeenCalled();
    expect(clientRules(false)).toEqual({ buildIndex: buildClientIndex, dayInfo: clientDayInfo });
  });
  it('true: visit functions, keyed on visitId', () => {
    const f = relatedFetchers(true);
    expect(f.related(b)).toBe('visit-related');
    expect(f.siblings(b)).toBe('visit-siblings');
    expect(api.fetchVisitRelatedUnpaidBookings).toHaveBeenCalledWith({ excludeBookingId: 'a', visitId: 'v1', customerId: 'c1' });
    expect(api.fetchVisitSiblings).toHaveBeenCalledWith({ visitId: 'v1', excludeBookingId: 'a', customerId: 'c1' });
    expect(clientRules(true)).toEqual({ buildIndex: buildVisitIndex, dayInfo: visitDayInfo });
  });
});
