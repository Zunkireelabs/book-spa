// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const update = vi.fn(async () => ({ data: {}, error: null }));
vi.mock('../../services/api', () => ({ updateCustomerContact: (...a) => update(...a) }));
import CustomerContactQuickEdit from './CustomerContactQuickEdit';

beforeEach(() => { window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }); update.mockClear(); });
afterEach(cleanup);

const open = (phone) => {
  render(<CustomerContactQuickEdit customerId="c1" email="a@b.co" phone={phone} />);
  fireEvent.click(screen.getByRole('button'));
};

describe('CustomerContactQuickEdit phone (PhoneField)', () => {
  it('an untouched odd stored number saves nothing for the phone (round-trips untouched)', async () => {
    open('12345');
    fireEvent.change(screen.getByPlaceholderText('customer@example.com'), { target: { value: 'new@b.co' } });
    fireEvent.click(screen.getByText(/^Save/));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).toEqual({ email: 'new@b.co', phone: null });
  });
  it('a changed invalid number is blocked with the reason', async () => {
    open('');
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '12345' } });
    fireEvent.click(screen.getByText(/^Save/));
    expect(await screen.findByText(/isn't valid for Nepal/)).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });
});
