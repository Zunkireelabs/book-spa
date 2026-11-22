// Minimal RFC-4180 CSV parser: quoted fields, embedded newlines/quotes, BOM, CRLF.
// Blank rows are returned as rows whose every cell is '' (caller counts them as "skipped: empty").
export function parseCsv(text) {
  const src = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = ''; rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Returns { headers, rows: [{...}], empty } ; `empty` = count of fully blank rows dropped.
export function readTable(text) {
  const all = parseCsv(text);
  const headers = (all.shift() || []).map((h) => h.trim());
  const out = []; let empty = 0;
  for (const r of all) {
    if (r.every((c) => c.trim() === '')) { empty++; continue; }
    const o = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    out.push(o);
  }
  return { headers, rows: out, empty };
}
