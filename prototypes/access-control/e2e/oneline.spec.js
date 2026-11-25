const { test, expect } = require("@playwright/test");

async function signIn(page) {
  await page.goto("/");
  await page.locator('[data-user="dsvs.admin"]').click();
  await expect(page.locator(".who strong")).toHaveText("dsvs.admin");
}

test("one feeder open leaves side B live and the halls at risk", async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = "#/oneline"; });
  await expect(page.locator(".oneline-sheet")).toBeVisible();
  await page.evaluate(() => window.AccessDemo.fireEvent("feeder-a-loss", "", { quiet: true, stay: true }));
  await page.evaluate(() => { location.hash = "#/fleet"; });
  await page.evaluate(() => { location.hash = "#/oneline"; });
  await expect(page.locator(".ol-summary")).toHaveText("No load lost · redundancy gone");
  await expect(page.locator('.ol-node.failed[data-server="grid-1"]')).toHaveCount(1);
  await expect(page.locator('.ol-xfmr.failed')).toHaveCount(1);
  await expect(page.locator('.ol-node.live[data-server="grid-2"]')).toHaveCount(1);
  await expect(page.locator('.ol-node.failed[data-server="pwr-3"]')).toHaveCount(1);
  await expect(page.locator('.ol-node.live[data-server="pwr-4"]')).toHaveCount(1);
  await expect(page.locator(".ol-hall.hit")).toHaveCount(10);
  await expect(page.locator('.ol-line.live[data-feed="mod-riser"]')).toHaveCount(1);
});

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
