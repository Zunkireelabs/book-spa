// CSV of the table a report is showing (ZNLY-159 frame "Export"). Pure builder + a browser download helper.
const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** rows: array of arrays (first row = headers). */
export const toCsv = (rows) => rows.map((r) => r.map(cell).join(',')).join('\r\n');

export function downloadCsv(filename, rows) {
  const blob = new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
