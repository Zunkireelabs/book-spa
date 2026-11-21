// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const updateContact = vi.fn(async () => ({ data: {}, error: null }));
vi.mock('../../../services/api', async (orig) => ({
  ...(await orig()),
  updateCustomerContact: (...a) => updateContact(...a),
  updateCustomerProfileDetails: vi.fn(async () => ({ data: {}, error: null })),
}));
vi.mock('./CustomerPhotosTab', () => ({ default: () => null }));
import CustomerEditModal from './CustomerEditModal';

beforeEach(() => { window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }); updateContact.mockClear(); });
afterEach(cleanup);

const customer = { id: 'c1', fullName: 'Sita Rai', phone: '12345', email: '' };
const mount = () => render(<CustomerEditModal customer={customer} onClose={() => {}} onSaved={() => {}} />);

describe('CustomerEditModal phone (PhoneField)', () => {
  it('an untouched odd stored number saves without touching the phone', async () => {
    mount();
    fireEvent.click(screen.getByText(/^Save/));
    await waitFor(() => expect(updateContact).toHaveBeenCalled());
    expect(updateContact.mock.calls[0][1].phone).toBeNull();
  });
  it('a changed invalid number shows the reason and blocks the save', async () => {
    mount();
    fireEvent.change(document.getElementById('edit-customer-phone'), { target: { value: '98000' } });
    expect(screen.getAllByText(/isn't valid for Nepal/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText(/^Save/));
    await new Promise((r) => setTimeout(r, 20));
    expect(updateContact).not.toHaveBeenCalled();
  });

  it('shows each stored field (gender/pronouns in any case) and never sends them when untouched', async () => {
    const detailsMock = (await import('../../../services/api')).updateCustomerProfileDetails;
    render(<CustomerEditModal customer={{ ...customer, gender: 'female', pronouns: 'she/her' }} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(screen.getByText('More Info'));
    fireEvent.click(screen.getByText(/^Save/));
    await waitFor(() => expect(detailsMock).toHaveBeenCalled());
    const sent = detailsMock.mock.calls.at(-1)[1];
    expect(sent.gender).toBeUndefined();
    expect(sent.pronouns).toBeUndefined();
  });
  it('an invalid phone shows its reason once (under the field), not also in a banner', async () => {
    mount();
    fireEvent.change(document.getElementById('edit-customer-phone'), { target: { value: '98000' } });
    fireEvent.click(screen.getByText(/^Save/));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getAllByText(/isn't valid for Nepal/)).toHaveLength(1);
  });
});
