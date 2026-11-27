// @vitest-environment jsdom
// Render smoke test: the panel mounts (open and closed) without a runtime error such as use-before-declare, and shows its footer hint.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'manager' } }), useOptionalAuth: () => ({ profile: { role: 'manager' } }) }));
vi.mock('../../../../contexts/OrgContext', () => ({ useOrg: () => ({ allowStaffOverlap: false, requireCustomerPhone: true }) }));
vi.mock('../../../../hooks/useIndustry', () => ({ useIndustry: () => ({ staffLabel: 'Therapist', staffLabelPlural: 'Therapists', locationLabel: 'Room' }) }));
const precheckMock = vi.hoisted(() => ({ value: { blocked: false, warn: false } }));
vi.mock('../../../../hooks/useAvailabilityPrecheck', () => ({ useAvailabilityPrecheck: () => precheckMock.value }));
vi.mock('../../../../hooks/useBlockOverlap', () => ({ useDayBlocks: () => [] }));
vi.mock('../../../../services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getCustomerOutstandingBalance: vi.fn(async () => ({ data: null, error: null })),
  fetchServiceComboComponents: vi.fn(async () => ({ data: [], error: null })),
  fetchServices: vi.fn(async () => ({ data: [], error: null })),
  fetchServiceEligibility: vi.fn(async () => ({ data: [], error: null })),
  fetchCustomerName: vi.fn(async () => ({ data: 'Hema Demo', error: null })),
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
afterEach(() => { cleanup(); precheckMock.value = { blocked: false, warn: false }; });

describe('QuickCreatePanel smoke', () => {
  it('renders closed without crashing', () => {
    expect(() => render(<QuickCreatePanel {...props} slotInfo={null} />)).not.toThrow();
  });
  it('renders open, with Create disabled and the first hint naming the customer (customer comes first)', () => {
    render(<QuickCreatePanel {...props} slotInfo={{ day: '2026-11-20', hour: 17, minute: 20, colType: 'therapist', colId: 't1', dragMinutes: 0 }} />);
    expect(screen.getAllByText(/Pick a customer/).length).toBeGreaterThan(1); // the row and the footer reason
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

  it('ZNLY-402 U10: every business gets the grey service card from the first service: no "Service 1" title, Remove or Starts while single (OFF org: no Add button)', () => {
    const slot = newBookingSlot({
      today: '2026-11-20', nowHM: '17:20', branchHours: { openTime: '09:00:00', closeTime: '21:00:00' },
      prefill: { fullName: 'Hema Devi', phone: '+9779841000000', serviceId: 's1' },
    });
    render(<QuickCreatePanel {...props} slotInfo={slot} />);
    expect(document.querySelector('[data-extra-services]')).toBeTruthy();
    expect(screen.queryByText('Service 1')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove service/ })).toBeNull();
    expect(screen.queryByText('Starts')).toBeNull();
    expect(screen.queryByText('Add another service')).toBeNull();
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
    it('ZNLY-331: an invalid typed guest number blocks Create with the reason; an empty guest number is still allowed', () => {
      openSeparate();
      pickGroupService();
      fireEvent.click(screen.getAllByRole('button', { name: /Pick a customer/ })[0]);
      fireEvent.click(screen.getByLabelText('Walk-in'));
      const create = () => screen.getByRole('button', { name: /create 3 bookings/i });
      expect(create().disabled).toBe(false); // guests left empty are fine (they share the contact)
      const guestPhone = document.getElementById('qc-person-1-phone');
      expect(guestPhone).toBeTruthy();
      fireEvent.change(guestPhone, { target: { value: '98000' } });
      expect(screen.getAllByText(/isn't valid for Nepal/).length).toBeGreaterThan(0);
      expect(create().disabled).toBe(true);
      fireEvent.change(guestPhone, { target: { value: '' } });
      expect(create().disabled).toBe(false);
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
  it('ZNLY-365: opened from a walk-in booking it is "Add a service": client locked, no Individual/Group toggle, staff and time pre-filled', () => {
    const slot = { day: '2026-11-22', hour: 11, minute: 50, title: 'Add a service', openServiceFirst: true, defaultTherapistIds: ['t1'], lockedClient: { kind: 'walkin', walkInLabel: 'Sahil', bookingNumber: 'BK-20261122-0015' } };
    const { container } = render(<QuickCreatePanel {...props} slotInfo={slot} />);
    expect(screen.getByText('Add a service')).toBeTruthy();
    expect(container.ownerDocument.querySelector('[data-locked-client]').textContent).toMatch(/Walk-in · Sahil.*Same client as BK-20261122-0015/);
    expect(screen.queryByText('Individual')).toBeNull();
    expect(screen.queryByPlaceholderText(/First name, e.g. Ram/)).toBeNull();
    expect(screen.getByDisplayValue('11:50am')).toBeTruthy();
  });
  it('ZNLY-365: a locked known client needs no phone: Create is blocked only by the missing service', () => {
    const slot = { day: '2026-11-22', hour: 11, minute: 50, title: 'Rebook', defaultCustomerId: 'c1', defaultCustomerName: 'Anish Balami', lockedClient: { kind: 'existing', customerId: 'c1', name: 'Anish Balami', bookingNumber: 'BK-1' } };
    render(<QuickCreatePanel {...props} slotInfo={slot} />);
    expect(screen.getByText('Anish Balami')).toBeTruthy();
    expect(screen.getByText('Pick a service')).toBeTruthy();
  });
  it('ZNLY-365 live guidance: every room taken at the chosen time shows the ✦ card, outlines the time and blocks Create', () => {
    const rooms = [{ id: 'r1', name: 'BANGKOK', amenities: ['1 Bed'] }, { id: 'r2', name: 'HUA HIN', amenities: ['1 Bed'] }];
    const bookings = ['r1', 'r2'].map((room_id) => ({ id: `b-${room_id}`, date: '2026-11-22', status: 'Confirmed', room_id, start_time: '12:00:00', end_time: '14:00:00' }));
    const slot = { day: '2026-11-22', hour: 12, minute: 0, defaultServiceId: 's1', walkIn: true };
    const { container } = render(<QuickCreatePanel {...props} rooms={rooms} bookings={bookings} slotInfo={slot} />);
    const card = container.ownerDocument.querySelector('[data-guide-card="ROOMS_FULL"]');
    expect(card).toBeTruthy();
    expect(card.textContent).toMatch(/Every room is taken 12:00pm–1:00pm\./);
    expect(card.textContent).toMatch(/Book at 2:00pm/);
    expect(screen.getByRole('button', { name: /create booking/i }).disabled).toBe(true);
    fireEvent.click(screen.getByText('Book at 2:00pm'));
    expect(container.ownerDocument.querySelector('[data-guide-card="ROOMS_FULL"]')).toBeNull();
  });
  it('ZNLY-365: a beauty org (no rooms) never sees room wording in a guidance card', () => {
    const slot = { day: '2026-11-22', hour: 12, minute: 0, defaultServiceId: 's1', walkIn: true };
    const { container } = render(<QuickCreatePanel {...props} rooms={[]} bookings={[]} slotInfo={slot} />);
    expect(container.ownerDocument.querySelector('[data-guide-card]')).toBeNull();
    expect(container.ownerDocument.body.textContent).not.toMatch(/Pick a room|Any available/);
  });
  const refusedSave = async (result) => {
    const onSubmit = vi.fn(async () => result);
    const slot = { day: '2026-11-22', hour: 12, minute: 0, defaultServiceId: 's1', walkIn: true, defaultTherapistIds: ['t1'] };
    const { container } = render(<QuickCreatePanel {...props} onSubmit={onSubmit} slotInfo={slot} />);
    fireEvent.click(screen.getByRole('button', { name: /create booking/i }));
    await vi.waitFor(() => expect(container.ownerDocument.querySelector('[data-guide-card],[data-system-error]')).toBeTruthy());
    return { container, onSubmit };
  };
  it('ZNLY-365: a refused save shows the ✦ card with a fix button that only fills the form (no second save)', async () => {
    const { container, onSubmit } = await refusedSave({ message: 'x', code: 'THERAPIST_CONFLICT', raw: { code: 'THERAPIST_CONFLICT', message: 'x' } });
    expect(container.ownerDocument.querySelector('[data-guide-card="THERAPIST_CONFLICT"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: /create booking/i }).disabled).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
  it('ZNLY-365: a server error shows the calm grey card with Try again and a Ref; Try again repeats the save', async () => {
    const { container, onSubmit } = await refusedSave({ message: 'Failed', code: 'XX999', raw: { code: 'XX999', message: 'weird' } });
    expect(container.ownerDocument.querySelector('[data-system-error]')).toBeTruthy();
    expect(container.ownerDocument.querySelector('[data-error-ref]').textContent).toMatch(/^Ref: /);
    fireEvent.click(screen.getByText('Try again'));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  });
  it('ZNLY-365: after a lost connection it says so, offers Show on calendar and no Try again', async () => {
    const { container } = await refusedSave({ message: "Couldn't reach the server.", code: undefined, raw: new TypeError('Failed to fetch') });
    expect(screen.getByText('Connection lost.')).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
    expect(screen.getByText('Show on calendar')).toBeTruthy();
    expect(container.ownerDocument.body.textContent).not.toMatch(/nothing was changed/i);
  });
  it('ZNLY-365: a manager picking busy staff sees the ✦ card live (no Create press), with "Give it to <free person>", and Create stays enabled', () => {
    precheckMock.value = { blocked: false, warn: true, canOverride: true, nextFree: ['13:00'], otherFree: null,
      verdict: { code: 'OVERLAP', message: 'Tara Gurung already has a booking 12:00pm–1:00pm' } };
    const bookings = [{ id: 'bx', date: '2026-11-22', status: 'Confirmed', therapist_id: 't1', start_time: '12:00:00', end_time: '13:00:00' }];
    const slot = { day: '2026-11-22', hour: 12, minute: 0, defaultServiceId: 's1', walkIn: true, defaultTherapistIds: ['t1'] };
    const { container } = render(<QuickCreatePanel {...props} therapists={[{ id: 't1', name: 'Tara Gurung' }, { id: 't2', name: 'Asha Rai' }]} bookings={bookings} offDate="2026-11-22" offStaff={{}} slotInfo={slot} />);
    const card = container.ownerDocument.querySelector('[data-guide-card="OVERLAP"]');
    expect(card).toBeTruthy();
    expect(card.textContent).toMatch(/Give it to Asha/);
    expect(card.textContent).toMatch(/Book at 13:00|Book at 1:00pm/);
    expect(container.ownerDocument.body.textContent).toMatch(/You can still book it; you'll be asked why\./);
    expect(screen.getByRole('button', { name: /book anyway|create booking/i }).disabled).toBe(false);
    fireEvent.click(screen.getByText(/Give it to Asha/));
    expect(container.ownerDocument.body.textContent).toMatch(/Asha Rai/);
  });
  it('ZNLY-365: with no precheck verdict (staff-availability rule off) a busy picked person still gets the live ✦ card and Create is disabled', () => {
    const bookings = [{ id: 'bx', date: '2026-11-22', status: 'Confirmed', therapist_id: 't1', start_time: '12:30:00', end_time: '13:30:00' }];
    const slot = { day: '2026-11-22', hour: 12, minute: 0, defaultServiceId: 's1', walkIn: true, defaultTherapistIds: ['t1'] };
    const { container } = render(<QuickCreatePanel {...props} therapists={[{ id: 't1', name: 'Tara Gurung' }, { id: 't2', name: 'Asha Rai' }]} bookings={bookings} offDate="2026-11-22" offStaff={{}} slotInfo={slot} />);
    const card = container.ownerDocument.querySelector('[data-guide-card="THERAPIST_CONFLICT"]');
    expect(card).toBeTruthy();
    expect(card.textContent).toMatch(/Tara Gurung is already booked 12:30pm–1:30pm/);
    expect(card.textContent).toMatch(/Book at 1:30pm/);
    expect(card.textContent).toMatch(/Give it to Asha/);
    expect(screen.getByRole('button', { name: /create booking/i }).disabled).toBe(true);
  });
  it('ZNLY-365: a part-created group shows "N of M bookings were already created", only Show on calendar, and Create stays disabled', async () => {
    const { container } = await refusedSave({ message: 'Failed for Ram: x (2 bookings already created)', code: 'ROOMS_FULL', raw: { code: 'ROOMS_FULL' }, partial: { created: 2, total: 3 } });
    const card = container.ownerDocument.querySelector('[data-guide-card="ROOMS_FULL"]');
    expect(card.textContent).toMatch(/2 of 3 bookings were already created\./);
    expect(screen.getByText('Show on calendar')).toBeTruthy();
    expect(screen.queryByText(/Book at/)).toBeNull();
    expect(screen.getByRole('button', { name: /create booking/i }).disabled).toBe(true);
  });
  it('ZNLY-365: Show on calendar closes without the discard prompt and refreshes the calendar', async () => {
    const onClose = vi.fn(); const onRefreshCalendar = vi.fn();
    const onSubmit = vi.fn(async () => ({ message: 'x', code: 'BOOKING_CONFIRMATION_UNAVAILABLE', raw: { code: 'BOOKING_CONFIRMATION_UNAVAILABLE' } }));
    const slot = { day: '2026-11-22', hour: 12, minute: 0, defaultServiceId: 's1', walkIn: true, defaultTherapistIds: ['t1'] };
    const { container } = render(<QuickCreatePanel {...props} onClose={onClose} onRefreshCalendar={onRefreshCalendar} onSubmit={onSubmit} slotInfo={slot} />);
    fireEvent.click(screen.getByRole('button', { name: /create booking/i }));
    await vi.waitFor(() => expect(container.ownerDocument.querySelector('[data-guide-card]')).toBeTruthy());
    expect(screen.getByRole('button', { name: /create booking/i }).disabled).toBe(true);
    fireEvent.click(screen.getByText('Show on calendar'));
    expect(onRefreshCalendar).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(container.ownerDocument.querySelector('[role="alertdialog"]')).toBeNull();
  });
  it('ZNLY-365: a freshly opened Rebook / + Service panel (preset service, staff, locked client) is not dirty: Cancel closes at once', () => {
    const onClose = vi.fn();
    const slot = { day: '2026-11-22', hour: 12, minute: 0, title: 'Rebook', defaultServiceId: 's1', defaultTherapistIds: ['t1', 't2'], lockedClient: { kind: 'existing', customerId: 'c1', name: 'Anish Balami' }, defaultCustomerId: 'c1', defaultCustomerName: 'Anish Balami' };
    const { container } = render(<QuickCreatePanel {...props} therapists={[{ id: 't1', name: 'Tara Gurung' }, { id: 't2', name: 'Asha Rai' }]} onClose={onClose} slotInfo={slot} />);
    fireEvent.click(screen.getAllByRole('button', { name: /^cancel$/i })[0]);
    expect(container.ownerDocument.querySelector('[role="alertdialog"]')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('ZNLY-365: a walk-in booking with a linked client shows the client RECORD name (not "Walk-in · Sahil") and no Walk-in tag', async () => {
    const slot = { day: '2026-11-22', hour: 12, minute: 0, defaultCustomerId: 'c9', defaultCustomerName: '', lockedClient: { kind: 'existing', customerId: 'c9', name: '', bookingNumber: 'BK-1' } };
    const { container } = render(<QuickCreatePanel {...props} slotInfo={slot} />);
    await vi.waitFor(() => expect(container.ownerDocument.querySelector('[data-locked-client]').textContent).toMatch(/Hema Demo/));
    const card = container.ownerDocument.querySelector('[data-locked-client]');
    expect(card.textContent).not.toMatch(/Walk-in|Sahil/);
    expect(card.textContent).toMatch(/Same client as BK-1/);
  });
});
