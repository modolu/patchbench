import { readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const RUN_ID = readdirSync(path.join(process.cwd(), "showcase", "runs"))[0]!;

test("new benchmark screen is honest in showcase mode", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.getByRole("heading", { level: 1, name: "New benchmark" })).toBeVisible();
  await expect(page.getByLabel(/Repository path/)).toBeDisabled();
  await expect(page.getByTestId("start-benchmark")).toBeDisabled();
  await expect(page.getByText("Execution is disabled in showcase mode.")).toBeVisible();
  await expect(page.getByText(/never uploaded/)).toHaveCount(0);
  await expect(page.getByTestId("recent-runs").getByRole("link")).toHaveCount(1);
});

test("live bench renders the persisted completed run", async ({ page }) => {
  await page.goto("/new");
  await page.getByTestId("recent-runs").getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/runs/${RUN_ID}/evidence$`));
  await page.getByRole("link", { name: "Live bench" }).click();
  await expect(page.getByTestId("run-status")).toHaveText(/COMPLETE/);
  await expect(page.getByTestId("reproduction-proof")).toContainText("REPRODUCED");
  await expect(page.getByTestId("baseline-strip")).toContainText("recorded, not blocking");
  await expect(page.getByTestId("candidate-status-a")).toHaveText(/ELIGIBLE/);
  await expect(page.getByTestId("candidate-status-b")).toHaveText(/REJECTED/);
  await expect(page.getByTestId("candidate-status-c")).toHaveText(/ELIGIBLE/);
  await expect(page.getByTestId("pipeline-timeline").locator("li[data-state=done]")).toHaveCount(7);
  await expect(page.locator("body")).not.toContainText("/Users/");

  const logs = page.getByTestId("log-viewer");
  await logs.getByRole("tab", { name: /candidate-b/ }).click();
  await expect(logs.getByRole("tab", { name: "test (failed)" })).toHaveAttribute("aria-selected", "true");
  await expect(logs.getByRole("log")).toContainText("not ok");
});

test("evidence matrix: why rejected exposes B's two new failures; selection drives the detail pane", async ({ page }) => {
  await page.goto(`/runs/${RUN_ID}/evidence`);
  await expect(page.getByTestId("verdict-a")).toHaveText(/ELIGIBLE/);
  await expect(page.getByTestId("verdict-b")).toHaveText(/REJECTED/);
  await expect(page.getByTestId("verdict-c")).toHaveText(/ELIGIBLE/);
  await expect(page.getByTestId("evidence-summary")).toContainText("Candidate B was rejected automatically");
  await expect(page.getByTestId("run-stats")).not.toContainText(/parallel/i);

  const detail = page.getByTestId("candidate-detail");
  await expect(detail).toHaveAttribute("data-candidate", "a");
  await page.getByTestId("matrix-col-c").getByRole("button").first().click();
  await expect(detail).toHaveAttribute("data-candidate", "c");
  await expect(page).toHaveURL(/candidate=c/);

  await page.getByTestId("why-b").click();
  await expect(detail).toHaveAttribute("data-candidate", "b");
  await expect(page.getByTestId("rejection-box")).toBeFocused();
  await expect(page.getByTestId("rejection-new-failures").getByRole("listitem")).toHaveCount(2);
  await expect(page.getByTestId("new-failures-evidence")).toContainText("refresh for a disabled account returns 403 account_disabled");
  await expect(page.locator('tr.focus[data-row="new_failures"]')).toHaveCount(1);

  // A rejected candidate remains fully inspectable.
  await detail.getByRole("tab", { name: /Diff/ }).click();
  await expect(page.getByTestId("diff-viewer")).toContainText("src/app.ts");
  await detail.getByRole("tab", { name: /Logs/ }).click();
  await expect(detail.getByTestId("log-viewer")).toContainText("secrets redacted");
});

test("invalid and missing runs render a safe state", async ({ page }) => {
  const traversal = await page.goto("/runs/..%2F..%2Fetc%2Fpasswd");
  expect(traversal?.status()).toBe(404);
  await expect(page.getByTestId("run-unavailable")).toBeVisible();
  const missing = await page.goto("/runs/run-20990101000000-ffffff/evidence");
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Run not found" })).toBeVisible();
});
