// LOCAL: derives an "earlier" export from a full one so the delta can be rehearsed: drops 40 clients, 5 products, appointments from 20 Nov on;
// sets 3 products' stock differently and 3 appointments to "Booked". Usage: node make-old-export.mjs <full-dir> <out-dir>
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../lib/csv.js';
const [, , src, dst] = process.argv;
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
for (const sub of fs.readdirSync(src).filter((n) => fs.statSync(path.join(src, n)).isDirectory())) {
  fs.mkdirSync(path.join(dst, sub), { recursive: true });
  for (const f of fs.readdirSync(path.join(src, sub)).filter((n) => n.endsWith('.csv'))) {
    const rows = parseCsv(fs.readFileSync(path.join(src, sub, f), 'utf8')); const head = rows.shift(); const ix = (n) => head.indexOf(n);
    let out = rows;
    if (sub === 'Clients') out = rows.slice(0, rows.length - 40);
    if (sub === 'Products') {
      const sc = head.findIndex((h) => h === "Sami's brow and lashes");
      out = rows.slice(0, rows.length - 5).map((r, i) => (i < 3 && /^\d+$/.test(r[sc]) ? r.map((v, k) => (k === sc || head[k] === 'Total Stock' ? String(Number(v) + 7) : v)) : r));
    }
    if (sub === 'Appointments') {
      let n = 0;
      out = rows.filter((r) => !(r[ix('Scheduled Date')] >= '2026-11-20')).map((r) => (n < 3 && /canceled/i.test(r[ix('Status')]) ? (n++, r.map((v, k) => (k === ix('Status') ? 'Booked' : v))) : r));
    }
    fs.writeFileSync(path.join(dst, sub, f), [head, ...out].map((r) => r.map(q).join(',')).join('\n') + '\n');
  }
}
