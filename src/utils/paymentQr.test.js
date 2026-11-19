import { describe, it, expect } from 'vitest';
import { leafMethods, isQrCapableMethod, qrMethodDiff, pendingQrRows, validateQrFile, qrSignature, isQrConfirmed } from './paymentQr';

const METHODS = [
  'Cash',
  { name: 'Card', subMethods: ['Mastercard', 'Visa'] },
  { name: 'Digital Wallet', subMethods: ['Khalti', 'eSewa'] },
  { name: 'Bank QR', subMethods: [] },
  'MobileBanking',
];

describe('leafMethods', () => {
  it('returns plain methods, sub-methods, and sub-less groups, in order', () => {
    expect(leafMethods(METHODS)).toEqual(['Cash', 'Mastercard', 'Visa', 'Khalti', 'eSewa', 'Bank QR', 'MobileBanking']);
  });
  it('tolerates empty or malformed input', () => {
    expect(leafMethods(undefined)).toEqual([]);
    expect(leafMethods(['', null, { subMethods: ['x'] }, 'Cheque'])).toEqual(['Cheque']);
  });
});

describe('isQrCapableMethod', () => {
  it('excludes Cash only', () => {
    expect(isQrCapableMethod('Cash')).toBe(false);
    expect(isQrCapableMethod('cash')).toBe(false);
    expect(isQrCapableMethod('eSewa')).toBe(true);
    expect(isQrCapableMethod('')).toBe(false);
  });
});

describe('qrMethodDiff', () => {
  const old = leafMethods(METHODS);
  it('is empty when nothing changed', () => {
    expect(qrMethodDiff(old, old)).toEqual({ renamed: [], removed: [] });
  });
  it('detects an in-place rename of a sub-method', () => {
    const next = old.map((l) => (l === 'eSewa' ? 'eSewa Wallet' : l));
    expect(qrMethodDiff(old, next, { eSewa: 'eSewa Wallet' })).toEqual({ renamed: [['eSewa', 'eSewa Wallet']], removed: [] });
  });
  it('removes every leaf of a deleted group', () => {
    const next = leafMethods(METHODS.filter((m) => m.name !== 'Digital Wallet'));
    expect(qrMethodDiff(old, next)).toEqual({ renamed: [], removed: ['Khalti', 'eSewa'] });
  });
  it('removes a plain method that gains sub-options (its own name is no longer selectable)', () => {
    const next = leafMethods(METHODS.map((m) => (m === 'MobileBanking' ? { name: 'MobileBanking', subMethods: ['NIC Asia'] } : m)));
    expect(qrMethodDiff(old, next)).toEqual({ renamed: [], removed: ['MobileBanking'] });
  });
  it('treats a rename whose target is missing as a removal, and ignores renames of leaves that still exist', () => {
    expect(qrMethodDiff(['A', 'B'], ['B'], { A: 'Z' })).toEqual({ renamed: [], removed: ['A'] });
    expect(qrMethodDiff(['A', 'B'], ['A', 'B', 'C'], { A: 'C' })).toEqual({ renamed: [], removed: [] });
  });
});

describe('pendingQrRows', () => {
  const qr = { eSewa: { path: 'o/org/1.png', url: 'u' }, Khalti: { path: 'o/org/2.png', url: 'u' } };
  it('lists QR rows with an amount that are not confirmed', () => {
    const tenders = [
      { paymentMode: 'Cash', amount: '1500' },
      { paymentMode: 'eSewa', amount: '1000' },
      { paymentMode: 'Khalti', amount: '500', qrConfirmed: 'Khalti|500' },
      { paymentMode: 'Khalti', amount: '' },
    ];
    expect(pendingQrRows(tenders, qr)).toEqual([1]);
  });
  it('un-confirms a row whose amount or method changed after confirming', () => {
    const row = { paymentMode: 'eSewa', amount: '1000' };
    const confirmed = { ...row, qrConfirmed: qrSignature(row) };
    expect(isQrConfirmed(confirmed)).toBe(true);
    expect(isQrConfirmed({ ...confirmed, amount: '1200' })).toBe(false);
    expect(isQrConfirmed({ ...confirmed, paymentMode: 'Khalti' })).toBe(false);
    expect(pendingQrRows([{ ...confirmed, amount: '900' }], qr)).toEqual([0]);
    expect(pendingQrRows([confirmed], qr)).toEqual([]);
  });
  it('is empty without a QR map (QR fetch failed or none uploaded)', () => {
    expect(pendingQrRows([{ paymentMode: 'eSewa', amount: '1000' }], {})).toEqual([]);
    expect(pendingQrRows([{ paymentMode: 'eSewa', amount: '1000' }], null)).toEqual([]);
  });
});

describe('validateQrFile', () => {
  it('accepts png/jpeg/webp up to 1 MB', () => {
    expect(validateQrFile({ type: 'image/png', size: 1024 * 1024 })).toBeNull();
    expect(validateQrFile({ type: 'image/webp', size: 10 })).toBeNull();
  });
  it('rejects other types and oversized files with a friendly message', () => {
    expect(validateQrFile({ type: 'image/svg+xml', size: 10 })).toMatch(/PNG, JPG or WebP/);
    expect(validateQrFile({ type: 'image/gif', size: 10 })).toMatch(/PNG, JPG or WebP/);
    expect(validateQrFile({ type: 'image/png', size: 1024 * 1024 + 1 })).toMatch(/over 1 MB/);
    expect(validateQrFile(null)).toMatch(/Choose/);
  });
});
