// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
vi.mock('../../services/api', async (o) => ({ ...(await o()), fetchServiceEligibility: vi.fn(async () => ({ data: {}, error: null })) }));
import StaffPicker from './StaffPicker';

afterEach(cleanup);
const people = [{ id: 'a', name: 'Asha K', gender: 'female' }, { id: 'b', name: 'Bina R', gender: 'female' }, { id: 'c', name: 'Cara T' }, { id: 'd', name: 'Dina S' }];
const slot = { date: '2026-11-22', start: '14:00', end: '14:30' };
const bookings = [{ id: 'x', date: '2026-11-22', start_time: '13:30:00', end_time: '14:15:00', status: 'Confirmed', therapist_id: 'b' }];

describe('StaffPicker (ZNLY-303 look)', () => {
  const base = { people, selectedIds: [], onChange: vi.fn(), slot, bookings, offById: { d: 'Off today' } };
  it('single pick = radios; groups Free / Busy at / Off today; busy time in the subline, pill just says Busy', () => {
    render(<StaffPicker {...base} max={1} header={{ title: 'Staff for Person 2 · Mira', sub: 'Lash Tint · 2:00–2:30pm' }} />);
    expect(screen.getAllByRole('radio').length).toBe(4); // the Off person is rendered but disabled
    expect(screen.getByText('Staff for Person 2 · Mira')).toBeTruthy();
    expect(screen.getByText('Free 2:00–2:30pm')).toBeTruthy();
    expect(screen.getByText('Busy at 2:00pm')).toBeTruthy();
    expect(screen.getByText('Off today', { selector: 'p' })).toBeTruthy();
    expect(screen.getByText('Busy 1:30–2:15 · free after 2:15')).toBeTruthy();
    expect(screen.getByText('Busy', { selector: 'span.rounded-full' })).toBeTruthy();
    expect(screen.getByText('Female', { exact: false })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Dina S/ }).disabled).toBe(true);
  });
  it('several can be picked = checkboxes, with the "N selected · M staff" line; single has no counter line', () => {
    const { unmount } = render(<StaffPicker {...base} max={Infinity} />);
    expect(screen.getAllByRole('checkbox').length).toBe(4);
    expect(screen.getByText('0 selected')).toBeTruthy();
    unmount();
    render(<StaffPicker {...base} max={1} />);
    expect(screen.queryByText('0 selected')).toBeNull();
  });
  it('a person held by another guest is dimmed/disabled with the With pill and line, and is never Best fit', () => {
    render(<StaffPicker {...base} max={1} lockedById={{ a: { pill: 'With contact', line: 'With the booking contact (Asha) at this time' } }} />);
    expect(screen.getByText('With contact')).toBeTruthy();
    expect(screen.getByText('With the booking contact (Asha) at this time')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Asha K/ }).disabled).toBe(true);
    expect(screen.getAllByText('Best fit').length).toBe(1);
  });
  it('"No staff · assign later" is the last row and calls onNone', () => {
    const onNone = vi.fn();
    render(<StaffPicker {...base} max={1} onNone={onNone} />);
    fireEvent.click(screen.getByText('No staff · assign later'));
    expect(onNone).toHaveBeenCalled();
  });
});
