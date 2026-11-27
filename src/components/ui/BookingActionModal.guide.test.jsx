// @vitest-environment jsdom
// ZNLY-365 scene 6 and refused saves inside the booking panel: the ✦ card replaces the old red line.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'staff', id: 'u1' }, user: { id: 'u1' } }), useOptionalAuth: () => ({ profile: { role: 'staff', id: 'u1' }, user: { id: 'u1' } }) }));
vi.mock('../../contexts/BranchContext', () => ({ useBranch: () => ({ activeBranch: { id: 'b1', name: 'Thamel' }, branchId: 'b1' }) }));
vi.mock('../../contexts/OrgContext', () => ({ useOrg: () => ({ org: { id: 'o1', slug: 'nuad' }, paymentMethods: [], orgSettings: {}, staffLabel: 'Therapist', staffLabelPlural: 'Therapists' }) }));
vi.mock('../../hooks/useBlockOverlap', () => ({ useBlockOverlap: () => ({ message: null }), useDayBlocks: () => [] }));
vi.mock('../../hooks/useDayAvailability', () => ({ useDayAvailability: () => ({ ready: false, bookings: [], offById: {} }) }));

// ZNLY-435: every booking is the "This booking" card, so the panel reads its rows from fetchBookingServices (one row here).
const rows = [{ id: 'uuid-1', booking_number: 'BK-1', status: 'Confirmed', payment_status: 'unpaid', date: '2026-11-22', start_time: '12:00:00', end_time: '14:00:00', base_amount: 8400, discount_amount: 0, final_amount: 8400, service_id: 's1', therapist_id: 't1', service: { name: 'ENERGISE BODY', duration_minutes: 120 }, therapist: { name: 'Susan Nagarkoti' }, booking_therapists: [], payments: [], payment_refunds: [] }];
vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchBookingServices: vi.fn(async () => ({ data: rows, error: null })),
  fetchRelatedUnpaidBookings: vi.fn(async () => ({ data: [] })),
  fetchGroupBookings: vi.fn(async () => ({ data: [] })),
  getCustomerOutstandingBalance: vi.fn(async () => ({ data: { bookings: [] } })),
  fetchMemberDiscountContext: vi.fn(async () => ({ data: null })),
  fetchDiscountApprovers: vi.fn(async () => ({ data: [] })),
}));
import { MemoryRouter } from 'react-router-dom';
import BookingActionModal from './BookingActionModal';
const Modal = (props) => <MemoryRouter><BookingActionModal {...props} /></MemoryRouter>;

beforeAll(() => {
  window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
  globalThis.ResizeObserver = window.ResizeObserver;
  window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  window.HTMLElement.prototype.scrollIntoView = window.HTMLElement.prototype.scrollIntoView || (() => {});
});
afterEach(cleanup);

const booking = {
  id: 'BK-1', bookingId: 'uuid-1', customerName: 'Anish Balami', customerPhone: '+9779841000000', service: 'ENERGISE BODY', serviceId: 's1', duration: '120 min',
  date: '2026-11-22', time: '12:00', startTime: '12:00:00', endTime: '14:00:00', status: 'confirmed', paymentStatus: 'unpaid', baseAmount: 8400, discountAmount: 0, finalAmount: 8400,
  amountPaid: 0, amountDue: 8400, therapists: [{ id: 't1', name: 'Susan Nagarkoti' }], therapist: { id: 't1', name: 'Susan Nagarkoti' }, payments: [], isLocked: false,
};
const base = { isOpen: true, booking, therapists: [{ id: 't1', name: 'Susan Nagarkoti' }], rooms: [], services: [], userRole: 'staff', onClose: vi.fn(), initialTab: 'discount', variant: 'panel', onRefreshBooking: vi.fn() };

describe('BookingActionModal guidance cards', () => {
  it('scene 6: a staff login typing 60% sees the ✦ card, and "Set to 50%" only fills the box', async () => {
    render(<Modal {...base} />);
    const input = await screen.findByPlaceholderText(/Max 50%/);
    fireEvent.change(input, { target: { value: '60' } });
    await waitFor(() => expect(document.querySelector('[data-guide-card="DISCOUNT_LIMIT_EXCEEDED"]')).toBeTruthy());
    const card = document.querySelector('[data-guide-card="DISCOUNT_LIMIT_EXCEEDED"]');
    expect(card.textContent).toMatch(/Your discount limit is 50%\. Managers and admins can give up to 100%\./);
    expect(screen.queryByText(/Discount cannot exceed/)).toBeNull();
    fireEvent.click(screen.getByText('Set to 50%'));
    expect(input.value).toBe('50');
    expect(document.querySelector('[data-guide-card="DISCOUNT_LIMIT_EXCEEDED"]')).toBeNull();
    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.click(screen.getByText('Ask a manager'));
    expect(document.querySelector('[data-guide-note]').textContent).toMatch(/Ask one of them/);
  });

  it('a refused status change shows the card inside the panel (and the panel stays open)', async () => {
    const onUpdateStatus = vi.fn(async () => ({ error: { code: 'REASON_REQUIRED', message: 'A reason is required' } }));
    const onClose = vi.fn();
    render(<Modal {...base} initialTab={null} onUpdateStatus={onUpdateStatus} onClose={onClose} />);
    await screen.findAllByRole('button');
    const btn = screen.getByRole('button', { name: /^start/i });
    fireEvent.click(btn);
    await waitFor(() => expect(document.querySelector('[data-guide-card="REASON_REQUIRED"]')).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });
});
