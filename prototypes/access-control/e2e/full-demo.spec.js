const { test, expect } = require("@playwright/test");

test("Full demo starts from login and auto-advances with highlight pops", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("dciac.world"));
  await page.goto("/");
  await expect(page.locator('.login-wrap [data-act="demo-full"]')).toBeVisible();
  await page.waitForFunction(() => window.AccessDemo && typeof window.AccessDemo.setDemoPauseMs === "function");
  await page.evaluate(() => window.AccessDemo.setDemoPauseMs(60000));
  await page.locator('.login-wrap [data-act="demo-full"]').click();

  await expect(page.locator(".demo-tour")).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".demo-pop")).toBeVisible();
  await expect(page.locator(".demo-spot")).toBeVisible();
  await expect(page.locator("#demo-caption")).toContainText("100 MW campus");
  await expect(page.locator("#demo-advance")).toHaveCount(0);
  await expect(page.locator('.rail [data-act="demo-full"]')).toHaveCount(0);
  await expect(page.locator('.topbar [data-act="demo-full"]')).toHaveCount(0);
  await expect(page.locator(".shell")).toHaveAttribute("data-demo", "full");

  await page.evaluate(() => {
    window.AccessDemo.setDemoPauseMs(250);
    window.AccessDemo.advanceDemo();
  });
  await expect.poll(async () => page.locator("#demo-caption").textContent(), { timeout: 5000 })
    .toContain("Hall 1");
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "floor");

  await page.evaluate(() => window.AccessDemo.advanceDemo());
  await expect.poll(async () => page.locator(".shell").getAttribute("data-view"), { timeout: 5000 })
    .toBe("oneline");
  await expect(page.locator(".oneline-sheet")).toBeVisible();
  await expect(page.locator("#demo-caption")).toContainText("one-line");

  await page.evaluate(() => window.AccessDemo.stopDemo());
  await expect(page.locator(".demo-tour")).toHaveCount(0);
});

test("Full demo reads on an iPhone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("dciac.world"));
  await page.goto("/");
  await page.waitForFunction(() => window.AccessDemo);
  await page.evaluate(() => window.AccessDemo.setDemoPauseMs(60000));
  await page.locator('.login-wrap [data-act="demo-full"]').click();

  await expect(page.locator(".demo-tour")).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".demo-pop")).toHaveClass(/is-docked/);
  await expect(page.locator("#demo-caption")).toContainText("100 MW campus");
  await expect(page.locator(".shell")).toHaveAttribute("data-demo", "full");
  await expect(page.locator(".tabbar")).toBeHidden();

  await page.evaluate(() => window.AccessDemo.advanceDemo());
  await expect(page.locator("#demo-caption")).toContainText("Hall 1");
  await expect(page.locator(".scene")).toBeVisible();

  await page.evaluate(() => window.AccessDemo.advanceDemo());
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "oneline");
  await expect(page.locator(".oneline-sheet")).toBeVisible();
  await page.evaluate(() => window.AccessDemo.stopDemo());
});
