// Phase B: customers, staff (+ default hours), services, products + opening stock. One transaction (caller owns it).
import { normalizePhone, parseDuration, toPaisa, normName, uuid5 } from './parse.js';

export const WEEK = [0, 1, 2, 3, 4, 5, 6]; // Mon=0 .. Sun=6, as branch_working_hours stores it

export async function getTarget(c, slug, adminEmail) {
  const o = (await c.query('select id, industry_type, allow_staff_overlap, require_customer_phone from organizations where slug=$1', [slug])).rows[0];
  if (!o) throw new Error(`Org "${slug}" not found`);
  if (o.industry_type !== 'beauty') throw new Error(`Org "${slug}" is "${o.industry_type}", not beauty`);
  const br = (await c.query('select id, open_time, close_time from branches where org_id=$1 and is_active', [o.id])).rows;
  if (br.length !== 1) throw new Error(`Org must have exactly one active branch (found ${br.length})`);
  const admin = (await c.query("select id from public.users where lower(email)=lower($1) and org_id=$2 and role='admin' and is_active", [adminEmail, o.id])).rows[0];
  if (!admin) throw new Error(`No active admin "${adminEmail}" in org "${slug}" (recorded_by / approver)`);
  return { orgId: o.id, branchId: br[0].id, adminId: admin.id, flags: { overlap: o.allow_staff_overlap, phone: o.require_customer_phone }, open: br[0].open_time, close: br[0].close_time };
}

const validDate = (s) => {
  const t = Date.parse(s);
  if (!s || Number.isNaN(t)) return null;
  const d = new Date(t);
  return d.getUTCFullYear() >= 1900 && d.getTime() < Date.now() ? d.toISOString().slice(0, 10) : null;
};

export async function setupImport(c, t, x, { staffGender }) {
  if (!['Male', 'Female'].includes(staffGender)) throw new Error('--staff-gender must be Male or Female');
  const r = { customers: {}, staff: {}, services: {}, products: {}, lists: { sharedMobile: [], noPhone: [], badPhone: [], blocked: [], noCategory: [], negStock: [], infStock: [], dupProduct: [], roles: [] } };
  for (const tbl of ['customers', 'services', 'therapists']) {
    const n = (await c.query(`select count(*)::int n from ${tbl} where org_id=$1`, [t.orgId])).rows[0].n;
    if (n) throw new Error(`Org not empty: ${tbl} has ${n} rows (phase B refuses a non-empty org)`);
  }
  if (t.flags.phone) throw new Error('organizations.require_customer_phone must be false for this org before importing (98 clients have no phone)');

  // ---- customers
  const rows = x.clients.rows;
  r.customers.read = rows.length + x.clients.empty; r.customers.skipped = { empty: x.clients.empty };
  const prepared = [];
  for (const row of rows) {
    const name = (row['Full Name'] || `${row['First Name']} ${row['Last Name']}`).trim();
    if (!name) { r.customers.skipped.noName = (r.customers.skipped.noName || 0) + 1; continue; }
    const ph = normalizePhone(row['Mobile Number']);
    if (ph && !ph.phone) r.lists.badPhone.push({ name, raw: ph.unparsed });
    prepared.push({ row, name, ph: ph && ph.phone ? ph : null, added: row.Added });
  }
  const byPhone = new Map();
  for (const p of prepared) if (p.ph) { if (!byPhone.has(p.ph.phone)) byPhone.set(p.ph.phone, []); byPhone.get(p.ph.phone).push(p); }
  for (const [phone, list] of byPhone) if (list.length > 1) {
    list.sort((a, b) => (Date.parse(a.added) || 0) - (Date.parse(b.added) || 0));
    list.slice(1).forEach((p) => { p.shared = true; });
    r.lists.sharedMobile.push({ phone, names: list.map((p) => p.name) });
  }
  let n = 0;
  for (const p of prepared) {
    const { row } = p;
    const id = uuid5(`${t.orgId}|client:${row['Client ID']}`);
    const blocked = /^yes$/i.test(row.Blocked);
    const tags = [...(row.Tags ? row.Tags.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : []), 'fresha-import', ...(p.shared ? ['shared-mobile'] : [])];
    const g = /^male$/i.test(row.Gender) ? 'male' : /^female$/i.test(row.Gender) ? 'female' : null;
    if (!p.ph) r.lists.noPhone.push(p.name);
    if (blocked) r.lists.blocked.push(p.name);
    await c.query(
      `insert into customers (id, branch_id, org_id, full_name, phone, additional_phone, email, gender, date_of_birth, client_source, tags, is_active, notes, country, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, coalesce($15::timestamptz, now()))`,
      [id, t.branchId, t.orgId, p.name, p.shared ? null : p.ph?.phone ?? null, p.shared ? p.ph.phone : null, row.Email || null, g, validDate(row['Date of Birth']),
        row['Referral Source'] || null, tags, !blocked, blocked ? `Blocked in Fresha: ${row['Block Reason'] || ''}`.trim() : null, p.ph?.country ?? null,
        Number.isNaN(Date.parse(row.Added)) ? null : new Date(row.Added).toISOString()]);
    n++;
  }
  r.customers.created = n;

  // ---- staff (Active only) + default weekly hours = branch hours (owner confirms real schedules)
  const active = x.team.rows.filter((m) => /^active$/i.test(m.Status));
  r.staff.read = x.team.rows.length + x.team.empty; r.staff.skipped = { empty: x.team.empty, notActive: x.team.rows.length - active.length };
  r.staff.created = 0; r.staff.ids = [];
  const open = String(t.open || '09:00').slice(0, 5), close = String(t.close || '20:00').slice(0, 5);
  for (const m of active) {
    const full = `${m['First Name']} ${m['Last Name']}`.trim();
    const ph = normalizePhone(m['Phone Number']);
    const id = uuid5(`${t.orgId}|team:${m['Team Member Id'] || full}`);
    await c.query(`insert into therapists (id, branch_id, org_id, name, gender, phone, email, position, is_service_staff, is_active, display_order)
      values ($1,$2,$3,$4,$5,$6,$7,$8,true,true,$9)`, [id, t.branchId, t.orgId, full, staffGender, ph?.phone ?? null, m.Email || null, m['Job Title'] || null, r.staff.created]);
    for (const d of WEEK) await c.query('insert into therapist_working_hours (therapist_id, branch_id, day_of_week, start_time, end_time, is_day_off) values ($1,$2,$3,$4,$5,false)', [id, t.branchId, d, open, close]);
    r.staff.ids.push(id); r.staff.created++;
    r.lists.roles.push({ name: full, fresha: m['User Permission'], zennly: { owner: 'admin', high: 'manager', basic: 'staff' }[String(m['User Permission']).trim().toLowerCase()] || 'staff' });
  }

  // ---- service categories + services (+ every active staff can do every service)
  const cats = []; for (const m of x.menu.rows) { const k = m['Category Name'] || 'Other'; if (!m['Category Name']) r.lists.noCategory.push(m['Service Name']); if (!cats.includes(k)) cats.push(k); }
  for (const [i, k] of cats.entries()) await c.query('insert into service_categories (org_id, name, display_order) values ($1,$2,$3) on conflict (org_id, name) do nothing', [t.orgId, k, i]);
  r.services.read = x.menu.rows.length + x.menu.empty; r.services.skipped = { empty: x.menu.empty }; r.services.created = 0; r.services.categories = cats.length; r.services.sumPaisa = 0;
  for (const m of x.menu.rows) {
    if (m.Tax && !/^no tax$/i.test(m.Tax)) throw new Error(`Service "${m['Service Name']}" has tax "${m.Tax}": refuse and report`);
    const dur = parseDuration(m.Duration); const price = toPaisa(m['Retail Price']);
    const id = (await c.query(`insert into services (name, duration_minutes, price_npr, description, org_id, category, bookable_online, price_type, requires_therapist)
      values ($1,$2,$3,$4,$5,$6,$7,'fixed',true) returning id`, [m['Service Name'], dur, price / 100, m.Description || null, t.orgId, m['Category Name'] || 'Other', /^enabled$/i.test(m['Online Booking'])])).rows[0].id;
    for (const th of r.staff.ids) await c.query('insert into service_therapists (service_id, therapist_id) values ($1,$2)', [id, th]);
    r.services.created++; r.services.sumPaisa += price;
  }

  // ---- products + default variant + opening stock (only for products with no movements yet)
  const seen = new Map(); r.products.read = x.products.rows.length + x.products.empty; r.products.skipped = { empty: x.products.empty }; r.products.created = 0; r.products.sumPaisa = 0; r.products.stockUnits = 0;
  const stockCol = Object.keys(x.products.rows[0] || {}).find((h) => !['Product name', 'SKU', 'Additional SKUs', 'Barcode', 'Short description', 'Description', 'Measure Type', 'Measure Value', 'Cost price', 'Full price', 'Tax rate', 'Category', 'Brand', 'Supplier', 'Total Stock'].includes(h));
  for (const p of x.products.rows) {
    let name = p['Product name'];
    const k = normName(name); if (seen.has(k)) { r.lists.dupProduct.push(name); name = `${name} (${seen.get(k) + 1})`; seen.set(k, seen.get(k) + 1); } else seen.set(k, 1);
    if (p['Full price'] === '') throw new Error(`Product "${name}" has no Full price: refuse and list`);
    const price = toPaisa(p['Full price']);
    const raw = String(p[stockCol] ?? p['Total Stock'] ?? '').trim();
    const inf = raw === '∞'; let qty = inf ? 0 : Number(raw || 0);
    if (!inf && qty < 0) { r.lists.negStock.push(name); qty = 0; }
    if (inf) r.lists.infStock.push(name);
    if (!p.Category) r.lists.noCategory.push(`product:${name}`);
    const pid = (await c.query(`insert into products (org_id, name, description, category, price_npr, track_stock, brand) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [t.orgId, name, p['Short description'] || p.Description || null, p.Category || null, price / 100, !inf, p.Brand || null])).rows[0].id;
    const vid = (await c.query(`insert into product_variants (org_id, product_id, name, retail_price) values ($1,$2,'Default',$3) returning id`, [t.orgId, pid, price / 100])).rows[0].id;
    if (!inf && qty > 0) {
      await c.query('insert into product_branch_stock (product_id, branch_id, variant_id, quantity) values ($1,$2,$3,$4)', [pid, t.branchId, vid, qty]);
      await c.query(`insert into product_stock_movements (org_id, branch_id, product_id, variant_id, delta, qty_after, reason, note, performed_by) values ($1,$2,$3,$4,$5,$5,'import_opening','Opening stock (Fresha import)',$6)`,
        [t.orgId, t.branchId, pid, vid, qty, t.adminId]);
      r.products.stockUnits += qty;
    }
    r.products.created++; r.products.sumPaisa += price;
  }
  return r;
}
