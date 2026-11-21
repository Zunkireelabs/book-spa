// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const requestOtp = vi.fn(async () => ({}));
vi.mock('contexts/CustomerAuthContext', () => ({ useCustomerAuth: () => ({ requestOtp, customer: null, customerProfile: null }) }));
vi.mock('contexts/TenantContext', () => ({ useTenant: () => ({ orgId: 'o1' }) }));
vi.mock('pages/customer-login/components/OtpCodeStep', () => ({ default: () => null }));
import CustomerSignupForm from './CustomerSignupForm';

beforeEach(() => { window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }); requestOtp.mockClear(); });
afterEach(cleanup);

const fill = (phone) => {
  fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Sita Rai' } });
  fireEvent.change(screen.getByPlaceholderText('Email address'), { target: { value: 'sita@example.com' } });
  fireEvent.change(screen.getByPlaceholderText('9841234567'), { target: { value: phone } });
  fireEvent.click(screen.getByText('Create Account'));
};

describe('CustomerSignupForm phone (PhoneField)', () => {
  it('blocks an invalid number with the shared message and does not request a code', () => {
    render(<MemoryRouter><CustomerSignupForm /></MemoryRouter>);
    fill('12345');
    expect(screen.getByText(/isn't valid for Nepal/)).toBeTruthy();
    expect(requestOtp).not.toHaveBeenCalled();
  });
  it('a valid number goes through as dial + digits', () => {
    render(<MemoryRouter><CustomerSignupForm /></MemoryRouter>);
    fill('9841234567');
    expect(requestOtp).toHaveBeenCalled();
    expect(requestOtp.mock.calls[0][1].phone).toBe('+9779841234567');
  });
});
