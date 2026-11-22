import fs from 'node:fs';
import path from 'node:path';
import { readTable } from './csv.js';

// Reads every .csv under <dir>/<sub>/ (several files per sub are concatenated, e.g. past + future appointments).
export function loadExport(dir) {
  const rd = (sub) => {
    const d = path.join(dir, sub);
    const files = fs.readdirSync(d).filter((f) => f.endsWith('.csv')).sort();
    if (!files.length) throw new Error(`No CSV in ${d}`);
    let rows = [], empty = 0;
    for (const f of files) { const t = readTable(fs.readFileSync(path.join(d, f), 'utf8')); rows = rows.concat(t.rows); empty += t.empty; }
    return { rows, empty, files };
  };
  return { clients: rd('Clients'), team: rd('Team members'), menu: rd('Service Menu'), products: rd('Products'),
    appts: rd('Appointments'), sales: rd('Sales'), payments: rd('Payments') };
}
