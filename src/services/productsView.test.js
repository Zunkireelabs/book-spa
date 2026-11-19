import { describe, it, expect } from 'vitest';
import {
  marginPct, markupPct, priceFromMarkup, marginRange, newAvgCost, stockStatus, offSaleOf, weakestSize, meterShare, buildRows, sizesText, sizeCount,
  stripStats, needsItems, sortProducts, matchesProductSearch, leadParts, reasonLabel, movementTotals, movementLeadParts, whenLabel, monthBounds,
  recentMonths, makeSku, parseImportSheet, sheetErrors, SEGMENTS, REMOVE_REASONS,
} from './productsView';

const LAZ = 'b-laz'; const DUR = 'b-dur';
const catalog = {
  branches: [{ id: LAZ, name: 'Lazimpat' }, { id: DUR, name: 'Durbarmarg' }],
  suppliers: [{ id: 's1', name: 'Himalayan Herbals' }],
  products: [
    { id: 'p-lav', name: 'Lavender Massage Oil', brand: 'Himalayan Herbals', category: 'Massage oils', supplier_id: 's1', track_stock: true, is_active: true, sell_at_checkout: true, pro_use: false },
    { id: 'p-coc', name: 'Coconut Massage Oil', brand: 'Everest', track_stock: true, is_active: true, sell_at_checkout: false, pro_use: true },
    { id: 'p-can', name: 'Lemongrass Candle', track_stock: false, is_active: true, sell_at_checkout: true },
    { id: 'p-arg', name: 'Argan Shampoo', track_stock: true, is_active: true, sell_at_checkout: true },
    { id: 'p-old', name: 'Old Soap', track_stock: true, is_active: false, sell_at_checkout: true },
  ],
  variants: [
    { id: 'v-l5', product_id: 'p-lav', name: '500 ml', sku: 'LAV-500', retail_price: 1800, low_stock_level: 8, sort_order: 1, is_active: true },
    { id: 'v-l1', product_id: 'p-lav', name: '1 L', sku: 'LAV-1L', retail_price: 3200, low_stock_level: 4, sort_order: 2, is_active: true },
    { id: 'v-c', product_id: 'p-coc', name: '', retail_price: 0, low_stock_level: 6, sort_order: 1, is_active: true },
    { id: 'v-k', product_id: 'p-can', name: '', retail_price: 900, sort_order: 1, is_active: true },
    { id: 'v-a', product_id: 'p-arg', name: '250 ml', retail_price: 3200, low_stock_level: 6, sort_order: 1, is_active: true },
    { id: 'v-o', product_id: 'p-old', name: '', retail_price: 100, low_stock_level: 2, sort_order: 1, is_active: true },
  ],
  stock: [
    { variant_id: 'v-l5', branch_id: LAZ, quantity: 4 }, { variant_id: 'v-l5', branch_id: DUR, quantity: 14 },
    { variant_id: 'v-l1', branch_id: LAZ, quantity: 9 }, { variant_id: 'v-l1', branch_id: DUR, quantity: 2 },
    { variant_id: 'v-c', branch_id: DUR, quantity: 3 },
    { variant_id: 'v-a', branch_id: LAZ, quantity: 5 },
    { variant_id: 'v-o', branch_id: LAZ, quantity: 9 },
  ],
  costs: [
    { variant_id: 'v-l5', cost_price: 950, avg_cost: 950 }, { variant_id: 'v-l1', cost_price: 1520, avg_cost: 1520 },
    { variant_id: 'v-a', cost_price: 2048, avg_cost: 2048 }, { variant_id: 'v-c', cost_price: null, avg_cost: 0 },
  ],
};
const rows = buildRows(catalog, LAZ);
const by = (id) => rows.find((r) => r.id === id);

describe('margin and cost maths', () => {
  it('margin / markup / price from markup', () => {
    expect(Math.round(marginPct(1800, 950))).toBe(47);
    expect(Math.round(markupPct(1800, 950))).toBe(89);
    expect(priceFromMarkup(950, 89)).toBe(1795.5);
    expect(marginPct(0, 5)).toBeNull();
    expect(marginPct(100, null)).toBeNull();
    expect(marginPct(100, '')).toBeNull();
  });
  it('margin range over sizes', () => {
    expect(marginRange([47.2, 52.4])).toBe('47–52%');
    expect(marginRange([47.2, 47.4])).toBe('47%');
    expect(marginRange([null, null])).toBe('—');
  });
  it('weighted average cost matches the database (409 from 14 @ 400 + 6 @ 430)', () => {
    expect(newAvgCost(14, 400, 6, 430)).toBe(409);
    expect(newAvgCost(0, 400, 6, 430)).toBe(430);
    expect(newAvgCost(-2, 400, 6, 430)).toBe(430);
    expect(newAvgCost(10, 400, 5, null)).toBe(400);
    // an unknown old cost is unknown, not free: 14 @ unknown + 6 @ 430 = 430 (not 129)
    expect(newAvgCost(14, 0, 6, 430)).toBe(430);
    expect(newAvgCost(14, null, 6, 430)).toBe(430);
    expect(newAvgCost(10, 0, 5, null)).toBeNull();
    expect(newAvgCost(4, 950, 24, 980)).toBeCloseTo(975.7143, 3);
  });
});

describe('stock status', () => {
  it('lavender: one size low at this branch → running low, weakest = 500 ml', () => {
    expect(by('p-lav').status).toBe('low');
    expect(by('p-lav').stockHere).toBe(13);
    expect(by('p-lav').weakest.name).toBe('500 ml');
  });
  it('out = every active size at 0 (coconut here has none, 3 elsewhere)', () => {
    expect(by('p-coc').status).toBe('out');
    expect(by('p-coc').others).toEqual([{ branchId: DUR, name: 'Durbarmarg', qty: 3 }]);
  });
  it('not tracked, in stock, running low', () => {
    expect(by('p-can').status).toBe('untracked');
    expect(by('p-arg').status).toBe('low'); // 5 <= 6
    expect(by('p-old').status).toBe('ok');
  });
  it('a size without a level never counts as low', () => {
    expect(stockStatus({ trackStock: true, variants: [{ active: true, qty: 1, low: null }] })).toBe('ok');
  });
  it('an inactive size is ignored; no active size = out', () => {
    expect(stockStatus({ trackStock: true, variants: [{ active: false, qty: 0, low: 1 }, { active: true, qty: 9, low: 2 }] })).toBe('ok');
    expect(stockStatus({ trackStock: true, variants: [{ active: false, qty: 5, low: 1 }] })).toBe('out');
  });
  it('off sale: switched off or not sold at checkout; the row keeps its stock status', () => {
    expect(by('p-coc').offSale).toBe(true);
    expect(by('p-old').offSale).toBe(true);
    expect(by('p-lav').offSale).toBe(false);
    expect(offSaleOf({ isActive: true, sellAtCheckout: true })).toBe(false);
  });
  it('meter: half full at the level, empty at 0, full without a level', () => {
    expect(meterShare(4, 8)).toBe(0.25);
    expect(meterShare(8, 8)).toBe(0.5);
    expect(meterShare(0, 8)).toBe(0);
    expect(meterShare(3, null)).toBe(1);
  });
  it('weakestSize picks the lowest relative to its own level', () => {
    const p = { variants: [{ active: true, name: 'a', qty: 2, low: 4 }, { active: true, name: 'b', qty: 1, low: 8 }, { active: true, name: 'c', qty: 50, low: 4 }] };
    expect(weakestSize(p).name).toBe('b');
    expect(weakestSize({ variants: [{ active: true, name: 'c', qty: 50, low: 4 }] })).toBeNull();
  });
});

describe('rows', () => {
  it('prices: "from" when sizes differ; sizes text and badge', () => {
    expect(by('p-lav').priceFrom).toBe(1800);
    expect(by('p-lav').priceVaries).toBe(true);
    expect(by('p-arg').priceVaries).toBe(false);
    expect(sizesText(by('p-lav'))).toBe('500 ml, 1 L');
    expect(sizesText(by('p-arg'))).toBe('250 ml');
    expect(sizeCount(by('p-lav'))).toBe(2);
    expect(sizeCount(by('p-arg'))).toBe(0);
  });
  it('margins and stock value exist only with costs', () => {
    expect(by('p-lav').margins.map(Math.round)).toEqual([47, 53]);
    expect(by('p-lav').stockValue).toBe(4 * 950 + 9 * 1520);
    const noCost = buildRows({ ...catalog, costs: null }, LAZ);
    expect(noCost.find((r) => r.id === 'p-lav').margins).toBeNull();
    expect(noCost.find((r) => r.id === 'p-lav').stockValue).toBeNull();
    expect(noCost.find((r) => r.id === 'p-lav').variants[0].avgCost).toBeNull();
  });
  it('no branch picked = every branch summed', () => {
    const all = buildRows(catalog, null);
    expect(all.find((r) => r.id === 'p-lav').stockHere).toBe(29);
    expect(all.find((r) => r.id === 'p-coc').status).toBe('low'); // 3 left, low at 6
  });
  it('unknown cost stays unknown: no value, no margin, flagged', () => {
    const coc = by('p-coc');
    expect(coc.variants[0].unitCost).toBeNull();
    expect(coc.variants[0].value).toBeNull();
    expect(coc.variants[0].margin).toBeNull();
    const all = buildRows(catalog, null).find((r) => r.id === 'p-coc');
    expect(all.costUnknown).toBe(1);
    expect(by('p-lav').costUnknown).toBe(0);
    // a supply price alone (average still 0) is a known cost
    const priced = buildRows({ ...catalog, costs: [{ variant_id: 'v-c', cost_price: 300, avg_cost: 0 }] }, DUR).find((r) => r.id === 'p-coc');
    expect(priced.variants[0].unitCost).toBe(300);
    expect(priced.stockValue).toBe(900);
  });
  it('supplier name is resolved', () => {
    expect(by('p-lav').supplierName).toBe('Himalayan Herbals');
  });
});

describe('strip, needs, sort, search', () => {
  it('strip counts (Off sale overlaps)', () => {
    const s = stripStats(rows);
    expect(s.ok.count).toBe(1); expect(s.low.count).toBe(2); expect(s.out.count).toBe(1); expect(s.untracked.count).toBe(1); expect(s.offsale.count).toBe(2);
    expect(SEGMENTS.map((x) => x.id)).toEqual(['ok', 'low', 'out', 'untracked', 'offsale']);
  });
  it('needs you now: low chip, and out-here-but-stocked-elsewhere → Move here', () => {
    const n = needsItems(rows, { canManage: true });
    expect(n.map((x) => x.id)).toEqual(['low', 'out']);
    expect(n[0].text).toBe('2 running low · Argan Shampoo, Lavender Massage Oil');
    expect(n[0].action).toBe('Receive');
    expect(n[1].text).toBe('Coconut Massage Oil is out · 3 at Durbarmarg');
    expect(n[1].action).toBe('Move here');
    expect(n[1].from).toBe(DUR);
  });
  it('Move here only offers a branch the user can send from', () => {
    expect(needsItems(rows, { canManage: true, canSendFrom: () => false }).find((x) => x.id === 'out').action).toBe('See');
    expect(needsItems(rows, { canManage: true, canSendFrom: (id) => id === DUR }).find((x) => x.id === 'out').action).toBe('Move here');
  });
  it('needs you now for staff: no actions that change stock', () => {
    const n = needsItems(rows, { canManage: false });
    expect(n.every((x) => x.action === 'See')).toBe(true);
  });
  it('an inactive product never needs you; nothing needed = empty', () => {
    expect(needsItems(rows.filter((r) => r.id === 'p-old'), { canManage: true })).toEqual([]);
  });
  it('out everywhere joins the low chip', () => {
    const n = needsItems(buildRows({ ...catalog, stock: [] }, LAZ), { canManage: true });
    expect(n.find((x) => x.id === 'low').text).toMatch(/^3 running low/);
    expect(n.find((x) => x.id === 'out')).toBeUndefined();
  });
  it('sort: needs attention = out, low, ok, then name', () => {
    expect(sortProducts(rows, 'attention').map((r) => r.id)).toEqual(['p-coc', 'p-arg', 'p-lav', 'p-old', 'p-can']);
    expect(sortProducts(rows, 'name')[0].id).toBe('p-arg');
    expect(sortProducts(rows, 'stock')[0].id).toBe('p-lav');
    expect(sortProducts(rows, 'price')[0].id).toBe('p-arg');
  });
  it('search by name, brand, sku, barcode, size', () => {
    expect(matchesProductSearch(by('p-lav'), 'lav oil')).toBe(true);
    expect(matchesProductSearch(by('p-lav'), 'lav-1l')).toBe(true);
    expect(matchesProductSearch(by('p-lav'), 'himalayan')).toBe(true);
    expect(matchesProductSearch(by('p-lav'), '1 l')).toBe(true);
    expect(matchesProductSearch(by('p-lav'), 'shampoo')).toBe(false);
    expect(matchesProductSearch(by('p-lav'), '')).toBe(true);
  });
});

describe('lead sentences', () => {
  const text = (parts) => parts.map((p) => p.strong || p.text).join('');
  it('manager: value at cost, month sold, used', () => {
    const t = text(leadParts(rows, { canCost: true, branchLabel: 'at Lazimpat', monthName: 'October', month: { sold: 46, soldAmount: 52300, used: 9 }, sessionsLabel: 'sessions' }));
    expect(t).toBe(`Stock at Lazimpat worth NPR ${(4 * 950 + 9 * 1520 + 5 * 2048).toLocaleString('en-IN')} at cost (1 size without a cost yet) · October 46 sold for NPR 52,300 · 9 used in sessions`);
  });
  it('manager: zero parts are dropped', () => {
    const t = text(leadParts(rows, { canCost: true, branchLabel: 'at Lazimpat', monthName: 'October', month: { sold: 0, soldAmount: 0, used: 0 }, sessionsLabel: 'sessions' }));
    expect(t).toMatch(/^Stock at Lazimpat worth NPR .* at cost \(1 size without a cost yet\)$/);
  });
  it('staff: product count and running low', () => {
    expect(text(leadParts(rows, { canCost: false, branchLabel: 'at Lazimpat' }))).toBe('5 products · 3 running low at Lazimpat');
  });
});

describe('movements', () => {
  const m = (reason, delta, unitCost = null) => ({ reason, delta, unitCost });
  it('totals', () => {
    const t = movementTotals([m('received', 96), m('sale', -50), m('refund', 4), m('used_in_session', -9), m('damaged', -3, 950), m('lost', -1, 100), m('transfer_out', -6), m('recount', -2)]);
    expect(t).toEqual({ received: 96, sold: 46, used: 9, writtenOff: 4, writtenOffValue: 3 * 950 + 100 });
  });
  it('lead sentence', () => {
    const t = { received: 96, sold: 46, used: 9, writtenOff: 3, writtenOffValue: 2850 };
    const text = movementLeadParts(t, { branchLabel: 'at Lazimpat', monthName: 'October', sessionsLabel: 'sessions', canCost: true }).map((p) => p.strong || p.text).join('');
    expect(text).toBe('October at Lazimpat: +96 received · −46 sold · −9 used in sessions · −3 written off (NPR 2,850 at cost)');
  });
  it('reason labels follow the industry word', () => {
    expect(reasonLabel('used_in_session', { sessionLabel: 'Appointment' })).toBe('Used in an appointment');
    expect(reasonLabel('used_in_session')).toBe('Used in a session');
    expect(reasonLabel('recount')).toBe('Count corrected');
    expect(REMOVE_REASONS[0].id).toBe('used_in_session');
    expect(REMOVE_REASONS).toHaveLength(6);
  });
  it('when label in Nepal time', () => {
    expect(whenLabel('2026-10-25T08:00:00Z', '2026-10-25')).toBe('Today');
    expect(whenLabel('2026-10-24T08:00:00Z', '2026-10-25')).toBe('Yesterday');
    expect(whenLabel('2026-10-23T08:00:00Z', '2026-10-25')).toBe('23 Oct');
    expect(whenLabel('2025-10-23T08:00:00Z', '2026-10-25')).toBe('23 Oct 2025');
    // 20:30 UTC on the 24th is already the 25th in Nepal (UTC+5:45)
    expect(whenLabel('2026-10-24T20:30:00Z', '2026-10-25')).toBe('Today');
  });
  it('months', () => {
    expect(monthBounds('2026-02')).toEqual(['2026-02-01', '2026-02-28']);
    expect(recentMonths('2026-02-10', 3)).toEqual(['2026-02', '2026-01', '2025-12']);
  });
});

describe('sku', () => {
  it('makes a readable, unique code', () => {
    expect(makeSku('Lavender Massage Oil', '500 ml')).toBe('LAV-MAS-500ML');
    expect(makeSku('Shampoo', '')).toBe('SHAMP');
    expect(makeSku('Lavender Massage Oil', '500 ml', new Set(['lav-mas-500ml']))).toBe('LAV-MAS-500ML-2');
  });
});

describe('import sheet', () => {
  it('reads headings in any order, with aliases; drops blank rows; keeps sheet row numbers', () => {
    const r = parseImportSheet([
      ['Retail price', 'Product', 'Size', 'Stock', 'Notes'],
      [120, 'Soap', '', 20, 'x'],
      ['', '', '', '', ''],
      [300, 'Oil', '250 ml', '', ''],
    ]);
    expect(r.problems).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ name: 'Soap', retail: '120', stock: '20', variant: '' });
    expect(r.rows[1]).toMatchObject({ name: 'Oil', variant: '250 ml' });
    expect(r.rowNumbers).toEqual([2, 4]);
  });
  it('needs a name and a retail column', () => {
    expect(parseImportSheet([['Name', 'Brand'], ['x', 'y']]).missing).toEqual(['retail']);
    expect(parseImportSheet([]).problems).toEqual(['The file is empty.']);
    expect(parseImportSheet([['Name', 'Retail']]).problems[0]).toMatch(/no product rows/);
  });
  it('server errors are shown with the sheet row', () => {
    expect(sheetErrors([{ row: 2, message: 'm' }], [2, 4])).toEqual([{ row: 4, message: 'm' }]);
    expect(sheetErrors([{ row: 3, message: 'm' }], null)).toEqual([{ row: 4, message: 'm' }]);
  });
});
