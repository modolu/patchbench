import { expect, test } from "@playwright/test";

test("home page renders the PatchBench shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /PatchBench/ })).toBeVisible();
  await expect(page.getByText("Reproduce before repair")).toBeVisible();
});
