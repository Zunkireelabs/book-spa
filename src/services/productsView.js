// Products page (V25): pure logic for the Products / Stock history / Suppliers tabs: stock status, the five-part strip, the lead
// sentence, Needs-you-now, sorting, search, margins, average-cost preview, the stock-movement labels and the CSV import checks.
// No React, no Supabase. A "row" is what buildRows() makes from fetchProductCatalog(): one product with its sizes (variants), the
// stock at the current branch (or in total when no branch is picked) and, for managers/admins only, the costs.
import { npr } from './packagesView';
import { wordBranches } from '../utils/industryTerms';

export { npr };

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);
const num = (v) => (v == null || v === '' ? null : Number(v));
const TZ = 'Asia/Kathmandu';
/** Nepal calendar date of a timestamp. */
export const nepalDate = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ });
/** Nepal clock time "14:20" of a timestamp. */
export const nepalTime = (ts) => new Date(ts).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

// ── Margin, markup, average cost ───────────────────────────────────────────────────────────────
/** Margin % = (price − cost) / price. null when either is missing or the price is 0. */
export const marginPct = (price, cost) => {
  const p = num(price); const c = num(cost);
  if (p == null || c == null || !(p > 0) || !(c > 0)) return null;
  return ((p - c) / p) * 100;
};
/** Markup % = (price − cost) / cost. */
export const markupPct = (price, cost) => {
  const p = num(price); const c = num(cost);
  if (p == null || c == null || !(c > 0) || !(p > 0)) return null;
  return ((p - c) / c) * 100;
};
/** The price that gives this markup over cost (the form's cost ↔ price ↔ markup link). */
export const priceFromMarkup = (cost, markup) => {
  const c = num(cost); const m = num(markup);
  if (c == null || m == null || !(c > 0)) return null;
  return Math.round(c * (1 + m / 100) * 100) / 100;
};
/** "47%" or "47–52%" over a list of margins (nulls ignored); '—' when none. */
export const marginRange = (margins) => {
  const m = margins.filter((x) => x != null);
  if (!m.length) return '—';
  const lo = Math.round(Math.min(...m)); const hi = Math.round(Math.max(...m));
  return lo === hi ? `${lo}%` : `${lo}–${hi}%`;
};
/**
 * Weighted average cost after a receive, the same maths as the database (_inv_receive): an empty shelf, or an unknown old cost, takes
 * the new cost; otherwise (old_qty × old_unit + qty × cost) / (old_qty + qty). `oldQty` is the size's stock across ALL branches (avg cost
 * is one number); `oldUnit` is the size's unit cost today (the average if known, else the supply price, else null/0 = unknown, which is
 * NOT free).
 */
export const newAvgCost = (oldQty, oldUnit, qty, cost) => {
  const q = Number(qty) || 0; const c = num(cost);
  const u = num(oldUnit);
  if (c == null || q <= 0) return u > 0 ? u : null;
  const o = Number(oldQty) || 0;
  if (o <= 0 || !(u > 0)) return c;
  return Math.round(((o * u + q * c) / (o + q)) * 10000) / 10000;
};

// ── Stock status ───────────────────────────────────────────────────────────────────────────────
export const STATUS = {
  ok: { label: 'In stock', dot: '#3E7A35', pill: 'bg-[#EEF3EC] text-[#2D5A27]' },
  low: { label: 'Running low', dot: '#F59E0B', pill: 'bg-[#FEF3C7] text-[#92400E]' },
  out: { label: 'Out of stock', dot: '#DC2626', pill: 'bg-[#FEF2F2] text-[#991B1B]' },
  untracked: { label: 'Not tracked', dot: '#9CA3AF', pill: 'bg-[#F3F4F6] text-[#4B5563]' },
};
const activeVariants = (p) => p.variants.filter((v) => v.active);
/**
 * One stock status per product at the page's branch (or in total when no branch is picked):
 * Not tracked = the product does not count stock; Out = every active size is at 0; Running low = any active size is at or below
 * its own low level (sizes without a level never count); otherwise In stock. "Off sale" is separate (offSaleOf): the row keeps this.
 */
export function stockStatus(p) {
  if (!p.trackStock) return 'untracked';
  const vs = activeVariants(p);
  if (vs.length === 0) return 'out';
  if (vs.every((v) => v.qty <= 0)) return 'out';
  if (vs.some((v) => v.low != null && v.qty <= v.low)) return 'low';
  return 'ok';
}
/** Hidden from checkout: switched off, or not sold at checkout (a pro-use item). */
export const offSaleOf = (p) => !p.isActive || !p.sellAtCheckout;

/** The size to call out under the meter: the lowest relative to its level (an out size first), or null when none is low. */
export function weakestSize(p) {
  const low = activeVariants(p).filter((v) => v.low != null && v.qty <= v.low);
  if (!low.length) return null;
  return low.slice().sort((a, b) => (a.qty / Math.max(1, a.low)) - (b.qty / Math.max(1, b.low)) || a.qty - b.qty)[0];
}
/** Meter fill 0..1: stock against twice the low level (at the level it is half full); no level: full when any stock. */
export function meterShare(qty, low) {
  if (!(qty > 0)) return 0;
  if (low == null || !(low > 0)) return 1;
  return Math.min(1, qty / (low * 2));
}

// ── Building rows ──────────────────────────────────────────────────────────────────────────────
/**
 * catalog = { products, variants, stock, costs, branches } (raw rows from fetchProductCatalog); `branchId` null = every branch summed.
 * `costs` is null for people who may not see cost. Output rows are sorted by name; sizes by sort_order.
 */
export function buildRows(catalog, branchId) {
  const { products = [], variants = [], stock = [], costs = null, branches = [], suppliers = [] } = catalog;
  const branchName = Object.fromEntries(branches.map((b) => [b.id, b.name]));
  const supplierName = Object.fromEntries(suppliers.map((s) => [s.id, s.name]));
  const costBy = costs ? Object.fromEntries(costs.map((c) => [c.variant_id, c])) : null;
  const stockBy = new Map(); // variantId -> { here, byBranch: Map(branchId -> qty) }
  stock.forEach((s) => {
    const e = stockBy.get(s.variant_id) || { byBranch: new Map() };
    e.byBranch.set(s.branch_id, (e.byBranch.get(s.branch_id) || 0) + s.quantity);
    stockBy.set(s.variant_id, e);
  });
  const varsBy = new Map();
  variants.forEach((v) => { const a = varsBy.get(v.product_id) || []; a.push(v); varsBy.set(v.product_id, a); });

  return products.map((p) => {
    const vs = (varsBy.get(p.id) || []).slice().sort((a, b) => (a.sort_order - b.sort_order) || String(a.created_at).localeCompare(String(b.created_at)));
    const sizes = vs.map((v) => {
      const by = stockBy.get(v.id)?.byBranch || new Map();
      const here = branchId ? (by.get(branchId) || 0) : sum([...by.values()], (x) => x);
      const c = costBy ? costBy[v.id] : null;
      const avg = c ? Number(c.avg_cost) : null;
      const last = c && c.cost_price != null ? Number(c.cost_price) : null;
      const unitCost = avg > 0 ? avg : (last > 0 ? last : null); // unknown (null) is not 0
      return {
        id: v.id, name: v.name || '', sku: v.sku || '', barcode: v.barcode || '', price: Number(v.retail_price) || 0,
        low: v.low_stock_level, reorder: v.reorder_qty, active: v.is_active !== false, qty: here,
        total: sum([...by.values()], (x) => x),
        byBranch: by, avgCost: avg, lastCost: last, unitCost: costBy ? unitCost : null, margin: unitCost ? marginPct(v.retail_price, unitCost) : null,
        value: costBy && unitCost != null ? here * unitCost : null,
      };
    });
    const act = sizes.filter((v) => v.active);
    const shown = act.length ? act : sizes;
    const prices = shown.map((v) => v.price);
    const others = [];
    if (branchId) {
      const ids = new Set();
      sizes.forEach((v) => v.byBranch.forEach((q, b) => { if (b !== branchId && q > 0) ids.add(b); }));
      ids.forEach((b) => others.push({ branchId: b, name: branchName[b] || '—', qty: sum(act, (v) => v.byBranch.get(b) || 0) }));
      others.sort((a, b) => b.qty - a.qty);
    }
    const row = {
      id: p.id, name: p.name, brand: p.brand || '', category: p.category || '', supplierId: p.supplier_id || null,
      supplierName: p.supplier_id ? (supplierName[p.supplier_id] || '') : '', imageUrl: p.image_url || null, description: p.description || '',
      optionLabel: p.option_label || '', earnsCommission: p.earns_commission !== false, proUse: !!p.pro_use, sellAtCheckout: p.sell_at_checkout !== false, notifyLow: p.notify_low !== false,
      trackStock: !!p.track_stock, isActive: p.is_active !== false, createdAt: p.created_at, variants: sizes,
      stockHere: sum(act, (v) => v.qty), priceFrom: prices.length ? Math.min(...prices) : 0, priceVaries: prices.length > 1 && Math.min(...prices) !== Math.max(...prices),
      others, othersTotal: sum(others, (o) => o.qty), margins: costBy ? shown.map((v) => v.margin) : null,
      stockValue: costBy ? sum(act, (v) => v.value || 0) : null,
      // Sizes that hold stock but have no known cost yet: their value is left out of the stock value, and the UI says so.
      costUnknown: costBy ? act.filter((v) => v.qty > 0 && v.unitCost == null).length : 0,
    };
    row.status = stockStatus(row);
    row.offSale = offSaleOf(row);
    row.weakest = weakestSize(row);
    return row;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** "500 ml, 1 L" for the sub-line; '' for a single size. */
export const sizesText = (p) => (p.variants.filter((v) => v.active && v.name).length > 1 ? p.variants.filter((v) => v.active && v.name).map((v) => v.name).join(', ') : (p.variants.find((v) => v.name)?.name || ''));
/** Number of active sizes when there is more than one ("2 SIZES" badge), else 0. */
export const sizeCount = (p) => { const n = p.variants.filter((v) => v.active).length; return n > 1 ? n : 0; };

// ── Strip, filters, Needs you now ──────────────────────────────────────────────────────────────
export const SEGMENTS = [
  { id: 'ok', label: 'In stock', color: '#3E7A35', test: (p) => p.status === 'ok', hint: 'Enough on the shelf' },
  { id: 'low', label: 'Running low', color: '#F59E0B', test: (p) => p.status === 'low', hint: 'At or below the low level' },
  { id: 'out', label: 'Out of stock', color: '#DC2626', test: (p) => p.status === 'out', hint: 'Nothing left here' },
  { id: 'untracked', label: 'Not tracked', color: '#9CA3AF', test: (p) => p.status === 'untracked', hint: "Stock isn't counted" },
  { id: 'offsale', label: 'Off sale', color: '#D1D5DB', test: (p) => p.offSale, hint: 'Hidden from checkout' },
];
export const segmentById = (id) => SEGMENTS.find((s) => s.id === id) || null;
/** Strip numbers. Off sale overlaps the others (a row keeps its stock status), so the five do not add up to the total. */
export function stripStats(rows) {
  return Object.fromEntries(SEGMENTS.map((s) => [s.id, { count: rows.filter((p) => s.test(p)).length }]));
}
export const NEED_FILTERS = {
  low: { label: 'Running low', test: (p) => p.status === 'low' || (p.status === 'out' && p.othersTotal <= 0) },
  out: { label: 'Out here, stocked elsewhere', test: (p) => p.status === 'out' && p.othersTotal > 0 },
};

/**
 * Needs you now: [{ id, text, action, dot, product? }]. "N running low · names +k" (Receive) covers low sizes and out products
 * that are out everywhere; "X is out · n at Branch" (Move here) covers products out here but stocked at another branch.
 */
export function needsItems(rows, { canManage = false, canSendFrom = () => true } = {}) {
  const items = [];
  const tracked = rows.filter((p) => p.trackStock && p.isActive);
  const low = tracked.filter(NEED_FILTERS.low.test);
  if (low.length) {
    const names = low.slice(0, 2).map((p) => p.name).join(', ');
    items.push({ id: 'low', text: `${low.length} running low · ${names}${low.length > 2 ? ` +${low.length - 2}` : ''}`, action: canManage ? 'Receive' : 'See', dot: '#F59E0B' });
  }
  const out = tracked.filter(NEED_FILTERS.out.test);
  const source = (p) => p.others.find((o) => o.qty > 0 && canSendFrom(o.branchId));
  if (out.length === 1 && canManage && source(out[0])) {
    const p = out[0]; const src = source(p);
    items.push({ id: 'out', text: `${p.name} is out · ${src.qty} at ${src.name}`, action: 'Move here', dot: '#DC2626', product: p, from: src.branchId });
  } else if (out.length >= 1) {
    items.push({ id: 'out', text: `${out.length === 1 ? `${out[0].name} is out here` : `${out.length} out here`} · stocked at other ${wordBranches()}`, action: 'See', dot: '#DC2626' });
  }
  return items;
}

// ── Sort, search ───────────────────────────────────────────────────────────────────────────────
const RANK = { out: 0, low: 1, ok: 2, untracked: 3 };
export const SORTS = {
  attention: { label: 'Needs attention', cmp: (a, b) => (RANK[a.status] - RANK[b.status]) || a.name.localeCompare(b.name) },
  name: { label: 'Name', cmp: (a, b) => a.name.localeCompare(b.name) },
  stock: { label: 'Stock (most first)', cmp: (a, b) => (b.stockHere - a.stockHere) || a.name.localeCompare(b.name) },
  price: { label: 'Price (high to low)', cmp: (a, b) => (b.priceFrom - a.priceFrom) || a.name.localeCompare(b.name) },
};
export const sortProducts = (rows, sort) => rows.slice().sort((SORTS[sort] || SORTS.attention).cmp);
/** Search by name, brand, SKU or barcode (every size). Case-insensitive, all words must match. */
export function matchesProductSearch(p, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [p.name, p.brand, ...p.variants.flatMap((v) => [v.name, v.sku, v.barcode])].filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

// ── Lead sentences ─────────────────────────────────────────────────────────────────────────────
/**
 * Manager/admin: "Stock at <branch> worth NPR X at cost · <Month> N sold for NPR Y · N used in <sessions>".
 * Staff and viewers: "N products · N running low at <branch>". `month` = { sold, soldAmount, used } for this Nepal month.
 */
export function leadParts(rows, { canCost, branchLabel, monthName, month, sessionsLabel }) {
  const lowN = rows.filter((p) => p.trackStock && p.isActive && (p.status === 'low' || p.status === 'out')).length;
  if (!canCost) {
    const out = [{ strong: plural(rows.length, 'product') }];
    if (lowN > 0) out.push({ text: ' · ' }, { strong: `${lowN} running low` }, { text: ` ${branchLabel}` });
    return out;
  }
  const value = sum(rows, (p) => p.stockValue || 0);
  const unknown = sum(rows, (p) => p.costUnknown || 0);
  const out = [{ text: `Stock ${branchLabel} worth ` }, { strong: npr(value) }, { text: ' at cost' }];
  if (unknown > 0) out.push({ text: ` (${plural(unknown, 'size')} without a cost yet)` });
  if (month && month.sold > 0) out.push({ text: ` · ${monthName} ` }, { strong: `${month.sold} sold` }, { text: ` for ${npr(month.soldAmount)}` });
  if (month && month.used > 0) out.push({ text: ` · ${month.used} used in ${sessionsLabel}` });
  return out;
}

// ── Stock movements (the ledger) ───────────────────────────────────────────────────────────────
export const REASONS = {
  received: { label: 'Received', pill: 'bg-[#EEF3EC] text-[#2D5A27]' },
  import_opening: { label: 'Opening stock', pill: 'bg-[#EEF3EC] text-[#2D5A27]' },
  sale: { label: 'Sold', pill: 'bg-[#F3F4F6] text-[#374151]' },
  refund: { label: 'Refund', pill: 'bg-[#FDF2F8] text-[#BE185D]' },
  transfer_in: { label: 'Moved in', pill: 'bg-[#EEF3EC] text-[#2D5A27]' },
  transfer_out: { label: 'Moved out', pill: 'bg-[#EEF3EC] text-[#2D5A27]' },
  used_in_session: { label: 'Used', pill: 'bg-[#EEF2FF] text-[#4338CA]' },
  damaged: { label: 'Damaged', pill: 'bg-[#FEF2F2] text-[#991B1B]' },
  expired: { label: 'Expired', pill: 'bg-[#FEF2F2] text-[#991B1B]' },
  lost: { label: 'Lost', pill: 'bg-[#FEF2F2] text-[#991B1B]' },
  sample: { label: 'Sample', pill: 'bg-[#F3F4F6] text-[#374151]' },
  recount: { label: 'Count corrected', pill: 'bg-[#FEF3C7] text-[#92400E]' },
  other: { label: 'Other', pill: 'bg-[#F3F4F6] text-[#374151]' },
};
/** Reason label; "Used in a {session}" follows the industry's word (Session / Appointment / Job). */
export const withArticle = (word) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${String(word).toLowerCase()}`;
export const reasonLabel = (reason, { sessionLabel = 'Session' } = {}) => (reason === 'used_in_session' ? `Used in ${withArticle(sessionLabel)}` : (REASONS[reason]?.label || reason));
/** The six "Remove" reasons in the order shown (the first is "Used in a {session}"). */
export const REMOVE_REASONS = [
  { id: 'used_in_session', sub: 'Pro use, no sale' },
  { id: 'damaged', label: 'Damaged or broken', sub: "Can't be sold or used" },
  { id: 'expired', label: 'Expired', sub: 'Past its use-by date' },
  { id: 'lost', label: 'Lost or missing', sub: "Can't be found" },
  { id: 'sample', label: 'Given as a sample', sub: 'Free to a guest' },
  { id: 'other', label: 'Other', sub: 'Explain in the note' },
];
/** Month key 'YYYY-MM' → [first day, last day] as Nepal dates. */
export function monthBounds(key) {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${key}-01`, `${key}-${String(last).padStart(2, '0')}`];
}
export const monthLabel = (key) => new Date(`${key}-15T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });
export const monthName = (key) => new Date(`${key}-15T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'long' });
/** The last `n` month keys ending at the month of `today`. */
export function recentMonths(today, n = 12) {
  let [y, m] = today.slice(0, 7).split('-').map(Number);
  const out = [];
  for (let i = 0; i < n; i += 1) { out.push(`${y}-${String(m).padStart(2, '0')}`); m -= 1; if (m === 0) { m = 12; y -= 1; } }
  return out;
}
/**
 * Totals for the Stock history lead: received (+ in), sold, used, written off (damaged/expired/lost/sample), and the cost of the
 * write-off. Transfers and recounts are not counted here. Rows are fetchStockMovements() rows (delta, reason, unitCost).
 */
export function movementTotals(moves) {
  const t = { received: 0, sold: 0, used: 0, writtenOff: 0, writtenOffValue: 0 };
  moves.forEach((m) => {
    const d = m.delta;
    if (m.reason === 'received' || m.reason === 'import_opening') t.received += d;
    else if (m.reason === 'sale') t.sold += -d;
    else if (m.reason === 'refund') t.sold -= d;
    else if (m.reason === 'used_in_session') t.used += -d;
    else if (['damaged', 'expired', 'lost', 'sample'].includes(m.reason)) { t.writtenOff += -d; t.writtenOffValue += -d * (Number(m.unitCost) || 0); }
  });
  return t;
}
export function movementLeadParts(t, { branchLabel, monthName: mn, sessionsLabel, canCost }) {
  const out = [{ text: `${mn} ${branchLabel}: ` }, { strong: `+${t.received} received` }, { text: ` · ` }, { strong: `−${t.sold} sold` }];
  if (t.used > 0) out.push({ text: ` · −${t.used} used in ${sessionsLabel}` });
  if (t.writtenOff > 0) out.push({ text: ` · −${t.writtenOff} written off${canCost && t.writtenOffValue > 0 ? ` (${npr(t.writtenOffValue)} at cost)` : ''}` });
  return out;
}
/** "Today" / "Yesterday" / "23 Oct" for the When column. */
export function whenLabel(ts, today) {
  const d = nepalDate(ts);
  if (d === today) return 'Today';
  const [y, m, day] = today.split('-').map(Number);
  const yest = new Date(Date.UTC(y, m - 1, day - 1)).toISOString().slice(0, 10);
  if (d === yest) return 'Yesterday';
  const [, mm, dd] = d.split('-').map(Number);
  return `${dd} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mm - 1]}${d.slice(0, 4) !== today.slice(0, 4) ? ` ${d.slice(0, 4)}` : ''}`;
}

// ── SKU ────────────────────────────────────────────────────────────────────────────────────────
const letters = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
/** "Lavender Massage Oil" + "500 ml" → "LAV-OIL-500ML"; made unique against `taken` (lower-case set) with -2, -3 … */
export function makeSku(name, sizeName, taken = new Set(), brand = '') {
  const words = letters(name).split(' ').filter(Boolean);
  const head = words.length > 1 ? words.slice(0, 2).map((w) => w.slice(0, 3)).join('-') : (words[0] || 'ITEM').slice(0, 5);
  const brandHead = brand ? `${letters(brand).split(' ')[0].slice(0, 2)}-` : '';
  const size = letters(sizeName).replace(/ /g, '');
  const base = [brandHead + head, size].filter(Boolean).join('-');
  let sku = base; let i = 2;
  while (taken.has(sku.toLowerCase())) { sku = `${base}-${i}`; i += 1; }
  return sku;
}

// ── Import / export columns ────────────────────────────────────────────────────────────────────
export const IMPORT_COLUMNS = ['name', 'brand', 'variant', 'category', 'barcode', 'sku', 'supplier', 'cost', 'retail', 'low_at', 'reorder', 'stock'];
export const IMPORT_HEADINGS = { name: 'Name', brand: 'Brand', variant: 'Size', category: 'Category', barcode: 'Barcode', sku: 'SKU', supplier: 'Supplier', cost: 'Cost', retail: 'Retail price', low_at: 'Low at', reorder: 'Reorder qty', stock: 'Stock' };
const ALIASES = {
  name: ['name', 'product', 'product name', 'item'], brand: ['brand'], variant: ['variant', 'size', 'option', 'size / shade', 'shade'], category: ['category'],
  barcode: ['barcode', 'ean', 'upc', 'gtin'], sku: ['sku', 'code'], supplier: ['supplier', 'vendor'], cost: ['cost', 'cost price', 'supply price', 'unit cost'],
  retail: ['retail', 'retail price', 'price', 'sell price', 'selling price'], low_at: ['low at', 'low_at', 'low stock', 'low stock level', 'low'],
  reorder: ['reorder', 'reorder qty', 'reorder quantity', 'reorder_qty'], stock: ['stock', 'quantity', 'qty', 'opening stock', 'on hand'],
};
const norm = (h) => String(h || '').toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
export const MAX_IMPORT_ROWS = 2000;
/**
 * A sheet read as arrays (first row = headings) → { rows: [{ name, brand, … }], problems: [text], missing: [column] }.
 * Headings are matched by name (see ALIASES), in any order; extra columns are ignored; blank rows are dropped. `rowNumbers[i]` is the
 * spreadsheet row of rows[i] (the first data row is 2) so the server's row numbers can be shown as the sheet's own.
 */
export function parseImportSheet(table) {
  const out = { rows: [], rowNumbers: [], problems: [], missing: [] };
  if (!Array.isArray(table) || table.length === 0) { out.problems.push('The file is empty.'); return out; }
  const head = table[0].map(norm);
  const at = {};
  IMPORT_COLUMNS.forEach((c) => { const i = head.findIndex((h) => ALIASES[c].includes(h)); if (i >= 0) at[c] = i; });
  ['name', 'retail'].forEach((c) => { if (at[c] === undefined) out.missing.push(c); });
  if (out.missing.length) { out.problems.push(`Add a ${out.missing.map((c) => `"${IMPORT_HEADINGS[c]}"`).join(' and ')} column.`); return out; }
  table.slice(1).forEach((r, idx) => {
    const row = {};
    IMPORT_COLUMNS.forEach((c) => { const v = at[c] === undefined ? '' : r[at[c]]; row[c] = v == null ? '' : String(v).trim(); });
    if (IMPORT_COLUMNS.every((c) => !row[c])) return;
    out.rows.push(row); out.rowNumbers.push(idx + 2);
  });
  if (out.rows.length === 0) out.problems.push('There are no product rows under the headings.');
  if (out.rows.length > MAX_IMPORT_ROWS) out.problems.push(`At most ${MAX_IMPORT_ROWS} rows at a time (this file has ${out.rows.length}).`);
  return out;
}
/** Server dry-run errors → [{ row (sheet row), message, create? }] using the sheet's own row numbers. */
export const sheetErrors = (errors, rowNumbers) => (errors || []).map((e) => ({ ...e, row: rowNumbers?.[e.row - 1] ?? e.row + 1 }));
