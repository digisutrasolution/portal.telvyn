import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";
import path from "node:path";

export default defineConfig({
  // SWC compiles the TS with decorator metadata (design:paramtypes) so NestJS
  // dependency injection resolves — esbuild (vitest's default) does not emit it.
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
    // INC-DB-001B: the DEFAULT lane is unit-only. E2E runs exclusively through
    // vitest.e2e.config.ts (two-stage target guard). Never re-add e2e here.
    include: ["src/**/*.test.ts", "test/**/*.unit.test.ts"],
    exclude: ["**/node_modules/**", "**/*.e2e.test.ts"],
    setupFiles: ["./test/setup-unit.ts"],
    hookTimeout: 60_000,
    testTimeout: 30_000,
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
