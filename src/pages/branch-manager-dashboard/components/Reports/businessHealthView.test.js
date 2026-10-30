import { describe, it, expect } from 'vitest';
import { buildTiles, buildBridge, methodSlices, bookingFunnel, isEmptyPeriod, exportRows } from './businessHealthView';

const cur = {
  sales: 482300, service_sales: 455500, product_sales: 26800, cash_in: 495900, paid_from_prepaid: 38400, prepaid_sold: 52000,
  paid_from_prepaid_by: { membership: 30000, package: 4400, voucher: 4000, other: 0 }, prepaid_sold_by: { membership: 30000, voucher: 14000, package: 8000 },
  bookings: 612, made: 640, completed: 571, open: 15, cancelled: 28, no_show: 26, avg_ticket: 798,
  busy: { share: 0.64 }, return_rate: { rate: 0.41 }, by_method: { cash: 188400, card: 29800, qr: 277700, other: 0 },
};
const prev = { ...cur, made: 590, sales: 430600, cash_in: 451200, bookings: 567, avg_ticket: 759, busy: { share: 0.67 }, return_rate: { rate: 0.39 } };
const data = { current: cur, previous: prev, branches: [] };

describe('tiles', () => {
  const t = Object.fromEntries(buildTiles(data).map((x) => [x.key, x]));
  it('Sales leads, in lakh grouping, with the previous value', () => {
    expect(buildTiles(data)[0]).toMatchObject({ key: 'sales', lead: true, value: '4,82,300', prevText: 'vs 4,30,600' });
    expect(t.sales.delta).toMatchObject({ dir: 'up', tone: 'good', text: '▲ 12%' });
  });
  it('busy and return rate move in points', () => {
    expect(t.busy).toMatchObject({ value: '64%', prevText: 'vs 67%' });
    expect(t.busy.delta).toMatchObject({ dir: 'down', tone: 'bad', text: '▼ 3 pts' });
    expect(t.return_rate.delta.text).toBe('▲ 2 pts');
  });
  it('no working hours says so instead of 0%, and no previous value gives no chip', () => {
    const x = Object.fromEntries(buildTiles({ current: { ...cur, busy: { share: null } }, previous: { ...prev, busy: { share: null }, avg_ticket: null } }).map((y) => [y.key, y]));
    expect(x.busy.value).toBe('No hours set');
    expect(x.busy.delta).toBeNull();
    expect(x.avg_ticket).toMatchObject({ prevText: '', delta: null });
  });
});

describe('no previous data', () => {
  const none = { current: cur, previous: { made: 0, sales: 0, cash_in: 0, bookings: 0, busy: { share: 0 }, return_rate: { rate: null } }, branches: [] };
  it('no "vs 0" text and no ▲/▼ on any tile', () => {
    const tiles = buildTiles(none);
    expect(tiles.every((t) => t.delta === null && t.prevText === '')).toBe(true);
    expect(tiles[0].value).toBe('4,82,300');
  });
  it('a previous period with only cash still counts as data', () => {
    expect(buildTiles({ ...none, previous: { ...none.previous, cash_in: 10 } })[0].prevText).toMatch(/^vs /);
  });
});

describe('bridge', () => {
  const bridge = { not_paid: 12550, overpaid: 0, paid_before: 0, earlier: 6200, advance: 21000, other: 0, refunds: 0 };
  const c = { ...cur, bridge, service_sales: 455500, cash_in: 510550 };
  it('walks Sales to Cash in in the mockup order, with both sub-lines', () => {
    const b = buildBridge(c);
    expect(b.filter((r) => r.label).map((r) => r.label)).toEqual([
      'Services delivered (Completed, final price)', 'Products', 'Sales (earned)', '− Not paid yet', '+ Paid now for earlier bookings',
      '+ Advance payments for upcoming bookings', '− Paid from prepaid balance', '+ Prepaid sold', '− Refunds', 'Cash in']);
    expect(b.filter((r) => r.total).map((r) => r.value)).toEqual(['4,82,300', '5,10,550']);
    expect(b.find((r) => r.sub?.startsWith('Membership')).sub).toBe('Membership 30,000 · Package 4,400 · Voucher wallet 4,000');
    expect(b.find((r) => r.sub?.startsWith('Memberships')).sub).toBe('Memberships 30,000 · Vouchers 14,000 · Packages 8,000');
  });
  it('the printed lines add up to Cash in', () => {
    const parse = (v) => Number(String(v).replace(/[^0-9]/g, '')) * (String(v).startsWith('−') ? -1 : 1);
    const lines = buildBridge(c).filter((r) => r.label && !r.total && !r.label.startsWith('Services') && r.label !== 'Products');
    expect(4_82_300 + lines.reduce((s, r) => s + parse(r.value), 0)).toBe(5_10_550);
  });
  it('shows "other" and "paid before" only when they hold money, with the cancelled-booking wording', () => {
    expect(buildBridge(c).some((r) => /cancelled|before this period/.test(r.label || ''))).toBe(false);
    const b = buildBridge({ ...c, bridge: { ...bridge, other: 200, paid_before: 400 } });
    expect(b.find((r) => /cancelled/.test(r.label || '')).label).toBe('Paid on cancelled bookings (refund or keep?)');
    expect(b.find((r) => /before this period/.test(r.label || '')).value).toBe('−400');
  });
  it('a refund on a Completed booking nets against the overpaid amount; real overpayment shows as its own line', () => {
    expect(buildBridge({ ...c, bridge: { ...bridge, refunds: 200, overpaid: 200 } }).find((r) => r.label === '− Refunds').value).toBe('0');
    expect(buildBridge({ ...c, bridge: { ...bridge, refunds: 200, overpaid: 50 } }).find((r) => r.label === '− Refunds').value).toBe('−150');
    expect(buildBridge({ ...c, bridge: { ...bridge, refunds: 0, overpaid: 50 } }).find((r) => /Paid above/.test(r.label || '')).value).toBe('+50');
  });
  it('leaves out sub-lines with no money', () => {
    expect(buildBridge({ ...c, paid_from_prepaid_by: {}, prepaid_sold_by: {} }).some((r) => r.sub)).toBe(false);
  });
});

describe('methods, funnel, empty, export', () => {
  it('slices are biggest first and add to 100%', () => {
    const s = methodSlices(cur.by_method);
    expect(s.map((x) => x.key)).toEqual(['qr', 'cash', 'card']);
    expect(s.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1);
  });
  it('the funnel adds up to made', () => {
    const f = bookingFunnel(cur);
    expect(f.made).toBe(640);
    expect(f.rows.reduce((a, r) => a + r.n, 0)).toBe(640);
  });
  it('an empty period is detected, so no zero is shown as a fact', () => {
    expect(isEmptyPeriod({ current: { made: 0, sales: 0, cash_in: 0 } })).toBe(true);
    expect(isEmptyPeriod(data)).toBe(false);
    expect(isEmptyPeriod(null)).toBe(true);
  });
  it('exports the table that is showing', () => {
    expect(exportRows(data, 'summary', 'Last 30 days')[1]).toEqual(['Sales (earned)', 482300, 430600]);
    const b = { ...data, branches: [{ name: 'Lazimpat', current: { ...cur, owed: { amount: 9350 } }, previous: prev }] };
    const rows = exportRows(b, 'branches');
    expect(rows[0][0]).toBe('Branch');
    expect(rows.at(-1)[0]).toBe('All branches');
    expect(rows[1][7]).toBe(9350);
  });
});
