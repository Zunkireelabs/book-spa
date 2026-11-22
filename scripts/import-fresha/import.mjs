#!/usr/bin/env node
// Fresha -> Zennly importer (ZNLY-391). Reads the Fresha CSV export from --export, never writes client data anywhere but the DB
// and the reports in --out (default temp_ss/client-data, gitignored). Refuses a non-local DB unless --allow-remote.
//   node scripts/import-fresha/import.mjs --export <dir> --org samis --admin-email a@b.c --staff-gender Female \
//        --db postgresql://... --phase setup|history|all [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadExport } from './lib/load.js';
import { buildPlan } from './lib/plan.js';
import { getTarget, setupImport } from './lib/setup.js';
import { customersDelta, productsDelta } from './lib/delta.js';
import { historyImport } from './lib/history.js';
import { ownerSheet } from './lib/ownersheet.js';

const a = {}; for (let i = 2; i < process.argv.length; i++) { const k = process.argv[i]; if (k.startsWith('--')) a[k.slice(2)] = process.argv[i + 1]?.startsWith('--') || i + 1 >= process.argv.length ? true : process.argv[++i]; }
for (const k of ['export', 'org', 'admin-email', 'db']) if (!a[k]) { console.error(`Missing --${k}`); process.exit(2); }
const phase = a.phase || 'all', dry = !!a['dry-run'];
const host = new URL(a.db).hostname;
if (!['127.0.0.1', 'localhost'].includes(host) && !a['allow-remote']) { console.error(`Refusing non-local DB host "${host}" (needs --allow-remote and the owner's GO)`); process.exit(2); }
const out = a.out || path.resolve('temp_ss/client-data'); fs.mkdirSync(out, { recursive: true });
const today = a.today || new Date(Date.now() + 5.75 * 3600e3).toISOString().slice(0, 10);

const x = loadExport(a.export);

const modeMap = {};
if (a['mode-map'] && a['mode-map'] !== true) for (const pair of a['mode-map'].split(',')) {
  const [from, to] = pair.split('=').map((s) => s.trim());
  if (!from || !to) { console.error(`Bad --mode-map entry "${pair}" (use From=To,From2=To2)`); process.exit(2); }
  if (from === 'Cash' && to !== 'Cash') { console.error('Cash must stay exactly "Cash" (cash-drawer logic)'); process.exit(2); }
  modeMap[from] = to;
}
const c = new pg.Client({ connectionString: a.db }); await c.connect();
const orgRow = (await c.query('select id from organizations where slug=$1', [a.org])).rows[0];
if (!orgRow) { console.error(`Org "${a.org}" not found`); process.exit(1); }
// ids are scoped to the org (uuid5 of org id + Fresha key) so the same export can be rehearsed into several orgs of one database
const plan = buildPlan({ clients: x.clients.rows, team: x.team.rows, menu: x.menu.rows, appts: x.appts.rows, sales: x.sales.rows, payments: x.payments.rows, today, ns: orgRow.id });
if (plan.report.unknownStaff.length) { console.error(`Unknown staff in appointments: ${[...new Set(plan.report.unknownStaff)].join(', ')} (abort, not skip)`); process.exit(1); }
const result = { phase, dry, today };
try {
  await c.query('begin');
  const t = await getTarget(c, a.org, a['admin-email']);
  t.ackTriggers = a['ack-triggers'] && a['ack-triggers'] !== true ? a['ack-triggers'].split(',') : [];
  t.modeMap = modeMap;
  if (phase === 'setup' || phase === 'all') result.setup = await setupImport(c, t, x, { staffGender: a['staff-gender'] });
  if (phase === 'customers-delta' || phase === 'delta') result.customersDelta = await customersDelta(c, t, x);
  if (phase === 'products-delta' || phase === 'delta') result.productsDelta = await productsDelta(c, t, x);
  if (phase === 'history' || phase === 'all' || phase === 'delta') result.history = await historyImport(c, t, plan);
  result.appMethods = (await c.query("select settings->'paymentMethods' as m from organizations where id=$1", [t.orgId])).rows[0].m;
  await c.query(dry ? 'rollback' : 'commit');
} catch (e) { await c.query('rollback').catch(() => {}); console.error('FAILED, nothing written:', e.message); process.exit(1); }
await c.end();
const file = path.join(out, `import-${a.org}-${phase}${dry ? '-dry' : ''}-${Date.now()}.json`);
const slim = JSON.parse(JSON.stringify({ result, plan: { lines: plan.lines.length, groups: plan.groups.length, report: plan.report } }));
fs.writeFileSync(file, JSON.stringify({ ...slim, invoices: plan.invoices.map((i) => ({ no: i.no, status: i.status, gross: i.gross, tips: i.tips, paid: i.paid, attached: i.attached, discount: i.discount })) }, null, 1));
if (result.customersDelta) console.log('customers-delta:', JSON.stringify({ read: result.customersDelta.read, existing: result.customersDelta.existing, created: result.customersDelta.created, shared: result.customersDelta.sharedMobile.length, noPhone: result.customersDelta.noPhone.length }));
if (result.productsDelta) { const d = result.productsDelta; console.log('products-delta:', JSON.stringify({ read: d.read, created: d.created, stockChanged: d.stockChanged.length, unchanged: d.unchanged, priceDiffers: d.priceDiffers.length })); }
if (result.history) { const sheet = path.join(out, `owner-review-${a.org}.md`); fs.writeFileSync(sheet, ownerSheet({ plan, setup: result.setup, history: result.history, customersDelta: result.customersDelta, productsDelta: result.productsDelta, x, appMethods: result.appMethods, modeMap })); console.log('owner sheet:', sheet); }
console.log(`${dry ? 'DRY-RUN (rolled back)' : 'COMMITTED'} phase=${phase}; report: ${file}`);
if (result.setup) { const s = result.setup; console.log('B:', JSON.stringify({ customers: [s.customers.read, s.customers.created, s.customers.skipped], staff: [s.staff.read, s.staff.created, s.staff.skipped], services: [s.services.read, s.services.created], products: [s.products.read, s.products.created] })); }
if (result.history) { const h = result.history; console.log('C:', JSON.stringify({ inserted: h.inserted, existing: h.existing, changed: h.changed.length, failedFuture: h.failedFuture, payments: h.payments, tips: h.tips, notImported: h.notImported.length, orphan: h.orphanPayments.length, verified: h.verified, lockMs: h.lockMs })); console.log('RECON:', JSON.stringify(h.reconciliation)); }
