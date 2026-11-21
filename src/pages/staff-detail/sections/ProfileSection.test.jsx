// @vitest-environment jsdom
import React, { useState } from 'react';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ProfileSection from './ProfileSection';

beforeEach(() => { window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }); });
afterEach(cleanup);

const base = { name: 'Anjali', gender: 'Female', positions: [], specialties: '', isServiceStaff: true, photoUrl: '', bio: '', experienceYears: '', rating: '', phone: '12345', countryCode: '+977', originalPhone: '12345', address: '', city: '', email: '', pronouns: '' };
const Harness = () => {
  const [form, setForm] = useState(base);
  return <ProfileSection editing form={form} setForm={setForm} changed={[]} readOnly={false} isAdmin enableStaffRatings={false} allPositionNames={[]} staffLabel="Therapist" />;
};

describe('staff profile phone (PhoneField)', () => {
  it('renders a PhoneField; an untouched odd stored number shows no problem, a changed invalid one does', () => {
    render(<Harness />);
    const input = document.getElementById('staff-phone');
    expect(input).toBeTruthy();
    expect(screen.queryByText(/isn't valid for Nepal/)).toBeNull();
    fireEvent.change(input, { target: { value: '98000' } });
    expect(screen.getByText(/isn't valid for Nepal/)).toBeTruthy();
  });
});
