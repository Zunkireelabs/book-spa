// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const update = vi.fn(async () => ({ data: {}, error: null }));
vi.mock('../../../../services/api', async (orig) => ({
  ...(await orig()),
  updateWaitlistEntry: (...a) => update(...a),
  fetchCustomersLightweight: async () => ({ data: [] }),
  fetchRecentCustomerIds: async () => ({ data: [] }),
  fetchServiceBookingCounts: async () => ({ data: {} }),
  fetchServiceCategoryOrder: async () => ({ data: [] }),
}));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'manager' } }), useOptionalAuth: () => ({ profile: { id: 'u1', role: 'manager' } }) }));
vi.mock('../../../../hooks/useDayAvailability', () => ({ useDayAvailability: () => ({ ready: false, bookings: [], offById: {} }) }));
vi.mock('../../../../hooks/useIndustry', () => ({ useIndustry: () => ({ staffLabelPlural: 'Therapists' }) }));
import { WaitlistEntryForm } from './WaitlistPanel';

beforeEach(() => { window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }); update.mockClear(); });
afterEach(cleanup);

const initial = { id: 'w1', customerId: '', customerName: 'Sita Rai', customerPhone: '12345', customerCountryCode: '+977', originalPhone: '12345', serviceId: '', preferredDate: '', preferredTime: '', preferredTherapistId: '', notes: '' };
const mount = () => render(<WaitlistEntryForm initial={initial} services={[]} therapists={[]} branchId="b1" staffLabel="Therapist" onCancel={() => {}} onSaved={() => {}} />);

describe('WaitlistPanel phone (PhoneField)', () => {
  it('an untouched stored number saves exactly as stored', async () => {
    mount();
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0].customerPhone).toBe('12345');
  });
  it('a changed invalid number shows the reason and blocks the save', async () => {
    mount();
    fireEvent.change(document.getElementById('waitlist-phone'), { target: { value: '98000' } });
    expect(screen.getAllByText(/isn't valid for Nepal/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Save changes'));
    await new Promise((r) => setTimeout(r, 20));
    expect(update).not.toHaveBeenCalled();
  });
});
