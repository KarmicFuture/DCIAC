const { test, expect } = require("@playwright/test");

test("hall route shows Hall 1 with 20 racks", async ({ page }) => {
  await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator("h1")).toHaveCount(0);
  await expect(page.locator(".hud-mission")).toHaveText(/Hall 1( · \d+ abnormal)?/);
  await expect(page.locator(".scene .legend")).toBeHidden();
  await page.locator(".legend-pop summary").click();
  await expect(page.locator(".scene .legend")).toBeVisible();
  await expect(page.locator('.rackbox[data-act="floor-rack"]')).toHaveCount(20);
});
