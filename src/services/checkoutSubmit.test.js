import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('./api', () => ({ checkoutWithProducts: vi.fn(), recordTip: vi.fn() }));
import { submitCheckout } from './checkoutSubmit';

const payload = (over = {}) => ({
  tenders: [{ amount: 1000, paymentMode: 'Cash' }],
  productTenders: [{ amount: 800, paymentMode: 'Cash' }],
  additionalAllocations: [{ bookingId: 'b2', tenders: [{ amount: 50, paymentMode: 'Cash' }] }],
  products: [{ variantId: 'v1', qty: 1, soldByTherapistId: 't1' }],
  dueHolderName: '', notes: 'n', tipSplits: [{ amount: 100, receivedBy: 'u1' }],
  ...over,
});
const sale = { id: 's1', variantId: 'v1', productName: 'Oil', variantName: '100ml', quantity: 1, total: 800, stockBefore: 5, stockAfter: 4 };

describe('submitCheckout (ZNLY-233): products on the bill are saved, never dropped', () => {
  it('products => ONE checkout call (product tenders first), the treatment-only path is NOT used', async () => {
    const checkoutWithProducts = vi.fn().mockResolvedValue({ data: { sales: [sale], productsTotal: 800, productPayments: [{ paymentMode: 'Cash', amount: 800 }] }, error: null });
    const recordTip = vi.fn().mockResolvedValue({ error: null });
    const treatment = vi.fn();
    const onSaved = vi.fn();
    const r = await submitCheckout({ bookingId: 'b1', payload: payload(), treatment, onSaved, deps: { checkoutWithProducts, recordTip } });
    expect(treatment).not.toHaveBeenCalled();
    expect(checkoutWithProducts).toHaveBeenCalledTimes(1);
    const arg = checkoutWithProducts.mock.calls[0][0];
    expect(arg.bookingId).toBe('b1');
    expect(arg.products).toHaveLength(1);
    expect(arg.tenders).toEqual([{ amount: 800, paymentMode: 'Cash' }, { amount: 1000, paymentMode: 'Cash' }]);
    expect(arg.additional).toEqual([{ bookingId: 'b2', tenders: [{ amount: 50, paymentMode: 'Cash' }] }]);
    expect(recordTip).toHaveBeenCalledWith({ bookingId: 'b1', amount: 100, receivedBy: 'u1' });
    expect(onSaved).toHaveBeenCalled();
    expect(r.error).toBeNull();
    expect(r.data.sales[0].id).toBe('s1');
  });

  it('no products => the host treatment path runs, no product call', async () => {
    const checkoutWithProducts = vi.fn();
    const treatment = vi.fn().mockResolvedValue({ error: null });
    const r = await submitCheckout({ bookingId: 'b1', payload: payload({ products: [], productTenders: [] }), treatment, deps: { checkoutWithProducts } });
    expect(treatment).toHaveBeenCalledTimes(1);
    expect(checkoutWithProducts).not.toHaveBeenCalled();
    expect(r.error).toBeNull();
  });

  it('a server answer with no sales is an error, never a "paid" receipt', async () => {
    const checkoutWithProducts = vi.fn().mockResolvedValue({ data: { sales: [], productsTotal: 0 }, error: null });
    const r = await submitCheckout({ bookingId: 'b1', payload: payload({ tipSplits: [] }), treatment: vi.fn(), deps: { checkoutWithProducts, recordTip: vi.fn() } });
    expect(r.error?.message).toMatch(/not saved/);
  });

  it('a server error passes through and no tip is written', async () => {
    const checkoutWithProducts = vi.fn().mockResolvedValue({ data: null, error: { message: 'STOCK' } });
    const recordTip = vi.fn();
    const r = await submitCheckout({ bookingId: 'b1', payload: payload(), treatment: vi.fn(), deps: { checkoutWithProducts, recordTip } });
    expect(r.error.message).toBe('STOCK');
    expect(recordTip).not.toHaveBeenCalled();
  });
});

// Guard: fails if a screen renders PaymentModal but its confirm handler can drop products.
describe('every PaymentModal host saves products', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
  const hosts = walk('src').filter((f) => /\.jsx$/.test(f) && !f.endsWith('PaymentModal.jsx') && /<PaymentModal[\s>]/.test(fs.readFileSync(f, 'utf8')));

  it('finds the known hosts', () => { expect(hosts.length).toBeGreaterThanOrEqual(7); });

  it.each(hosts)('%s routes its confirm through submitCheckout and passes savesProducts', (f) => {
    const src = fs.readFileSync(f, 'utf8');
    expect(src, `${f} must import submitCheckout`).toMatch(/import \{ submitCheckout \} from/);
    expect(src, `${f} must call submitCheckout`).toMatch(/submitCheckout\(/);
    expect(src, `${f} must pass savesProducts to PaymentModal`).toMatch(/\n\s*savesProducts\b/);
  });
});
