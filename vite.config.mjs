import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// Where this app is mounted. Defaults to the root, which is how it has always been served at
// app.zennly.io. Set VITE_BASE_PATH (e.g. "/book/") to serve it under a path prefix instead —
// used when the marketplace proxies the customer booking flow through its own origin, so the
// customer never sees the host change mid-journey. Must match BrowserRouter's basename in
// src/Routes.jsx, which reads the same variable.
const BASE_PATH = process.env.VITE_BASE_PATH || "/";
const NORMALIZED_BASE = BASE_PATH.replace(/\/+$/, ""); // "/book/" -> "/book"; "/" -> ""

// Dev convenience only, for exactly one scenario: running a single local instance under a
// base path (VITE_BASE_PATH=/book/) where the developer's mental model is still "book-spa
// lives at its own root" — localhost:4028/nuad-thai-spa/login is the URL they type, but the
// app now only answers under /book/nuad-thai-spa/login. 302s the former to the latter,
// preserving the query string (the marketplace handoff's ?source=zennly&handoff_id=...&
// service=... would otherwise be silently dropped) so both shapes work.
//
// A plain middleware function, registered via configureServer — that hook is a build-time
// no-op in Vite (never called during `vite build`), so this cannot ship or affect
// production regardless of how it's wired here; no separate guard needed for that half.
// The NORMALIZED_BASE-no-op guard below handles the OTHER half: when no base path is
// configured, this must change nothing, not just redirect-to-the-same-place.
//
// Deliberately 302, not 301: a 301 is cache-and-forget in the browser, so it would keep
// firing even after a future restart with the base path unset again, producing a 404 loop
// that outlives the server that caused it.
function redirectUnprefixedToBasePathPlugin() {
  if (!NORMALIZED_BASE) return null; // base is "/" -> no middleware registered at all

  // Paths Vite itself owns. Redirecting these breaks HMR/module loading in ways that look
  // like random failures rather than a 404 — enumerated deliberately rather than inverting
  // the base-path check, since "doesn't start with /book" is not the same claim as "is safe
  // to redirect".
  const VITE_OWNED_PREFIXES = ["/@vite", "/@fs", "/@id", "/@react-refresh", "/node_modules", "/__vite"];

  return {
    name: "redirect-unprefixed-to-base-path",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Never touch a WebSocket upgrade (Vite's HMR client) — a redirect response makes
        // no sense for an upgrade request, and this must stay a complete no-op for it.
        if (req.headers.upgrade) return next();

        const url = req.url || "";
        const pathOnly = url.split("?")[0];

        if (pathOnly === NORMALIZED_BASE || pathOnly.startsWith(`${NORMALIZED_BASE}/`)) return next();
        if (VITE_OWNED_PREFIXES.some((p) => pathOnly === p || pathOnly.startsWith(`${p}/`))) return next();

        res.statusCode = 302;
        res.setHeader("Location", `${NORMALIZED_BASE}${url}`);
        res.end();
      });
    },
  };
}

export default defineConfig({
  base: BASE_PATH,
  build: {
    outDir: "build",
    // Lowered from 2000 deliberately. The old limit was set high enough to
    // silence the "chunk is larger than..." warning rather than answer it,
    // which is how the app shipped as a single 4.19 MB bundle. Keep this at a
    // value that will actually complain if route splitting regresses.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Heavy libraries used by only one or two routes. Splitting them out
        // keeps them off the critical path for the public booking flow, which
        // is the page most customers land on and the one most likely to be
        // opened on a phone over mobile data.
        //
        // Deliberately the function form, not the `{name: [packages]}` object
        // form. The object form assigns the named package's entry module to the
        // chunk but leaves its shared transitive deps (tslib and friends) to be
        // placed wherever rollup likes — which landed a helper the entry needs
        // inside vendor-dnd, making the whole 180 kB drag-and-drop chunk a
        // modulepreload on first paint. Matching on the resolved module path
        // keeps each vendor chunk to that package's own files.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          // Calendar — manager dashboard only.
          if (id.includes('@fullcalendar')) return 'vendor-calendar';
          // Drag-and-drop — calendar and roster panels only.
          if (id.includes('@dnd-kit')) return 'vendor-dnd';
          // Charts — reports panels only. d3-* are recharts' own dependencies.
          if (id.includes('/recharts/') || id.includes('/victory-vendor/') || /node_modules\/d3-/.test(id)) {
            return 'vendor-charts';
          }
          // Spreadsheet export — a handful of report "Export" buttons.
          if (id.includes('/xlsx/')) return 'vendor-xlsx';
          // Shared by every route; split so they cache independently of app code.
          if (id.includes('/@supabase/')) return 'vendor-supabase';
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) {
            return 'vendor-react';
          }
        },
      },
    },
  },
  plugins: [tsconfigPaths(), react(), redirectUnprefixedToBasePathPlugin()].filter(Boolean),
  test: {
    // Nested git worktrees under .claude/worktrees/ carry their own src/ trees;
    // vitest's default include glob has no awareness of them and sweeps every
    // worktree's test files into a `vitest run` from the repo root, silently
    // inflating file/test counts (and runtime) with other branches' tests
    // rather than this checkout's own.
    exclude: ['**/node_modules/**', '**/.claude/worktrees/**'],
  },
  server: {
    port: 4028,
    host: "0.0.0.0",
    strictPort: true,
    allowedHosts: ['dev-app.zennly.io', 'app.zennly.io', 'dev-zenly.zunkireelabs.com', 'zenly.zunkireelabs.com'],
  },
});