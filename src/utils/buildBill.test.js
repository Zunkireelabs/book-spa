import { describe, it, expect } from 'vitest';
import { billSource } from './buildBill';
import { buildBill, billExists, groupBillUnits, timeRange } from './buildBill';

const row = (o) => ({ id: o.n, bookingNumber: `BK-20261119-000${o.n}`, date: '2026-11-19', status: 'Completed', staff: 'Kebisha S.', payments: [], refunds: [], tip: 0, discount: 0, ...o });

import { modeLabel } from './buildBill';
describe('modeLabel', () => { it('plain words', () => { expect(modeLabel('QR PAYMENT')).toBe('QR payment'); expect(modeLabel('MobileBanking')).toBe('Mobile banking'); expect(modeLabel('eSewa')).toBe('eSewa'); expect(modeLabel('cash')).toBe('Cash'); }); });
describe('buildBill', () => {
  const rows = [
    row({ n: 1, service: 'Manicure', startTime: '15:00', endTime: '16:00', base: 2300, discount: 230, final: 2070, payments: [{ amount: 4000, mode: 'qr', at: '2026-11-19T13:00' }] }),
    row({ n: 2, service: 'Pedicure', startTime: '16:00', endTime: '17:30', base: 2600, discount: 260, final: 2340, payments: [{ amount: 2000, mode: 'cash', at: '2026-11-19T13:05' }], tip: 200 }),
    row({ n: 3, service: 'Upper Lip', status: 'Cancelled', startTime: '17:30', endTime: '17:45', base: 300, final: 300 }),
  ];
  it('visit with a cancelled line, partial payment, tip outside the total, same % on every line', () => {
    const b = buildBill({ rows, billNumber: 'BK-20261119-0001', products: [] });
    expect(b.lines.map((l) => l.price)).toEqual([2300, 2600, 0]);
    expect(b.lines[2].cancelled).toBe(true);
    expect(b.subtotal).toBe(4900);
    expect(b.discount).toEqual({ amount: 490, pct: 10 });
    expect(b.total).toBe(4410);
    expect(b.paidTotal).toBe(6000);
    expect(b.stillToPay).toBe(0);
    expect(b.tip).toBe(200);
    expect(b.total).toBe(b.subtotal - b.discount.amount); // tip is NOT in the total
    expect(b.title).toBe('Receipt');
  });
  it('partial payment shows still to pay', () => {
    const b = buildBill({ rows: [rows[0]], billNumber: 'X' });
    expect(b.total).toBe(2070); expect(b.status).toEqual({ kind: 'paid', amount: 0 });
    const part = buildBill({ rows: [{ ...rows[0], payments: [{ amount: 1000, mode: 'cash', at: 'a' }] }] });
    expect(part.stillToPay).toBe(1070); expect(part.status).toEqual({ kind: 'due', amount: 1070 });
  });
  it('mixed discounts show the amount only, no %', () => {
    const b = buildBill({ rows: [rows[0], { ...rows[1], discount: 0, final: 2600 }] });
    expect(b.discount).toEqual({ amount: 230, pct: null });
    expect(b.total).toBe(4670);
  });
  it('refund chip; still-to-pay wins when both apply', () => {
    const cancelled = { ...rows[0], status: 'Cancelled', payments: [{ amount: 2070, mode: 'cash', at: 'a' }], refunds: [{ amount: 2070, at: 'b' }] };
    const b = buildBill({ rows: [cancelled] });
    expect(b.status).toEqual({ kind: 'refunded', amount: 2070 }); expect(b.stillToPay).toBe(0);
    const both = buildBill({ rows: [{ ...rows[0], payments: [{ amount: 2070, mode: 'cash', at: 'a' }], refunds: [{ amount: 500, at: 'b' }] }] });
    expect(both.status).toEqual({ kind: 'due', amount: 500 });
  });
  it('a checkout bundle of 2 bookings: one bill, total = sum paid, number = first booking number', () => {
    const a = { ...rows[0], id: 1, bookingNumber: 'BK-20261119-0007', discount: 0, base: 1000, final: 1000, payments: [{ amount: 1000, mode: 'cash', at: 'a' }] };
    const c = { ...rows[0], id: 2, bookingNumber: 'BK-20261119-0003', startTime: '16:00', discount: 0, base: 2500, final: 2500, payments: [{ amount: 2500, mode: 'qr', at: 'b' }] };
    const b = buildBill({ rows: [a, c] });
    expect(b.total).toBe(3500); expect(b.paidTotal).toBe(3500); expect(b.stillToPay).toBe(0);
    expect(b.bookingNumber).toBe('BK-20261119-0003');
    expect(b.lines.length).toBe(2);
  });
  it('products are lines with qty and count in the total', () => {
    const b = buildBill({ rows: [rows[0]], products: [{ name: 'Cuticle oil', qty: 1, amount: 500, payments: [{ amount: 500, mode: 'cash', at: 'c' }] }] });
    expect(b.lines[1]).toMatchObject({ service: 'Cuticle oil', qty: 1, price: 500 });
    expect(b.total).toBe(2570); expect(b.paidTotal).toBe(4500);
  });
  it('tax invoice takes its frozen figures and shows VAT', () => {
    const b = buildBill({ rows: [rows[0]], billNumber: 'BK-1', invoice: { number: 'SQC-00012', taxMode: 'inclusive', vatRate: 13, vatAmount: 238.1, taxableAmount: 1831.9, subtotal: 2300, discountAmount: 230, totalAmount: 2070, issuedAt: '2026-11-19', copyLabel: 'ORIGINAL' } });
    expect(b.title).toBe('Tax invoice'); expect(b.number).toBe('SQC-00012'); expect(b.bookingNumber).toBe('BK-1');
    expect(b.tax).toEqual({ taxable: 1831.9, vat: 238.1, rate: 13, mode: 'inclusive' });
    expect(b.total).toBe(2070);
  });
  it('billExists / grouping / time', () => {
    expect(billExists([row({ n: 1, status: 'Cancelled' })])).toBe(false);
    expect(billExists([row({ n: 1, status: 'Confirmed', payments: [{ amount: 1 }] })])).toBe(true);
    const g = groupBillUnits([{ id: 'a', visitId: 'v' }, { id: 'b', visitId: 'v' }, { id: 'c', visitId: null }], true);
    expect(g.length).toBe(2);
    expect(groupBillUnits([{ id: 'a', visitId: 'v' }, { id: 'b', visitId: 'v' }], false).length).toBe(2);
    expect(timeRange('15:00', '16:30')).toBe('3:00 – 4:30pm');
    expect(timeRange('11:30', '12:30')).toBe('11:30am – 12:30pm');
  });
});

describe('public bill source', () => {
  it('uses the already-masked customer and never the raw phone', () => {
    const src = billSource({ customer: { name: 'Aliza', phone: '+977 98•• ••4128' }, rows: [row({ n: 1, service: 'X', base: 100, final: 100, customerPhone: '+9779820084128' })], products: [], branch: {}, invoice: null }, { name: 'Biz' });
    expect(src.customer).toEqual({ name: 'Aliza', phone: '+977 98•• ••4128' });
  });
});
