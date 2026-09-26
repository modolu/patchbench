import path from "node:path";
import { defineConfig } from "vitest/config";

/** Showcase capture only (`pnpm showcase:capture`). Never part of `pnpm test`. */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/showcase/**/*.capture.ts"],
    testTimeout: 0,
  },
});
