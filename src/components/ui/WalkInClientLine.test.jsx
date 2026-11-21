// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const link = vi.fn(async () => ({ data: {}, error: null }));
vi.mock('../../services/api', () => ({
  fetchCustomersLightweight: vi.fn(async () => ({ data: [{ id: 'c1', full_name: 'Sita Rai', phone: '+9779841221840' }] })),
  fetchRecentCustomerIds: vi.fn(async () => ({ data: ['c1'] })),
  linkWalkInClient: (...a) => link(...a),
}));
import WalkInClientLine from './WalkInClientLine';

beforeEach(() => { window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }); link.mockClear(); });
afterEach(cleanup);
const booking = { bookingId: 'bk1', branchId: 'b1', date: '2026-11-20', startTime: '12:45:00' };

describe('WalkInClientLine (walk-in header)', () => {
  it('shows Add client and "No customer profile yet"; no Add client when the booking cannot take one', () => {
    const { rerender } = render(<WalkInClientLine booking={booking} canAdd onLinked={() => {}} />);
    expect(screen.getByText('Add client')).toBeTruthy();
    expect(screen.getByText('No customer profile yet')).toBeTruthy();
    rerender(<WalkInClientLine booking={booking} canAdd={false} />);
    expect(screen.queryByText('Add client')).toBeNull();
  });
  it('the list has New customer and customers but no Walk-in row; picking one links it', async () => {
    const onLinked = vi.fn();
    render(<WalkInClientLine booking={booking} canAdd onLinked={onLinked} />);
    fireEvent.click(screen.getByText('Add client'));
    await screen.findByLabelText('Sita Rai');
    const labels = Array.from(document.querySelectorAll('[data-pick-none]')).map((r) => r.getAttribute('aria-label'));
    expect(labels).toEqual(['New customer', 'Sita Rai']);
    expect(screen.getByText('Add client to this booking')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Sita Rai'));
    await waitFor(() => expect(link).toHaveBeenCalledWith({ bookingId: 'bk1', customerId: 'c1' }));
    await waitFor(() => expect(onLinked).toHaveBeenCalled());
  });
  it('a new client needs a valid phone (same validator); a good one links', async () => {
    render(<WalkInClientLine booking={booking} canAdd onLinked={() => {}} />);
    fireEvent.click(screen.getByText('Add client'));
    fireEvent.click(await screen.findByLabelText('New customer'));
    await screen.findByLabelText('Client name');
    fireEvent.change(screen.getByLabelText('Client name'), { target: { value: 'Maya' } });
    fireEvent.change(screen.getByLabelText('Client phone'), { target: { value: '97000' } });
    fireEvent.click(screen.getAllByText('Add client').pop());
    expect(screen.getByRole('alert').textContent).toMatch(/isn't valid for Nepal/);
    expect(link).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Client phone'), { target: { value: '9841221840' } });
    fireEvent.click(screen.getAllByText('Add client').pop());
    await waitFor(() => expect(link).toHaveBeenCalledWith({ bookingId: 'bk1', customerName: 'Maya', customerPhone: '+9779841221840' }));
  });
});
