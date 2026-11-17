const { test, expect } = require("@playwright/test");

async function stageRatio(page) {
  return page.evaluate(() => {
    const stage = document.querySelector(".scene .stage");
    const box = stage.getBoundingClientRect();
    return (box.width * box.height) / (window.innerWidth * window.innerHeight);
  });
}

test("site and hall stage fill the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/floor", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator("#app")).not.toContainText("Loading the asset repository");
  await expect(page.locator(".hud-mission")).toHaveText(/Outside( · \d+ abnormal)?/);
  await expect(page.locator(".lib")).toHaveCount(0);
  await expect(page.locator(".inspector")).toHaveCount(0);
  await expect(page.locator("#app")).not.toContainText("RM1048 healthy");
  await expect(page.locator("#app")).not.toContainText("DI-1 quiet");
  await expect(page.locator("#app")).not.toContainText("Maintenance closed");
  await expect(page.locator("#app")).not.toContainText("Gray is nominal");
  expect(await stageRatio(page)).toBeGreaterThanOrEqual(0.7);

  await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".hud-mission")).toHaveText(/Hall 1( · \d+ abnormal)?/);
  await expect(page.locator("h1")).toHaveCount(0);
  expect(await stageRatio(page)).toBeGreaterThanOrEqual(0.7);

  await page.locator('[data-act="library-open"]').click();
  await expect(page.locator(".lib.drawer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".lib")).toHaveCount(0);

  await page.locator('.rackbox[data-act="floor-rack"][data-rack="A14"] .ftop').click();
  const drawer = page.locator(".scene .inspector.drawer");
  await expect.poll(async () => drawer.evaluate((el) => {
    if (!el.isConnected) return 0;
    const width = Math.round(el.getBoundingClientRect().width);
    return width >= 300 && width <= 340 ? width : 0;
  })).toBeGreaterThanOrEqual(300);
  await page.keyboard.press("Escape");
  await expect(page.locator(".inspector")).toHaveCount(0);
});
