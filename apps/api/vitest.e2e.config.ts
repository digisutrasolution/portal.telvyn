import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";
import path from "node:path";

// E2E-only vitest config (Slice 13-1A.4b). Identical build to vitest.config.ts,
// but runs ONLY the e2e suite and loads the fail-closed target guard first, so
// an E2E run can never reach a shared/dev data plane. Unit tests continue to use
// vitest.config.ts (`vitest run src`).
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
    setupFiles: ["./test/setup-e2e.ts"],
    hookTimeout: 60_000,
    testTimeout: 30_000,
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
