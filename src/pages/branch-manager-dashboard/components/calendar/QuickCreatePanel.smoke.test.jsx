// @vitest-environment jsdom
// Render smoke test: the panel mounts (open and closed) without a runtime error such as use-before-declare, and shows its footer hint.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'manager' } }) }));
vi.mock('../../../../hooks/useIndustry', () => ({ useIndustry: () => ({ staffLabel: 'Therapist', staffLabelPlural: 'Therapists', locationLabel: 'Room' }) }));
vi.mock('../../../../hooks/useAvailabilityPrecheck', () => ({ useAvailabilityPrecheck: () => ({ blocked: false, warn: false }) }));
vi.mock('../../../../hooks/useBlockOverlap', () => ({ useDayBlocks: () => [] }));
vi.mock('../../../../services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getCustomerOutstandingBalance: vi.fn(async () => ({ data: null, error: null })),
  fetchServiceComboComponents: vi.fn(async () => ({ data: [], error: null })),
  fetchServices: vi.fn(async () => ({ data: [], error: null })),
  fetchServiceEligibility: vi.fn(async () => ({ data: [], error: null })),
}));

import QuickCreatePanel from './QuickCreatePanel';
import { newBookingSlot } from './newBookingSlot';

const props = {
  services: [{ id: 's1', name: 'Massage', duration_minutes: 60, requires_therapist: true }],
  servicesLoading: false,
  therapists: [{ id: 't1', name: 'Tara Gurung' }],
  rooms: [{ id: 'r1', name: 'Room 1', amenities: ['1 Bed'] }],
  bookings: [],
  onClose: vi.fn(),
  onSubmit: vi.fn(async () => null),
  branchId: 'b1',
  onDraftChange: vi.fn(),
};

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  window.HTMLElement.prototype.scrollIntoView = window.HTMLElement.prototype.scrollIntoView || (() => {});
});
afterEach(cleanup);

describe('QuickCreatePanel smoke', () => {
  it('renders closed without crashing', () => {
    expect(() => render(<QuickCreatePanel {...props} slotInfo={null} />)).not.toThrow();
  });
  it('renders open, with Create disabled and the "Pick a service" hint', () => {
    render(<QuickCreatePanel {...props} slotInfo={{ day: '2026-11-20', hour: 17, minute: 20, colType: 'therapist', colId: 't1', dragMinutes: 0 }} />);
    expect(screen.getByText('Pick a service')).toBeTruthy();
    expect(screen.getByRole('button', { name: /create booking/i }).disabled).toBe(true);
  });
  it('opens slot-less from a prefill (?view=new-booking): name, phone, email and gender are filled, service preselected', () => {
    const slot = newBookingSlot({
      today: '2026-11-20', nowHM: '17:20', branchHours: { openTime: '09:00:00', closeTime: '21:00:00' },
      prefill: { fullName: 'Hema Devi', phone: '+9779841000000', email: 'hema@example.com', gender: 'Female', serviceId: 's1' },
    });
    render(<QuickCreatePanel {...props} slotInfo={slot} />);
    // ZNLY-327: a known customer is an "existing" pick: the customer row shows name + phone (the typed fields only show for a new customer).
    expect(screen.getByText('Hema Devi')).toBeTruthy();
    expect(screen.getByText('+977 984-100-0000')).toBeTruthy();
    expect(screen.getByText('Existing customer')).toBeTruthy();
    expect(screen.getByText(/Massage/)).toBeTruthy();
    expect(screen.getByDisplayValue('5:30pm')).toBeTruthy();
  });

  describe('group mode (ZNLY-303)', () => {
    const slot = { day: '2026-11-20', hour: 14, minute: 0, colType: 'therapist', colId: 't1', dragMinutes: 0 };
    const gprops = {
      ...props,
      therapists: [{ id: 't1', name: 'Tara Gurung' }, { id: 't2', name: 'Mina Rai' }, { id: 't3', name: 'Sita Lama' }],
      rooms: [],
      offDate: '2026-11-20', // day data is only trusted for offDate; other dates are fetched (ZNLY-310)
    };
    const openSeparate = (extra = {}) => {
      const r = render(<QuickCreatePanel {...gprops} {...extra} slotInfo={slot} />);
      fireEvent.click(screen.getByRole('button', { name: 'Group' }));
      fireEvent.click(screen.getByRole('button', { name: 'Separate' }));
      return r;
    };
    const pickGroupService = () => {
      fireEvent.click(screen.getAllByRole('button', { name: /Pick a service/ })[0]); // [0] = the row; the footer reason is the same words
      fireEvent.click(screen.getByRole('radio', { name: 'Massage' }));
    };
    it('no Fill bar until a service exists (ZNLY-322)', () => {
      openSeparate();
      expect(screen.queryByText(/guests have no therapist/)).toBeNull();
      pickGroupService();
      expect(screen.getByText('3 of 3 guests have no therapist')).toBeTruthy();
    });
    it('renders 3 guests, each with an empty "Pick staff" row, a Fill bar and "Create 3 bookings"', () => {
      openSeparate();
      pickGroupService();
      expect(screen.getAllByRole('button', { name: /Pick therapist/ })).toHaveLength(3);
      expect(screen.getByText('3 of 3 guests have no therapist')).toBeTruthy();
      expect(screen.getByRole('button', { name: /create 3 bookings/i })).toBeTruthy();
    });
    it('Fill free staff gives each guest a different person, then Undo restores the empty rows', () => {
      openSeparate();
      pickGroupService();
      fireEvent.click(screen.getByRole('button', { name: /Fill free therapists/ }));
      expect(screen.getByText('All 3 guests have therapists · 3 filled')).toBeTruthy();
      const names = ['Tara Gurung', 'Mina Rai', 'Sita Lama'].filter((n) => screen.queryByText(n));
      expect(names).toHaveLength(3);
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      expect(screen.getAllByRole('button', { name: /Pick therapist/ })).toHaveLength(3);
    });
    it('a pick that is busy at the group time turns the row amber and gives the footer reason', () => {
      const busy = [{ id: 'bk', date: '2026-11-20', start_time: '14:00:00', end_time: '15:00:00', status: 'Confirmed', therapist_id: 't1' }];
      openSeparate({ bookings: busy });
      fireEvent.click(screen.getAllByRole('button', { name: /Pick therapist/ })[0]);
      fireEvent.click(screen.getByRole('radio', { name: /Tara Gurung/ }));
      expect(screen.getAllByText(/Tara Gurung is busy/).length).toBeGreaterThan(0);
      expect(document.querySelector('.border-amber-300')).toBeTruthy();
    });
  });
});
