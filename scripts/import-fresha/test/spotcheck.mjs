// LOCAL spot-check of an imported org against the CSV: random 10 customers / 3 staff / 10 services / 10 products, 3 busiest days,
// 5 invoices (discount, part paid, tip + plain). Usage: node spotcheck.mjs <export-dir> <db-url> <org-slug>
import pg from 'pg';
import { loadExport } from '../lib/load.js';
import { buildPlan } from '../lib/plan.js';
import { normalizePhone, toPaisa, parseDuration } from '../lib/parse.js';
const [, , dir, url, slug] = process.argv;
const x = loadExport(dir); const c = new pg.Client({ connectionString: url }); await c.connect();
const oid = (await c.query('select id from organizations where slug=$1', [slug])).rows[0].id;
const plan = buildPlan({ clients: x.clients.rows, team: x.team.rows, menu: x.menu.rows, appts: x.appts.rows, sales: x.sales.rows, payments: x.payments.rows, today: '2026-11-22', ns: oid });
const pick = (a, n) => [...a].sort(() => Math.random() - 0.5).slice(0, n);
let bad = 0; const fail = (m) => { bad++; console.log('MISMATCH', m); };
const q = async (s, p) => (await c.query(s, p)).rows;
for (const r of pick(x.clients.rows, 10)) {
  const name = r['Full Name'].trim(); const ph = normalizePhone(r['Mobile Number']);
  const rows = await q('select phone, additional_phone, email from customers where org_id=$1 and full_name=$2', [oid, name]);
  const ok = rows.some((d) => (ph?.phone ? d.phone === ph.phone || d.additional_phone === ph.phone : d.phone === null) && (d.email || '') === (r.Email || ''));
  if (!ok) fail(`customer ${name}`);
}
for (const r of x.team.rows.filter((m) => m.Status === 'Active').slice(0, 3)) {
  const d = (await q("select count(*)::int n from therapists where org_id=$1 and name=$2 and gender='Female' and is_active", [oid, `${r['First Name']} ${r['Last Name']}`.trim()]))[0];
  if (d.n !== 1) fail(`staff ${r['First Name']}`);
}
for (const m of pick(x.menu.rows, 10)) {
  const d = (await q('select price_npr::numeric p, duration_minutes d from services where org_id=$1 and name=$2', [oid, m['Service Name']]))[0];
  if (!d || Math.round(d.p * 100) !== toPaisa(m['Retail Price']) || d.d !== parseDuration(m.Duration)) fail(`service ${m['Service Name']}`);
}
const stockCol = Object.keys(x.products.rows[0]).find((h) => !['Product name', 'SKU', 'Additional SKUs', 'Barcode', 'Short description', 'Description', 'Measure Type', 'Measure Value', 'Cost price', 'Full price', 'Tax rate', 'Category', 'Brand', 'Supplier', 'Total Stock'].includes(h));
for (const p of pick(x.products.rows, 10)) {
  const d = (await q(`select p.price_npr::numeric pr, coalesce((select sum(quantity) from product_branch_stock s where s.product_id=p.id),0)::int q from products p where p.org_id=$1 and p.name like $2||'%' order by length(p.name) limit 1`, [oid, p['Product name']]))[0];
  const raw = String(p[stockCol]).trim(); const want = raw === '∞' ? 0 : Math.max(0, Number(raw || 0));
  if (!d || Math.round(d.pr * 100) !== toPaisa(p['Full price']) || d.q !== want) fail(`product ${p['Product name']} (db ${d?.q}/csv ${want})`);
}
const perDay = {}; for (const l of plan.lines) perDay[l.date] = (perDay[l.date] || 0) + 1;
for (const [day, n] of Object.entries(perDay).sort((a, b) => b[1] - a[1]).slice(0, 3)) {
  const d = (await q('select count(*)::int n from bookings b join branches r on r.id=b.branch_id where r.org_id=$1 and b.date=$2', [oid, day]))[0].n;
  console.log(`busy day ${day}: csv ${n} db ${d}`); if (d !== n) fail(`day ${day}`);
}
const att = plan.invoices.filter((i) => i.attached && i.status !== 'Voided');
const cases = [att.find((i) => i.discount?.clean), att.find((i) => i.status === 'Part Paid'), att.find((i) => i.tips > 0), ...pick(att.filter((i) => !i.discount && i.tips === 0 && i.status === 'Paid'), 2)];
for (const i of cases.filter(Boolean)) {
  const d = (await q(`select coalesce(sum(p.amount),0)::numeric s from payments p join bookings b on b.id=p.booking_id join branches r on r.id=b.branch_id where r.org_id=$2 and p.notes like $1`, [`Fresha pay % inv ${i.no} appt %`, oid]))[0].s;
  const tips = (await q(`select coalesce(sum(t.amount),0)::numeric s from booking_tips t join bookings b on b.id=t.booking_id join branches r on r.id=b.branch_id where r.org_id=$2 and t.notes=$1`, [`Fresha tip inv ${i.no}`, oid]))[0].s;
  const dc = (await q(`select coalesce(sum(b.discount_amount),0)::numeric s from bookings b where b.client_request_id = any($1)`, [i.lines.map((l) => l.requestId)]))[0].s;
  const wantPay = Math.min(i.paid - i.tips, i.lines.reduce((a, l) => a + l.price - l.discount, 0));
  const ok = Math.round(d * 100) === wantPay && Math.round(tips * 100) === i.tips && Math.round(dc * 100) === (i.discount?.discountPaisa || 0);
  console.log(`invoice ${i.no} ${i.status}: pay ${d}/${wantPay / 100} tip ${tips}/${i.tips / 100} discount ${dc}/${(i.discount?.discountPaisa || 0) / 100} ${ok ? 'ok' : 'BAD'}`); if (!ok) fail(`invoice ${i.no}`);
}
const rep = (await q(`select coalesce(sum(b.final_amount),0)::numeric s, count(*)::int n from bookings b join branches r on r.id=b.branch_id where r.org_id=$1 and b.status='Completed' and b.date between '2026-11-01' and '2026-11-22'`, [oid]))[0];
const csvDone = plan.lines.filter((l) => l.status === 'Completed').reduce((a, l) => a + l.price - l.discount, 0);
console.log(`Nov Completed revenue: db ${rep.s} (${rep.n}) csv ${csvDone / 100}`); if (Math.round(rep.s * 100) !== csvDone) fail('Nov revenue');
console.log(bad ? `${bad} MISMATCHES` : 'ALL SPOT CHECKS OK'); await c.end(); process.exit(bad ? 1 : 0);
