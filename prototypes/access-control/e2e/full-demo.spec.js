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

  // Fleet, then the one-line.
  await page.evaluate(() => window.AccessDemo.advanceDemo());
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "fleet");
  await expect(page.locator("#demo-caption")).toContainText("Fleet");
  await page.evaluate(() => window.AccessDemo.advanceDemo());
  await expect.poll(async () => page.locator(".shell").getAttribute("data-view"), { timeout: 5000 })
    .toBe("oneline");
  await expect(page.locator(".oneline-sheet")).toBeVisible();
  await expect(page.locator("#demo-caption")).toContainText("one-line");

  // The 3D rack from the rear, then the device view on a dark BMC.
  await page.evaluate(() => window.AccessDemo.advanceDemo());
  await expect(page.locator("#demo-caption")).toContainText("Rack A14 in 3D");
  await expect(page.locator(".rack3d-panel .r3-world")).toHaveAttribute("data-view", "rear");
  await page.evaluate(() => window.AccessDemo.advanceDemo());
  await expect(page.locator("#demo-caption")).toContainText("device view");
  await expect(page.locator('.device-view tr.best[data-band="oob"]')).toHaveAttribute("data-path", "acs-serial");
  await expect(page.locator('.device-view tr[data-path="bmc"]')).toContainText("BMC dark");

  // Skip ahead to the Plan date progression.
  for (let i = 0; i < 6; i += 1) {
    await page.evaluate(() => window.AccessDemo.advanceDemo());
  }
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "plan");
  await expect(page.locator("#demo-caption")).toContainText("Nov 2026");
  await expect(page.locator(".build-scene")).toBeVisible();
  await expect(page.locator(".plan-day")).toContainText("16 Nov 2026");

  await page.evaluate(() => window.AccessDemo.advanceDemo());
  await expect(page.locator("#demo-caption")).toContainText("Feb 2027");
  await expect(page.locator(".plan-day")).toContainText("15 Feb 2027");

  await page.evaluate(() => window.AccessDemo.advanceDemo());
  await expect(page.locator("#demo-caption")).toContainText("Apr 2027");

  // Jul 2027 on the one-line, inside Hall 5, and the all-halls schedule.
  await page.evaluate(() => window.AccessDemo.advanceDemo());
  await expect(page.locator("#demo-caption")).toContainText("Jul 2027");
  await expect(page.locator(".oneline-build .ol-summary")).toContainText("4 of 10 halls energized");
  await page.evaluate(() => window.AccessDemo.advanceDemo());
  await expect(page.locator('.hall-build[data-hall="hall-5"]')).toHaveAttribute("data-phase", "racks");
  await page.evaluate(() => window.AccessDemo.advanceDemo());
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "halls");

  await page.evaluate(() => window.AccessDemo.advanceDemo());
  await expect(page.locator("#demo-caption")).toContainText("Oct 2027");
  await expect(page.locator(".plan-day")).toContainText("1 Oct 2027");

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
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "fleet");
  await page.evaluate(() => window.AccessDemo.advanceDemo());
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "oneline");
  await expect(page.locator(".oneline-sheet")).toBeVisible();
  await page.evaluate(() => window.AccessDemo.stopDemo());
  // Stopping puts the build views back.
  expect(await page.evaluate(() => [window.AccessDemo.state.onelineBuild, window.AccessDemo.state.buildHall])).toEqual([false, ""]);
});
