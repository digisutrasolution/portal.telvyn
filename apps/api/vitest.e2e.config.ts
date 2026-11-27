import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";
import path from "node:path";

// E2E-only vitest config (Slice 13-1A.4b). Identical build to vitest.config.ts,
// but runs ONLY the e2e suite and loads the fail-closed target guard first, so
// an E2E run can never reach a shared/dev data plane. INC-DB-001B: globalSetup
// runs Gate A (pre-connection) then Gate B (post-connection identity) once,
// before any test file is collected; setupFiles re-checks both per worker.
// Run via `pnpm --filter @telvyn/api test:e2e`. Unit tests use vitest.config.ts.
export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    environment: "node",
    globals: true,
    include: ["test/**/*.e2e.test.ts"],
    globalSetup: ["./test/e2e-global-setup.ts"],
    setupFiles: ["./test/setup-e2e.ts"],
    hookTimeout: 60_000,
    testTimeout: 30_000,
    fileParallelism: false,
    // INC-DB-001B-PRE2 (N2): pinned (Vitest 3 default) — each test file runs in a
    // child process, so the worker execution fence can terminate it on lease loss.
    pool: "forks",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
