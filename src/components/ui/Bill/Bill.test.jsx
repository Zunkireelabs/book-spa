import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Bill } from './Bill';
import { buildBill } from '../../../utils/buildBill';

const rows = [
  { id: 1, bookingNumber: 'BK-1', date: '2026-11-19', startTime: '15:00', endTime: '16:00', status: 'Completed', service: 'Manicure', staff: 'Kebisha S.', base: 2300, discount: 230, final: 2070, payments: [{ amount: 1000, mode: 'cash', at: 'a' }], refunds: [], tip: 100 },
  { id: 2, bookingNumber: 'BK-2', date: '2026-11-19', startTime: '16:00', endTime: '16:15', status: 'Cancelled', service: 'Upper Lip', staff: 'Sami S.', base: 300, discount: 0, final: 300, payments: [], refunds: [], tip: 0 },
];
const bill = buildBill({ rows, org: { name: "Sami's", footer: 'Thanks!' }, branch: { name: 'Lazimpat' }, customer: { name: 'Aliza' } });

describe('Bill drawing', () => {
  it.each(['a4', 'thermal'])('%s: shows total, still-to-pay, cancelled line, tip note and the footer', (layout) => {
    const html = renderToStaticMarkup(<Bill bill={bill} layout={layout} />);
    expect(html).toContain('NPR 2,070');
    expect(html).toContain('NPR 1,070 still to pay');
    expect(html).toContain('Cancelled · not charged');
    expect(html).toContain('Tip NPR 100 was given to staff and is not part of this bill');
    expect(html).toContain('Thanks!');
    expect(html).not.toContain('Taxable'); // VAT lines are for tax invoices only
    expect(html.includes('zbill--thermal')).toBe(layout === 'thermal');
  });
  it('no logo uploaded: the business initials show instead', () => {
    expect(renderToStaticMarkup(<Bill bill={bill} />)).toContain('>S</span>');
  });
});
