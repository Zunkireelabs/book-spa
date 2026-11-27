// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BookingServicesBlock from './BookingServicesBlock';
import { buildBookingBlock } from '../../utils/bookingBlock';
import { lockReason } from '../../pages/branch-manager-dashboard/components/calendar/editBookingSlot';

const raw = (id, status, pay = 'unpaid') => ({ id, booking_number: `BK-${id}`, status, payment_status: pay, start_time: '11:30:00', end_time: '12:00:00', service: { name: `Svc ${id}`, duration_minutes: 30 }, base_amount: 100, final_amount: 100, payments: pay === 'paid' ? [{ amount: 100 }] : [] });

describe('lock chip instead of Remove (ZNLY-402 piece 5)', () => {
  it('started / paid rows show a lock chip and no Remove; waiting rows keep Remove', () => {
    const block = buildBookingBlock([raw('a', 'In-Progress'), raw('b', 'Confirmed', 'paid'), raw('c', 'Pending')], 'a');
    const rowAction = (r) => { const lock = lockReason(r); return { ...(lock ? { lock: lock.replace(' – can\'t change', '') } : { remove: { run: () => {} } }) }; };
    render(<BookingServicesBlock block={block} mode="full" rowAction={rowAction} />);
    expect(screen.getAllByText('Started').length).toBeGreaterThan(0);
    expect(screen.getByText('Paid', { selector: 'span[data-row-locked]' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
  });
});
