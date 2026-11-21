// Guard (ZNLY-332): a syntax slip in an edge function only shows up as BOOT_ERROR after deploy. Parse every function
// with esbuild (already installed with vite); remote https:// imports are never resolved, only syntax matters.
import { describe, it, expect } from 'vitest';
import { transformSync } from 'esbuild';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const files = [
  ...readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'index.ts')))
    .map((d) => join(d.name, 'index.ts')),
  ...readdirSync(join(root, '_shared')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => join('_shared', f)),
];

describe('edge functions parse', () => {
  it('finds the functions', () => expect(files.length).toBeGreaterThanOrEqual(4));
  for (const f of files) {
    it(`${f} has no syntax error`, () => {
      expect(() => transformSync(readFileSync(join(root, f), 'utf8'), { loader: 'ts', sourcefile: f, logLevel: 'silent' })).not.toThrow();
    });
  }
  it('the guard catches a duplicate declaration', () => {
    expect(() => transformSync('const a = 1;\nconst a = 2;', { loader: 'ts', logLevel: 'silent' })).toThrow();
  });
});
