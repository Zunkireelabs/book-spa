import { describe, it, expect } from 'vitest';
import { computeInvoiceTax, toExVatRevenue } from './invoiceMath';

describe('computeInvoiceTax', () => {
  it('inclusive mode extracts VAT from the total — never adds on top', () => {
    // Based on the approved mockup (3,330 paid, VAT backed out of it) — the
    // mockup's own figures (383 / 2,947) are rounded to whole rupees for
    // display; the precise two-decimal values are asserted here instead.
    // 3330 * 13 / 113 = 383.0973... -> 383.10, taxable = 3330 - 383.10 = 2946.90.
    const { taxable, vat, total } = computeInvoiceTax({ amount: 3330, taxMode: 'inclusive', vatRate: 13 });
    expect(vat).toBe(383.1);
    expect(taxable).toBe(2946.9);
    expect(total).toBe(3330);
    expect(Math.round((taxable + vat) * 100) / 100).toBe(total);
  });

  it('inclusive mode: components always sum to the total, not off by a paisa', () => {
    for (const amount of [100, 999, 1234.5, 5000, 7777.77]) {
      const { taxable, vat, total } = computeInvoiceTax({ amount, taxMode: 'inclusive', vatRate: 13 });
      expect(Math.round((taxable + vat) * 100) / 100).toBe(total);
      expect(total).toBe(amount);
    }
  });

  it('addon mode adds VAT on top — total exceeds the original amount', () => {
    const { taxable, vat, total } = computeInvoiceTax({ amount: 1000, taxMode: 'addon', vatRate: 13 });
    expect(taxable).toBe(1000);
    expect(vat).toBe(130);
    expect(total).toBe(1130);
  });

  it('addon mode: components always sum to the total', () => {
    for (const amount of [100, 999, 1234.5, 5000]) {
      const { taxable, vat, total } = computeInvoiceTax({ amount, taxMode: 'addon', vatRate: 13 });
      expect(Math.round((taxable + vat) * 100) / 100).toBe(total);
      expect(total).toBeGreaterThan(amount);
    }
  });

  it('none mode has no VAT at all', () => {
    const { taxable, vat, total } = computeInvoiceTax({ amount: 2500, taxMode: 'none' });
    expect(vat).toBe(0);
    expect(taxable).toBe(2500);
    expect(total).toBe(2500);
  });

  it('respects a non-default VAT rate', () => {
    const { vat, taxable, total } = computeInvoiceTax({ amount: 1130, taxMode: 'inclusive', vatRate: 13 });
    expect(vat).toBe(130);
    expect(taxable).toBe(1000);
    expect(total).toBe(1130);
  });

  it('rejects an unknown tax mode rather than silently picking one', () => {
    expect(() => computeInvoiceTax({ amount: 100, taxMode: 'bogus' })).toThrow();
    expect(() => computeInvoiceTax({ amount: 100, taxMode: undefined })).toThrow();
  });

  it('rejects a non-numeric amount instead of returning NaN', () => {
    expect(() => computeInvoiceTax({ amount: undefined, taxMode: 'inclusive' })).toThrow();
    expect(() => computeInvoiceTax({ amount: 'NaN', taxMode: 'inclusive' })).toThrow();
    expect(() => computeInvoiceTax({ amount: NaN, taxMode: 'inclusive' })).toThrow();
  });

  it('matches exact decimal half-up rounding at rates where float math would drift', () => {
    // 200.13 * 20 / 120 = 33.355 exactly on the boundary — SQL round(numeric,2)
    // (half-away-from-zero) gives 33.36; float Math.round(x*100)/100 on the
    // binary approximation of 33.355 gives 33.35. Pins JS/SQL parity.
    const { vat, taxable, total } = computeInvoiceTax({ amount: 200.13, taxMode: 'inclusive', vatRate: 20 });
    expect(vat).toBe(33.36);
    expect(taxable).toBe(166.77);
    expect(total).toBe(200.13);
    expect(Math.round((taxable + vat) * 100) / 100).toBe(total);
  });
});
