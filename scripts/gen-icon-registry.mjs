#!/usr/bin/env node
/**
 * Regenerates src/components/iconRegistry.js — the explicit allowlist of
 * lucide-react icons the app actually uses.
 *
 * Why this exists: AppIcon.jsx used to do `import * as LucideIcons from
 * 'lucide-react'` and look icons up by name at runtime. A namespace import
 * defeats tree-shaking, so all 5,293 lucide exports shipped in the entry
 * chunk — roughly 1.1 MB of the old 4.19 MB bundle, for the 165 icons the app
 * references. See docs/planning/perf-audit-2026-11-12.html, finding 03.
 *
 * How it works: scan every source file for quoted string literals that exactly
 * match a lucide export name. That deliberately over-approximates — it picks up
 * literals that were never icon names — because a false positive costs a few
 * hundred bytes while a false negative renders the HelpCircle fallback in the
 * UI. Icon names reach <Icon name={...}> indirectly (config objects, helper
 * functions, ternaries), so scanning <Icon> tags alone is not enough.
 *
 * The script fails if it finds a template-literal or concatenated icon name,
 * since that form cannot be resolved statically and an allowlist would silently
 * break it.
 *
 * Run after adding an icon:  node scripts/gen-icon-registry.mjs
 */
import * as Lucide from 'lucide-react';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

const SRC = 'src';
const OUT = 'src/components/iconRegistry.js';

const lucideExports = new Set(
  Object.keys(Lucide).filter((k) => /^[A-Z][A-Za-z0-9]*$/.test(k)),
);

function sourceFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules') sourceFiles(path, acc);
    } else if (/\.(jsx?|tsx?)$/.test(entry) && !/\.test\./.test(entry)) {
      acc.push(path);
    }
  }
  return acc;
}

const files = sourceFiles(SRC);
const used = new Set();
const computed = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');

  for (const [, literal] of src.matchAll(/['"]([A-Z][A-Za-z0-9]{1,40})['"]/g)) {
    if (lucideExports.has(literal)) used.add(literal);
  }

  for (const [, expr] of src.matchAll(/<Icon[^>]{0,200}name=\{([^}]*)\}/g)) {
    if (/[`+]/.test(expr)) {
      computed.push(`${relative('.', file)}: name={${expr.trim().slice(0, 80)}}`);
    }
  }
}

if (computed.length) {
  console.error('FAIL: icon names that cannot be resolved statically:\n');
  computed.forEach((c) => console.error(`  ${c}`));
  console.error('\nUse a literal name, or add the icon to the registry by hand.');
  process.exit(1);
}

// HelpCircle is the fallback AppIcon renders for an unknown name, so it must
// always be present even if nothing references it by name.
used.add('HelpCircle');

const names = [...used].sort();

const body = `// GENERATED FILE — do not edit by hand.
// Regenerate with: node scripts/gen-icon-registry.mjs
//
// Explicit allowlist of the lucide-react icons this app uses, so the bundler can
// tree-shake the other ${(lucideExports.size - names.length).toLocaleString()} exports away. See the script header for why.
//
// ${names.length} icons of ${lucideExports.size.toLocaleString()} lucide exports.
import {
${names.map((n) => `  ${n},`).join('\n')}
} from 'lucide-react';

const iconRegistry = {
${names.map((n) => `  ${n},`).join('\n')}
};

export default iconRegistry;
`;

writeFileSync(OUT, body);
console.log(`Wrote ${OUT} — ${names.length} icons (of ${lucideExports.size} lucide exports).`);
