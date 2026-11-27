// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../../services/api', () => ({
  fetchVoucherTypes: vi.fn(async () => ({ data: [{ id: 't1', name: 'Massage 90', category: 'massage', standard_price: 2000, default_issue_kind: 'sold' }] })),
  issueVoucher: vi.fn(async () => ({ data: {}, error: null })),
  fetchMembershipForCustomer: vi.fn(async () => ({ data: null })),
  fetchCustomersLightweight: vi.fn(async () => ({ data: [] })),
  fetchRecentCustomerIds: vi.fn(async () => ({ data: [] })),
}));
vi.mock('../../../../contexts/BranchContext', () => ({ useBranch: () => ({ branchId: 'b1', branchName: 'Main', isOverall: false }) }));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u1' } }), useOptionalAuth: () => ({ profile: { id: 'u1' } }) }));
vi.mock('../../../../contexts/OrgContext', () => ({ useOrg: () => ({ paymentMethods: [] }) }));
import NewVoucherPanel from './NewVoucherPanel';

beforeEach(() => { window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }); });
afterEach(cleanup);

const fillBasics = async () => {
  await screen.findByText('Voucher type');
  fireEvent.change(document.getElementById('vch-code'), { target: { value: 'B-001' } });
  fireEvent.change(document.getElementById('vch-guest'), { target: { value: 'Sita Rai' } });
};

describe('NewVoucherPanel phone (PhoneField)', () => {
  it('renders a PhoneField; an invalid typed number shows the reason under it and is the footer reason', async () => {
    render(<NewVoucherPanel userRole="manager" onClose={() => {}} onIssued={() => {}} />);
    await fillBasics();
    fireEvent.change(document.getElementById('vch-phone'), { target: { value: '98000' } });
    fireEvent.blur(document.getElementById('vch-phone'));
    await waitFor(() => expect(screen.getAllByText(/isn't valid for Nepal/).length).toBeGreaterThanOrEqual(2)); // under the field + footer
  });
  it('a valid number is not blocked on the phone', async () => {
    render(<NewVoucherPanel userRole="manager" onClose={() => {}} onIssued={() => {}} />);
    await fillBasics();
    fireEvent.change(document.getElementById('vch-phone'), { target: { value: '9841234567' } });
    expect(screen.queryByText(/isn't valid for Nepal/)).toBeNull();
  });
});
