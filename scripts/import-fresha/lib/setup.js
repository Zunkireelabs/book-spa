// Phase B: customers, staff (+ default hours), services, products + opening stock. One transaction (caller owns it).
import { normalizePhone, parseDuration, toPaisa, uuid5 } from './parse.js';
import { prepareCustomers, insertCustomer, prepareProducts, insertProduct } from './delta.js';

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

export async function setupImport(c, t, x, { staffGender }) {
  if (!['Male', 'Female'].includes(staffGender)) throw new Error('--staff-gender must be Male or Female');
  const r = { customers: {}, staff: {}, services: {}, products: {}, lists: { sharedMobile: [], noPhone: [], badPhone: [], blocked: [], noCategory: [], negStock: [], infStock: [], dupProduct: [], roles: [] } };
  for (const tbl of ['customers', 'services', 'therapists']) {
    const n = (await c.query(`select count(*)::int n from ${tbl} where org_id=$1`, [t.orgId])).rows[0].n;
    if (n) throw new Error(`Org not empty: ${tbl} has ${n} rows (phase B refuses a non-empty org)`);
  }
  if (t.flags.phone) throw new Error('organizations.require_customer_phone must be false for this org before importing (98 clients have no phone)');

  // ---- customers
  const prep = prepareCustomers(x.clients.rows, { ns: t.orgId });
  r.customers.read = x.clients.rows.length + x.clients.empty; r.customers.skipped = { empty: x.clients.empty };
  if (prep.noName) r.customers.skipped.noName = prep.noName;
  r.lists.badPhone.push(...prep.badPhone); r.lists.sharedMobile.push(...prep.sharedMobile); r.lists.noPhone.push(...prep.noPhone); r.lists.blocked.push(...prep.blocked);
  for (const p of prep.items) await insertCustomer(c, t, p);
  r.customers.created = prep.items.length;

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

  // ---- products + default variant + opening stock
  const pp = prepareProducts(x.products.rows);
  r.products.read = x.products.rows.length + x.products.empty; r.products.skipped = { empty: x.products.empty }; r.products.created = 0; r.products.sumPaisa = 0; r.products.stockUnits = 0;
  r.lists.dupProduct.push(...pp.dup); r.lists.negStock.push(...pp.neg); r.lists.infStock.push(...pp.inf); r.lists.noCategory.push(...pp.noCategory);
  for (const it of pp.items) {
    await insertProduct(c, t, it);
    r.products.created++; r.products.sumPaisa += it.price; r.products.stockUnits += it.inf ? 0 : it.qty;
  }
  return r;
}
