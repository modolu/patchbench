import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.ts"],
    // Fixture repos carry their own test runner; never collect them here.
    exclude: ["node_modules/**", "fixtures/**", "tests/fixtures/**", ".patchbench/**"],
    testTimeout: 20_000,
  },
});
