const { test, expect } = require("@playwright/test");

async function openPlan(page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator(".hud-mission")).toContainText("Outside");
  await page.locator('nav [data-view="plan"]').click();
  await expect(page.locator("h1")).toHaveText("Plan");
}

const day = (page, iso) => page.locator('.cal-year [data-act="build-day"][data-date="' + iso + '"]').click();

test("a hall opens from the campus timeline and fills in as the date moves", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await openPlan(page);

  // Hall 5 on a pads date: click its pad on the campus to open its own timeline.
  await page.locator('.stage-bar [data-act="build-stage"][data-date="2027-01-01"]').click();
  await page.locator('.build-scene .rackbox.pad[data-pod="hall-5"]').click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/plan/hall-5");
  const hall = page.locator(".hall-build");
  await expect(hall).toHaveAttribute("data-phase", "pad");
  await expect(hall.locator("h2")).toHaveText("Hall 5 · Pad");
  await expect(hall.locator(".hb-rack")).toHaveCount(0);

  // Empty shell: walls, no equipment.
  await day(page, "2027-04-05");
  await expect(hall).toHaveAttribute("data-phase", "shell");
  await expect(hall.locator(".hb-box")).toHaveCount(0);

  // Power and cooling: equipment and racks planned, none set.
  await hall.locator('.hall-bar [data-phase="fitout"]').click();
  await expect(hall).toHaveAttribute("data-phase", "fitout");
  expect(await hall.locator(".hb-box").count()).toBeGreaterThan(0);
  await expect(hall.locator(".hb-rack.set")).toHaveCount(0);
  const total = await hall.locator(".hb-rack").count();
  expect(total).toBe(20);

  // Racks are set row by row: partway through, some are set and the rest planned.
  const racks = await hall.locator('.hall-bar [data-phase="racks"]').getAttribute("data-date");
  await hall.locator('.hall-bar [data-phase="racks"]').click();
  const early = await hall.locator(".hb-rack.set").count();
  expect(early).toBeGreaterThan(0);
  expect(early).toBeLessThan(total);
  await hall.locator('.hall-bar [data-phase="commission"]').click();
  await expect(hall.locator(".hb-rack.set")).toHaveCount(total);
  expect(racks < "2027-08-16").toBeTruthy();

  // Live on the campus 100 MW date, with a way into the live hall.
  await day(page, "2027-11-15");
  await expect(hall).toHaveAttribute("data-phase", "live");
  await expect(hall.locator(".hb-rack.live")).toHaveCount(total);
  await hall.locator('[data-act="build-live"]').click();
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "floor");
  expect(errors).toEqual([]);
});

test("back to campus, a hall link, and an unknown hall", async ({ page }) => {
  await openPlan(page);
  await page.locator('.hall-picks [data-pod="pod-a"]').click();
  await expect(page.locator(".hall-build h2")).toContainText("Hall 1");
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/plan/pod-a");
  await page.locator('[data-act="build-hall-close"]').click();
  await expect(page.locator(".build-scene")).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/plan");

  // A shared link opens the same hall.
  await page.evaluate(() => { location.hash = "#/plan/hall-9"; });
  await expect(page.locator(".hall-build h2")).toContainText("Hall 9");

  await page.evaluate(() => { location.hash = "#/plan/nowhere"; });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/plan");
  await expect.poll(() => page.evaluate(() => window.AccessDemo.state.toast)).toContain("no hall called nowhere");
});
