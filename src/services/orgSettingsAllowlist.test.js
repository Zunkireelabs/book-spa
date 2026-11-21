// ZNLY-267 regression guard. Every migration that redefines public.update_org_profile_settings replaces the WHOLE
// allowlist, and 328/329/332 once dropped calendar keys added by 286/298. This test reads the keys the UI writes and
// asserts each one is in the LATEST migration that defines the function.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function latestAllowlist() {
  const dir = path.join(root, 'supabase');
  const files = fs.readdirSync(dir)
    .filter((f) => /^migration-(\d+)-.*\.sql$/.test(f))
    .map((f) => ({ f, n: Number(f.match(/^migration-(\d+)-/)[1]) }))
    .sort((a, b) => a.n - b.n);
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = fs.readFileSync(path.join(dir, files[i].f), 'utf8');
    if (!/CREATE OR REPLACE FUNCTION public\.update_org_profile_settings/.test(sql)) continue;
    const m = sql.match(/p_key NOT IN \(([\s\S]*?)\)\s*THEN/);
    if (!m) continue;
    return { file: files[i].f, keys: new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])) };
  }
  throw new Error('no migration defines update_org_profile_settings');
}

const MASTER = 'src/pages/branch-manager-dashboard/components/MasterData/';
function uiKeys() {
  const keys = new Set();
  const add = (re, text) => { for (const m of text.matchAll(re)) keys.add(m[1]); };
  add(/\bsave\(\s*'([a-z_]+)'/g, read(`${MASTER}CalendarSettingsPanel.jsx`));
  const profile = read(`${MASTER}ProviderProfilePanel.jsx`);
  add(/saveSetting\(\s*'([a-z_]+)'/g, profile);
  add(/\{\s*key:\s*'([a-z_]+)'/g, profile);
  add(/\[\s*'(billing_[a-z_]+)'/g, read(`${MASTER}BillingSettingsPanel.jsx`));
  const api = read('src/services/api.js');
  const bk = api.match(/BILLING_SETTING_KEYS\s*=\s*\[([\s\S]*?)\]/);
  if (bk) add(/'([a-z_]+)'/g, bk[1]);
  return keys;
}

describe('update_org_profile_settings allowlist', () => {
  const { file, keys } = latestAllowlist();
  const ui = uiKeys();

  it('finds the keys the UI writes', () => {
    for (const k of ['calendar_start_time', 'calendar_end_time', 'calendar_interval_minutes', 'calendar_show_full_day', 'cancellation_reasons', 'about', 'billing_enabled']) {
      expect(ui.has(k), `parser lost ${k}`).toBe(true);
    }
  });

  it(`every key the UI writes is allowed by the latest definition (${file})`, () => {
    const missing = [...ui].filter((k) => !keys.has(k));
    expect(missing, `missing from ${file}: ${missing.join(', ')}`).toEqual([]);
  });

  it('never loses a key an earlier migration allowed', () => {
    const dir = path.join(root, 'supabase');
    const earlier = new Set();
    for (const f of fs.readdirSync(dir).filter((x) => /^migration-\d+-.*\.sql$/.test(x))) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      if (!/CREATE OR REPLACE FUNCTION public\.update_org_profile_settings/.test(sql)) continue;
      const m = sql.match(/p_key NOT IN \(([\s\S]*?)\)\s*THEN/);
      if (m) for (const x of m[1].matchAll(/'([a-z_]+)'/g)) earlier.add(x[1]);
    }
    expect([...earlier].filter((k) => !keys.has(k))).toEqual([]);
  });
});

// ZNLY-268: same guard for update_org_booking_settings (BookingSettingsPanel toggles).
describe('update_org_booking_settings allowlist', () => {
  it('every toggle key the panel sends is allowed by the latest definition', () => {
    const dir = path.join(root, 'supabase');
    const files = fs.readdirSync(dir).filter((f) => /^migration-(\d+)-.*\.sql$/.test(f))
      .sort((a, b) => Number(a.match(/-(\d+)-/)[1]) - Number(b.match(/-(\d+)-/)[1]));
    let allowed = null;
    for (let i = files.length - 1; i >= 0 && !allowed; i--) {
      const sql = fs.readFileSync(path.join(dir, files[i]), 'utf8');
      if (!/FUNCTION public\.update_org_booking_settings/i.test(sql)) continue;
      const m = sql.match(/p_key NOT IN \(([\s\S]*?)\)\s*THEN/);
      if (m) allowed = new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
    }
    expect(allowed, 'no migration defines update_org_booking_settings').not.toBeNull();
    const panel = read(`${MASTER}BookingSettingsPanel.jsx`);
    const ui = [...panel.matchAll(/^\s*key:\s*'([a-z_]+)'/gm)].map((x) => x[1]);
    expect(ui.length).toBeGreaterThan(0);
    expect(ui.filter((k) => !allowed.has(k))).toEqual([]);
  });
});
