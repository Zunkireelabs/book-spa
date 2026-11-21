import { describe, it, expect } from 'vitest';
import { describeClientAdded, describeDetailsChanged } from './bookingHistoryText';

describe('booking history text', () => {
  it('client added', () => expect(describeClientAdded({ customer_name: 'Puja Qc' })).toBe('Client added: Puja Qc'));
  it('time and service in plain language, 12-hour', () => {
    expect(describeDetailsChanged({ start_time: '13:45', service_name: 'Lash Tint' }, { start_time: '14:00', service_name: 'Brow Threading', customer_phone: 'updated' }))
      .toBe('Details changed: service Lash Tint → Brow Threading · time 1:45pm → 2:00pm · phone updated');
  });
  it('never prints a phone number', () => expect(describeDetailsChanged({}, { customer_phone: '+9779800000000' })).not.toContain('9800'));
  it('midnight/noon and cleared notes', () => {
    expect(describeDetailsChanged({ start_time: '00:05' }, { start_time: '12:00' })).toBe('Details changed: time 12:05am → 12:00pm');
    expect(describeDetailsChanged({ special_requests: 'a' }, { special_requests: null })).toBe('Details changed: notes “a” → none');
  });
});
