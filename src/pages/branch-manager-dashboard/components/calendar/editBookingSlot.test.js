import { describe, it, expect } from 'vitest';
import { lockReason, buildEditSlot, buildEditChanges } from './editBookingSlot';

const blockRow = (o) => ({ id: 'r', serviceId: 's', staffIds: ['t'], roomId: null, start: '11:30', minutes: 60, name: 'X', status: 'confirmed', paymentStatus: 'unpaid', paid: 0, final: 100, dead: false, ...o });
const booking = { bookingId: 'b1', visitId: 'v1', date: '2026-12-08', customerName: 'Watshala', customerId: 'c1', customerPhone: '+9779749871640', specialRequests: 'hi', startTime: '11:30', endTime: '12:30', status: 'confirmed', paymentStatus: 'unpaid', serviceId: 's', therapists: [{ id: 't' }] };

describe('editBookingSlot', () => {
  it('lock reasons', () => {
    expect(lockReason({ status: 'in-progress' })).toMatch(/Started/);
    expect(lockReason({ status: 'completed' })).toMatch(/Done/);
    expect(lockReason({ status: 'confirmed', paymentStatus: 'paid' })).toMatch(/Paid/);
    expect(lockReason({ status: 'pending', paymentStatus: 'unpaid' })).toBe('');
  });
  it('whole booking: live rows in time order, dead rows left out, locked first', () => {
    const slot = buildEditSlot({ booking, blockRows: [blockRow({ id: 'r2', start: '12:30' }), blockRow({ id: 'r1', status: 'in-progress' }), blockRow({ id: 'r3', dead: true, status: 'cancelled' })] });
    expect(slot.edit.rows.map((r) => r.bookingId)).toEqual(['r1', 'r2']);
    expect(slot.edit.rows[0].locked).toMatch(/Started/);
    expect(slot.edit.rows[1].locked).toBe('');
    expect(slot.edit.visitKey).toBe('v1');
    expect(slot.hour).toBe(11); expect(slot.minute).toBe(30);
    expect(slot.title).toBe('Edit booking · Watshala');
  });
  it('OFF org / no visit: one card from the booking itself, key = booking id', () => {
    const slot = buildEditSlot({ booking: { ...booking, visitId: null } });
    expect(slot.edit.rows).toHaveLength(1);
    expect(slot.edit.visitKey).toBe('b1');
    expect(slot.edit.rows[0].minutes).toBe(60);
  });
  it('changes: new service has null booking_id, removed rows listed', () => {
    const c = buildEditChanges({ date: '2026-12-08', specialRequests: '', rows: [{ bookingId: 'r1', serviceId: 's', therapistId: 't', roomId: '', start: '11:30' }, { bookingId: null, serviceId: 's2', therapistId: '', roomId: '', start: '12:30' }], removed: ['r9'] });
    expect(c.special_requests).toBeNull();
    expect(c.services[1]).toMatchObject({ booking_id: null, therapist_ids: [], remove: false });
    expect(c.services[2]).toMatchObject({ booking_id: 'r9', remove: true });
  });
});
