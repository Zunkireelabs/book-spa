import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  build: {
    outDir: "build",
    chunkSizeWarningLimit: 2000,
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