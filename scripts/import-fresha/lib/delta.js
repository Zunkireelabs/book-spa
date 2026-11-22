// Shared by phase B (setup) and the delta phases: customer + product preparation (pure) and their inserts.
import { normalizePhone, toPaisa, normName, uuid5 } from './parse.js';

const validDate = (s) => {
  const t = Date.parse(s);
  if (!s || Number.isNaN(t)) return null;
  const d = new Date(t);
  return d.getUTCFullYear() >= 1900 && d.getTime() < Date.now() ? d.toISOString().slice(0, 10) : null;
};

// Pure. `existingIds`: customer ids already in the org (never touched). `ownedPhones`: phones already held by existing customers
// (a new person with the same number becomes shared-mobile: the one added first keeps the phone, as in phase B).
export function prepareCustomers(rows, { ns, existingIds = new Set(), ownedPhones = new Set() } = {}) {
  const out = { items: [], existing: 0, noName: 0, badPhone: [], sharedMobile: [], noPhone: [], blocked: [] };
  const prepared = [];
  for (const row of rows) {
    const name = (row['Full Name'] || `${row['First Name']} ${row['Last Name']}`).trim();
    if (!name) { out.noName++; continue; }
    const id = uuid5(`${ns}|client:${row['Client ID']}`);
    if (existingIds.has(id)) { out.existing++; continue; }
    const ph = normalizePhone(row['Mobile Number']);
    if (ph && !ph.phone) out.badPhone.push({ name, raw: ph.unparsed });
    prepared.push({ id, row, name, ph: ph && ph.phone ? ph : null, added: row.Added, shared: false });
  }
  const byPhone = new Map();
  for (const p of prepared) if (p.ph) { if (!byPhone.has(p.ph.phone)) byPhone.set(p.ph.phone, []); byPhone.get(p.ph.phone).push(p); }
  for (const [phone, list] of byPhone) {
    list.sort((a, b) => (Date.parse(a.added) || 0) - (Date.parse(b.added) || 0));
    if (ownedPhones.has(phone)) { list.forEach((p) => { p.shared = true; }); out.sharedMobile.push({ phone, names: ['(existing customer)', ...list.map((p) => p.name)] }); }
    else if (list.length > 1) { list.slice(1).forEach((p) => { p.shared = true; }); out.sharedMobile.push({ phone, names: list.map((p) => p.name) }); }
  }
  for (const p of prepared) {
    p.blocked = /^yes$/i.test(p.row.Blocked);
    if (!p.ph) out.noPhone.push(p.name);
    if (p.blocked) out.blocked.push(p.name);
  }
  out.items = prepared;
  return out;
}

export async function insertCustomer(c, t, p) {
  const { row } = p;
  const tags = [...(row.Tags ? row.Tags.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : []), 'fresha-import', ...(p.shared ? ['shared-mobile'] : [])];
  const g = /^male$/i.test(row.Gender) ? 'male' : /^female$/i.test(row.Gender) ? 'female' : null;
  await c.query(
    `insert into customers (id, branch_id, org_id, full_name, phone, additional_phone, email, gender, date_of_birth, client_source, tags, is_active, notes, country, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, coalesce($15::timestamptz, now()))`,
    [p.id, t.branchId, t.orgId, p.name, p.shared ? null : p.ph?.phone ?? null, p.shared ? p.ph.phone : null, row.Email || null, g, validDate(row['Date of Birth']),
      row['Referral Source'] || null, tags, !p.blocked, p.blocked ? `Blocked in Fresha: ${row['Block Reason'] || ''}`.trim() : null, p.ph?.country ?? null,
      Number.isNaN(Date.parse(row.Added)) ? null : new Date(row.Added).toISOString()]);
}

// Delta: only clients that are not in the org yet. Existing customers are never read for update, never written.
export async function customersDelta(c, t, x) {
  if (t.flags.phone) throw new Error('organizations.require_customer_phone must be false for this org before importing');
  const ex = (await c.query('select id, phone from customers where org_id=$1', [t.orgId])).rows;
  const prep = prepareCustomers(x.clients.rows, { ns: t.orgId, existingIds: new Set(ex.map((e) => e.id)), ownedPhones: new Set(ex.map((e) => e.phone).filter(Boolean)) });
  for (const p of prep.items) await insertCustomer(c, t, p);
  return { read: x.clients.rows.length + x.clients.empty, empty: x.clients.empty, existing: prep.existing, created: prep.items.length, noName: prep.noName, badPhone: prep.badPhone, sharedMobile: prep.sharedMobile, noPhone: prep.noPhone, blocked: prep.blocked };
}

export const PRODUCT_COLS = ['Product name', 'SKU', 'Additional SKUs', 'Barcode', 'Short description', 'Description', 'Measure Type', 'Measure Value', 'Cost price', 'Full price', 'Tax rate', 'Category', 'Brand', 'Supplier', 'Total Stock'];

// Pure. Duplicate names: the first keeps its name, the next ones get " (2)", " (3)" (same naming in B and in the delta).
export function prepareProducts(rows) {
  const stockCol = Object.keys(rows[0] || {}).find((h) => !PRODUCT_COLS.includes(h));
  const seen = new Map(); const out = { items: [], dup: [], neg: [], inf: [], noCategory: [] };
  for (const p of rows) {
    let name = p['Product name'];
    const k = normName(name);
    if (seen.has(k)) { out.dup.push(name); name = `${name} (${seen.get(k) + 1})`; seen.set(k, seen.get(k) + 1); } else seen.set(k, 1);
    if (p['Full price'] === '') throw new Error(`Product "${name}" has no Full price: refuse and list`);
    const raw = String(p[stockCol] ?? p['Total Stock'] ?? '').trim();
    const inf = raw === '∞'; let qty = inf ? 0 : Number(raw || 0);
    if (!inf && qty < 0) { out.neg.push(name); qty = 0; }
    if (inf) out.inf.push(name);
    if (!p.Category) out.noCategory.push(`product:${name}`);
    out.items.push({ name, row: p, price: toPaisa(p['Full price']), inf, qty });
  }
  return out;
}

export async function insertProduct(c, t, it, { reason = 'import_opening', note = 'Opening stock (Fresha import)' } = {}) {
  const pid = (await c.query(`insert into products (org_id, name, description, category, price_npr, track_stock, brand) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [t.orgId, it.name, it.row['Short description'] || it.row.Description || null, it.row.Category || null, it.price / 100, !it.inf, it.row.Brand || null])).rows[0].id;
  const vid = (await c.query(`insert into product_variants (org_id, product_id, name, retail_price) values ($1,$2,'Default',$3) returning id`, [t.orgId, pid, it.price / 100])).rows[0].id;
  if (!it.inf && it.qty > 0) {
    await c.query('insert into product_branch_stock (product_id, branch_id, variant_id, quantity) values ($1,$2,$3,$4)', [pid, t.branchId, vid, it.qty]);
    await c.query(`insert into product_stock_movements (org_id, branch_id, product_id, variant_id, delta, qty_after, reason, note, performed_by) values ($1,$2,$3,$4,$5,$5,$6,$7,$8)`,
      [t.orgId, t.branchId, pid, vid, it.qty, reason, note, t.adminId]);
  }
  return pid;
}

// Delta: new products are created with opening stock; for an existing product whose export stock differs from the DB, ONE new
// movement (reason 'recount') brings it to the export figure. Nothing is overwritten; price/name changes are only reported.
export async function productsDelta(c, t, x) {
  const prep = prepareProducts(x.products.rows);
  const ex = (await c.query(`select p.id, p.name, p.price_npr::numeric as price, p.track_stock,
      (select v.id from product_variants v where v.product_id=p.id order by v.sort_order, v.created_at limit 1) as vid,
      coalesce((select sum(s.quantity) from product_branch_stock s where s.product_id=p.id and s.branch_id=$2),0)::int as qty
    from products p where p.org_id=$1`, [t.orgId, t.branchId])).rows;
  const byName = new Map(ex.map((e) => [normName(e.name), e]));
  const r = { read: x.products.rows.length + x.products.empty, empty: x.products.empty, created: 0, stockChanged: [], priceDiffers: [], unchanged: 0, notTracked: [] };
  for (const it of prep.items) {
    const e = byName.get(normName(it.name));
    if (!e) { await insertProduct(c, t, it, { reason: 'import_opening', note: 'Opening stock (Fresha delta import)' }); r.created++; continue; }
    if (Math.round(Number(e.price) * 100) !== it.price) r.priceDiffers.push({ name: it.name, db: Number(e.price), fresha: it.price / 100 });
    if (it.inf || !e.track_stock) { if (it.inf !== !e.track_stock) r.notTracked.push(it.name); continue; }
    if (e.qty === it.qty) { r.unchanged++; continue; }
    await c.query(`insert into product_branch_stock (product_id, branch_id, variant_id, quantity) values ($1,$2,$3,$4)
      on conflict (variant_id, branch_id) do update set quantity = excluded.quantity, updated_at = now()`, [e.id, t.branchId, e.vid, it.qty]);
    await c.query(`insert into product_stock_movements (org_id, branch_id, product_id, variant_id, delta, qty_after, reason, note, performed_by) values ($1,$2,$3,$4,$5,$6,'recount','Fresha delta import: stock set to the Fresha figure',$7)`,
      [t.orgId, t.branchId, e.id, e.vid, it.qty - e.qty, it.qty, t.adminId]);
    r.stockChanged.push({ name: it.name, from: e.qty, to: it.qty });
  }
  return r;
}
