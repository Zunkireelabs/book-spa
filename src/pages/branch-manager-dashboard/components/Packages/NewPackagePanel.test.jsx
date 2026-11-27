// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../../services/api', () => ({
  fetchPackageTypes: vi.fn(async () => ({ data: [{ id: 'p1', name: '5 sessions', sessions_total: 5, price: 10000, validity_days: 90 }] })),
  createPackageType: vi.fn(async () => ({ data: null, error: null })),
  fetchServicesForManagement: vi.fn(async () => ({ data: [] })),
  issuePackage: vi.fn(async () => ({ data: {}, error: null })),
  fetchCustomersLightweight: vi.fn(async () => ({ data: [] })),
  fetchRecentCustomerIds: vi.fn(async () => ({ data: [] })),
}));
vi.mock('../../../../contexts/BranchContext', () => ({ useBranch: () => ({ branchId: 'b1', branchName: 'Main', isOverall: false }) }));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u1' } }), useOptionalAuth: () => ({ profile: { id: 'u1' } }) }));
vi.mock('../../../../contexts/OrgContext', () => ({ useOrg: () => ({ paymentMethods: [] }) }));
import NewPackagePanel from './NewPackagePanel';

beforeEach(() => { window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }); });
afterEach(cleanup);

describe('NewPackagePanel phone (PhoneField)', () => {
  it('an invalid typed number shows the reason under the field and as the footer reason', async () => {
    render(<NewPackagePanel userRole="manager" onClose={() => {}} onIssued={() => {}} />);
    await screen.findByText('Package type');
    fireEvent.change(document.getElementById('pkg-guest'), { target: { value: 'Sita Rai' } });
    fireEvent.change(document.getElementById('pkg-phone'), { target: { value: '98000' } });
    await waitFor(() => expect(screen.getAllByText(/isn't valid for Nepal/).length).toBeGreaterThanOrEqual(2));
  });
  it('a valid number is accepted', async () => {
    render(<NewPackagePanel userRole="manager" onClose={() => {}} onIssued={() => {}} />);
    await screen.findByText('Package type');
    fireEvent.change(document.getElementById('pkg-phone'), { target: { value: '9841234567' } });
    expect(screen.queryByText(/isn't valid for Nepal/)).toBeNull();
  });
});
