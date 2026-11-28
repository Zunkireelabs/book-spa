import { describe, it, expect } from 'vitest';
import { buildBillEmailHtml } from './billEmail';

const base = { business: 'Nuad <Thai> & Spa', message: 'Hi A, your bill BK-1 is ready.', url: 'https://x.io/o/bill/tok', phone: '9800000000', address: 'Lazimpat' };

describe('buildBillEmailHtml', () => {
  it('escapes the business name and has the green button + link', () => {
    const h = buildBillEmailHtml(base);
    expect(h).toContain('Nuad &lt;Thai&gt; &amp; Spa');
    expect(h).not.toContain('<Thai>');
    expect(h).toContain('href="https://x.io/o/bill/tok"');
    expect(h).toContain('#2D5A27');
  });
  it('shows phone and address in the footer, and drops the footer when both are empty', () => {
    expect(buildBillEmailHtml(base)).toContain('9800000000<br>Lazimpat');
    expect(buildBillEmailHtml({ ...base, phone: '', address: null })).not.toContain('border-top');
  });
  it('has no amount', () => {
    expect(buildBillEmailHtml(base)).not.toMatch(/NPR|Rs\.?\s?\d|\d,\d{3}/);
  });
});
