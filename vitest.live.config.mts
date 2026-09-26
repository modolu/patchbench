import path from "node:path";
import { defineConfig } from "vitest/config";

/** Live IBM Bob checks only. Never part of `pnpm test`; gated again by PATCHBENCH_LIVE_BOB=1. */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/live/**/*.live.test.ts"],
    testTimeout: 0,
  },
});
