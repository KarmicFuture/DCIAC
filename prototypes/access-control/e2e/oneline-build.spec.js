const { test, expect } = require("@playwright/test");

async function openOneline(page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator(".hud-mission")).toContainText("Outside");
  await page.evaluate(() => { location.hash = "#/oneline"; });
  await expect(page.locator(".oneline-sheet")).toBeVisible();
}

const stage = (page, iso) => page.locator('.oneline-build .stage-bar [data-act="build-stage"][data-date="' + iso + '"]').click();
const hall = (page, id) => page.locator('.ol-hall[data-pod="' + id + '"]');

test("one-line build timeline energizes the plant stage by stage", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await openOneline(page);
  await page.locator('[data-act="oneline-build"]').click();
  await expect(page.locator(".oneline-build h2")).toHaveText("One-line · build timeline");
  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/oneline\?build=\d{4}-\d{2}-\d{2}$/);

  // Grass field: nothing is built, no feeders, no halls.
  await stage(page, "2026-11-16");
  await expect(page.locator(".oneline-build .ol-summary")).toContainText("0 of 2 feeders, 0 of 4 power modules · 0 of 10 halls energized · 0 MW IT");
  await expect(page.locator('.ol-node.future[data-server="grid-1"]')).toHaveCount(1);
  await expect(page.locator(".ol-hall.future")).toHaveCount(10);

  // Utility feeders: feeders and transformers set, modules still to come.
  await stage(page, "2027-02-15");
  await expect(page.locator('.ol-node.live[data-server="grid-1"]')).toHaveCount(1);
  await expect(page.locator('.ol-node.future[data-server="pwr-mod"]')).toHaveCount(1);

  // First 40 MW: halls 1–4 live, 5–8 built with no load, 9–10 still pads.
  await stage(page, "2027-07-01");
  await expect(page.locator(".oneline-build .ol-summary")).toContainText("2 of 2 feeders, 4 of 4 power modules · 4 of 10 halls energized · 40 MW IT");
  await expect(hall(page, "pod-a")).toHaveClass(/live/);
  await expect(hall(page, "hall-5")).toHaveClass(/dead/);
  await expect(hall(page, "hall-9")).toHaveClass(/future/);
  await expect(hall(page, "hall-9")).toContainText("Pad");

  // 100 MW: all ten halls energized.
  await stage(page, "2027-10-01");
  await expect(page.locator(".ol-hall.live")).toHaveCount(10);

  // A hall on the build one-line opens its hall timeline.
  await hall(page, "hall-5").click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/plan/hall-5");
  expect(errors).toEqual([]);
});

test("a build one-line link opens on its date, and turning it off restores the live one-line", async ({ page }) => {
  await openOneline(page);
  await page.evaluate(() => { location.hash = "#/oneline?build=2027-08-20"; });
  await expect(page.locator(".oneline-build .ol-summary")).toContainText("20 Aug 2027 · South row");
  await expect(page.locator(".oneline-build .ol-summary")).toContainText("8 of 10 halls energized");
  await page.locator('[data-act="oneline-build"]').click();
  await expect(page.locator(".oneline-build")).toHaveCount(0);
  await expect(page.locator(".ol-summary")).toContainText("utility feeders closed");
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/oneline");
});
