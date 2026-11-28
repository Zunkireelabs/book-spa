// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../../services/api', () => ({
  fetchMembershipTiers: vi.fn(async () => ({ data: [] })),
  fetchCustomersLightweight: vi.fn(async () => ({ data: [] })),
  fetchRecentCustomerIds: vi.fn(async () => ({ data: [] })),
  findOrCreateCustomer: vi.fn(async () => ({ data: null, error: null })),
  enrollMember: vi.fn(async () => ({ data: null, error: null })),
}));
vi.mock('../../../../contexts/BranchContext', () => ({ useBranch: () => ({ branchId: 'b1' }) }));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u1', org_id: 'o1', role: 'manager' } }), useOptionalAuth: () => ({ profile: { id: 'u1', org_id: 'o1', role: 'manager' } }) }));
vi.mock('../../../../contexts/OrgContext', () => ({ useOrg: () => ({ paymentMethods: [] }) }));
import EnrollMemberPanel from './EnrollMemberPanel';

beforeEach(() => { window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }); });
afterEach(cleanup);

describe('EnrollMemberPanel phone (PhoneField)', () => {
  it('an invalid typed number shows the reason under the field and is the footer reason', async () => {
    render(<EnrollMemberPanel onClose={() => {}} onEnrolled={() => {}} />);
    fireEvent.change(document.getElementById('enr-name'), { target: { value: 'Sita Rai' } });
    fireEvent.change(document.getElementById('enr-phone'), { target: { value: '98000' } });
    await waitFor(() => expect(screen.getAllByText(/isn't valid for Nepal/).length).toBeGreaterThanOrEqual(2));
  });
  it('a valid number shows no phone problem', () => {
    render(<EnrollMemberPanel onClose={() => {}} onEnrolled={() => {}} />);
    fireEvent.change(document.getElementById('enr-name'), { target: { value: 'Sita Rai' } });
    fireEvent.change(document.getElementById('enr-phone'), { target: { value: '9841234567' } });
    expect(screen.queryByText(/isn't valid for Nepal/)).toBeNull();
  });
});
