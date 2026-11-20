// @vitest-environment jsdom
// Render smoke test: the panel mounts (open and closed) without a runtime error such as use-before-declare, and shows its footer hint.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

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
});
