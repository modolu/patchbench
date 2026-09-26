import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Production server on its own port (run `pnpm build` first) so a developer's
  // `next dev` on :3000 is never disturbed. Showcase mode renders the committed
  // captured run and disables execution; never spends Bobcoins.
  webServer: {
    command: `pnpm exec next start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/new`,
    reuseExistingServer: false,
    env: { PATCHBENCH_MODE: "showcase", PATCHBENCH_BOB_ADAPTER: "fake" },
  },
});
