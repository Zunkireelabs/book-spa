import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
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
  plugins: [tsconfigPaths(), react()],
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