import { expect, test } from "@playwright/test";

async function waitForCombatReports(page) {
  await page.goto("/combats");
  await page.waitForResponse(
    (response) => response.url().includes("/api/combat/reports") && response.ok(),
    { timeout: 30_000 }
  );
}

test.describe("Combat reports filters", () => {
  test("filtre par résultat victoire", async ({ page }) => {
    await waitForCombatReports(page);

    const table = page.getByTestId("combat-table");
    await expect(table).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(2);

    await page.getByTestId("combat-filter-result").selectOption("victoire");
    await page.waitForResponse((r) => r.url().includes("/api/combat/reports") && r.ok());
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(table.locator("tbody tr").first()).toContainText(/victoire/i);
  });

  test("recherche par coords", async ({ page }) => {
    await waitForCombatReports(page);
    await page.getByTestId("combat-filter-search").fill("1:2:4");
    await page.waitForResponse((r) => r.url().includes("/api/combat/reports") && r.ok());
    const table = page.getByTestId("combat-table");
    await expect(table.locator("tbody tr")).toHaveCount(1);
  });
});
