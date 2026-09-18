import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["integration/**/*.test.ts"],
    hookTimeout: 90_000,
    testTimeout: 45_000,
    fileParallelism: false,
  },
});
