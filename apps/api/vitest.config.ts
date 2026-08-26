import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
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
