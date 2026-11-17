const { test, expect } = require("@playwright/test");

async function signIn(page) {
  await page.goto("/");
  await page.locator('[data-user="dsvs.admin"]').click();
  await expect(page.locator(".who strong")).toHaveText("dsvs.admin");
}

test("impact() is pure over sim and reports feeder redundancy", async ({ page }) => {
  await signIn(page);
  await page.locator('[data-act="sim-open"]').click();
  await expect(page.locator(".sim-bar")).toBeVisible();

  const before = await page.evaluate(() => window.AccessDemo.impact());
  expect(before.active).toBe(false);
  expect(before.summary).toBe("");

  await page.evaluate(() => {
    const feeders = window.AccessDemo.runtime.sim;
    window.AccessDemo.fireEvent("feeder-a-loss", "", { stay: true, quiet: true });
    return feeders.feedersDown;
  });

  const single = await page.evaluate(() => window.AccessDemo.impact());
  expect(single.active).toBe(true);
  expect(single.redundancyGone).toBe(true);
  expect(single.loadLost).toBe(false);
  expect(single.summary).toBe("No load lost · redundancy gone");
  expect(single.failedFeeds.length).toBeGreaterThan(0);

  const again = await page.evaluate(() => window.AccessDemo.impact());
  expect(again).toEqual(single);

  await page.evaluate(() => window.AccessDemo.fireEvent("feeder-b-loss", "", { stay: true, quiet: true }));
  const both = await page.evaluate(() => window.AccessDemo.impact());
  expect(both.loadLost).toBe(true);
  expect(both.racksAffected).toBeGreaterThan(0);
  expect(both.summary).not.toBe("No load lost · redundancy gone");
  expect(both.summary).toMatch(/kW at risk/);

  await page.evaluate(() => window.AccessDemo.resetSimulation());
  await expect.poll(() => page.evaluate(() => window.AccessDemo.impact().active)).toBe(false);
});

test("impact dims unaffected site gear and paints failed feeds", async ({ page }) => {
  await signIn(page);
  await page.locator('[data-act="floor-go"][data-level="site"]').click();
  await page.locator('[data-act="sim-open"]').click();
  await page.evaluate(() => {
    window.AccessDemo.runtime.sim.eventId = "feeder-a-loss";
    window.AccessDemo.runtime.sim.targetId = "";
    window.AccessDemo.runtime.sim.barOpen = true;
  });
  await page.locator('[data-act="sim-run"]').click();

  await expect(page.locator(".sim-summary")).toHaveText("No load lost · redundancy gone");
  await expect(page.locator(".world.sim-active")).toBeVisible();
  await expect(page.locator(".rackbox.sim-hit[data-server]").first()).toBeVisible();
  await expect(page.locator(".feed.failed").first()).toBeVisible();
  const dim = page.locator(".rackbox.sim-dim").first();
  await expect(dim).toBeVisible();
  const opacity = await dim.evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(opacity)).toBeCloseTo(0.35, 2);
});

test("secondsUntilCritical projects without mutating load", async ({ page }) => {
  await signIn(page);
  const result = await page.evaluate(() => {
    const entity = {
      bmc: "up",
      load: { gpu: 80, mem: 70, power: 70, temp: 70, drift: 0.5, failover: false },
    };
    const before = JSON.stringify(entity.load);
    const seconds = window.AccessDemo.secondsUntilCritical(entity);
    return { seconds, same: JSON.stringify(entity.load) === before };
  });
  expect(result.same).toBe(true);
  expect(result.seconds).toBeGreaterThan(0);
  expect(result.seconds).toBeLessThan(7200);
});
