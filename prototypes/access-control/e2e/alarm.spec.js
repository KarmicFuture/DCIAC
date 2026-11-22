const { test, expect } = require("@playwright/test");

test("alarm chip focuses the rack and the action leaves the floor", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();

  const chip = page.locator(".alarm-chip");
  await expect(chip).toHaveText(/P1 · \d+/);
  await expect(page.locator(".alarm-list")).toBeHidden();
  await chip.click();
  const row = page.locator('.alarm-row summary[data-act="alarm-focus"]').first();
  await expect(row).toBeVisible();
  await expect(row.locator("b")).toBeVisible();
  await expect(row.locator(".alarm-line")).toBeVisible();
  await expect(row.locator('[data-act="alarm-go"]')).toBeVisible();
  await expect(row.locator('[data-act="alarm-ack"]')).toHaveCount(0);

  const before = await page.locator(".world").evaluate((el) => el.style.transform);
  await row.locator("b").click();
  await expect(page.locator(".hud-mission")).toContainText("Hall 1");
  await expect(page.locator(".rackbox.is-pulse")).toHaveCount(1);
  await expect(page.locator(".alarm-row[open] [data-act='alarm-ack']")).toBeVisible();
  await expect.poll(async () => page.locator(".world").evaluate((el) => el.style.transform)).not.toBe(before);

  await page.locator(".alarm-row[open] [data-act='alarm-go']").click();
  await expect(page.locator("h1")).toHaveText("Operate · Sessions");
  await expect(page.locator('.view-tabs [data-view="sessions"]')).toHaveAttribute("aria-current", "page");
});
