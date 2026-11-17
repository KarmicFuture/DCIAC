const { test, expect } = require("@playwright/test");

async function signIn(page) {
  await page.goto("/");
  await page.locator('[data-user="dsvs.admin"]').click();
  await expect(page.locator(".who strong")).toHaveText("dsvs.admin");
}

test("one-line diagram shows dual feeders and opens a hall", async ({ page }) => {
  await signIn(page);
  await page.locator('.rail [data-act="nav"][data-view="rack"]').click();
  await page.locator('.view-tabs [data-act="nav"][data-view="oneline"]').click();
  await expect(page.locator(".oneline-sheet")).toBeVisible();
  await expect(page.locator(".ol-svg")).toContainText("Feeder A");
  await expect(page.locator(".ol-svg")).toContainText("Feeder B");
  await expect(page.locator(".ol-svg")).toContainText("MV bus");
  await page.locator(".ol-hall[data-pod]").first().click();
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "floor");
});
