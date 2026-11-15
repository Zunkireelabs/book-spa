import { describe, it, expect } from 'vitest';
import { maskCustomerName, maskPhone } from './api';

describe('maskCustomerName', () => {
  it('keeps initials and shape', () => {
    expect(maskCustomerName('Anisha Thakuri')).toBe('A***** T******');
    expect(maskCustomerName('Sneha Prasai')).toBe('S**** P*****');
  });
  it('handles a single name and three names', () => {
    expect(maskCustomerName('Kokwah')).toBe('K*****');
    expect(maskCustomerName('Ashmi Thing Tamang')).toBe('A**** T**** T*****');
  });
  it('passes through empty values untouched', () => {
    expect(maskCustomerName('')).toBe('');
    expect(maskCustomerName(null)).toBe(null);
  });
});

describe('maskPhone', () => {
  it('reveals only the last three digits', () => {
    expect(maskPhone('+9779818088655')).toBe('+**********655');
    expect(maskPhone('9818088655')).toBe('*******655');
  });
  it('preserves non-digit formatting', () => {
    expect(maskPhone('+977 98-1808-8655')).toBe('+*** **-****-*655');
  });
  it('leaves a too-short number alone rather than exposing all of it', () => {
    expect(maskPhone('12')).toBe('12');
  });
  it('passes through empty values untouched', () => {
    expect(maskPhone(null)).toBe(null);
  });
});
