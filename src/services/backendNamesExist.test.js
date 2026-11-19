// ZNLY-268 regression guard. A frontend call to an RPC or table that no migration creates fails on a real database
// with a raw "Could not find the function/table ... in the schema cache" error (Transfer Report, 2026-06-13).
// Every supabase.rpc('x') and supabase.from('x') in src must be created by a file under supabase/.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');

const walk = (dir, accept) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  if (d.isDirectory()) return d.name === 'node_modules' ? [] : walk(p, accept);
  return accept(p) ? [p] : [];
});

const sqlText = walk(path.join(root, 'supabase'), (p) => p.endsWith('.sql')).map((p) => fs.readFileSync(p, 'utf8')).join('\n');

const srcFiles = walk(path.join(root, 'src'), (p) => /\.(js|jsx)$/.test(p) && !/\.(test|smoke\.test)\.(js|jsx)$/.test(p));

const used = (re) => {
  const hits = new Map();
  for (const f of srcFiles) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(re)) {
      // storage buckets use .storage.from('bucket'); they are not tables
      const before = text.slice(Math.max(0, m.index - 30), m.index);
      if (/storage\s*$/.test(before)) continue;
      if (!hits.has(m[1])) hits.set(m[1], path.relative(root, f));
    }
  }
  return hits;
};

const ident = (n) => new RegExp(`(?:FUNCTION|TABLE|VIEW|MATERIALIZED VIEW)(?:\\s+IF NOT EXISTS)?\\s+(?:public\\.)?"?${n}"?\\s*[\\s(;]`, 'i');

describe('frontend only calls backend objects that migrations create', () => {
  it('every supabase.rpc(name) exists as a SQL function', () => {
    const missing = [...used(/\.rpc\(\s*['"]([a-z0-9_]+)['"]/g)].filter(([n]) => !ident(n).test(sqlText)).map(([n, f]) => `${n} (${f})`);
    expect(missing, `RPCs with no migration: ${missing.join(', ')}`).toEqual([]);
  });

  it('every supabase.from(name) exists as a table or view', () => {
    const missing = [...used(/\.from\(\s*['"]([a-z0-9_]+)['"]/g)].filter(([n]) => !ident(n).test(sqlText)).map(([n, f]) => `${n} (${f})`);
    expect(missing, `tables with no migration: ${missing.join(', ')}`).toEqual([]);
  });

  it('actually finds the calls (parser sanity)', () => {
    expect(used(/\.rpc\(\s*['"]([a-z0-9_]+)['"]/g).size).toBeGreaterThan(50);
    expect(used(/\.from\(\s*['"]([a-z0-9_]+)['"]/g).size).toBeGreaterThan(40);
  });
});
