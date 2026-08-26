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
    include: ["src/**/*.test.ts", "test/**/*.e2e.test.ts"],
    hookTimeout: 60_000,
    testTimeout: 30_000,
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
