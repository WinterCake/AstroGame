import { expect, test } from "@playwright/test";

async function waitForSpyReports(page) {
  await page.goto("/spy");
  await page.waitForResponse(
    (response) => response.url().includes("/api/spy/reports") && response.ok(),
    { timeout: 30_000 }
  );
}

test.describe("Spy page filters", () => {
  test("filtre sans défense", async ({ page }) => {
    await waitForSpyReports(page);

    const table = page.getByTestId("spy-table");
    await expect(table).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(1);

    await page.getByTestId("spy-filter-sans-defense").uncheck();
    await page.waitForResponse((r) => r.url().includes("/api/spy/reports") && r.ok());
    await expect(table.locator("tbody tr")).toHaveCount(3);

    await page.getByTestId("spy-filter-sans-defense").check();
    await expect(table.locator("tbody tr")).toHaveCount(1);
  });

  test("pagination sur une seule page", async ({ page }) => {
    await waitForSpyReports(page);
    await expect(page.getByTestId("list-pagination-next")).toBeDisabled();
    await expect(page.getByText(/Page 1/)).toBeVisible();
  });

  test("ouvre le panneau détail au clic coords", async ({ page }) => {
    await waitForSpyReports(page);
    await page.getByTestId("spy-table").locator("tbody tr").first().locator(".col-coords").click();
    await expect(page.locator(".spy-panel")).toContainText("Rapport");
  });
});
