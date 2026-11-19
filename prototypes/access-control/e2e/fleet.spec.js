const { test, expect } = require("@playwright/test");

async function signIn(page) {
  await page.goto("/");
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator(".who strong")).toHaveText("dsvs.operator");
}

test("fleet view sums alarms, power, and capacity per hall and opens a hall", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await signIn(page);
  await page.locator('.rail [data-act="nav"][data-view="rack"]').click();
  await page.locator('.view-tabs [data-act="nav"][data-view="fleet"]').click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/fleet");
  await expect(page.locator(".fleet-page .oneline-head h2")).toHaveText("Fleet");

  // One row per hall, each with power and headroom.
  const halls = await page.evaluate(() => document.querySelectorAll(".fleet-table tbody tr").length);
  expect(halls).toBeGreaterThan(1);
  await expect(page.locator('.fleet-table [data-col="power"]').first()).toContainText(/MW of .* MW · \d+%/);

  // Every open alarm is counted in exactly one hall, and the totals match the banner.
  const chip = await page.locator(".alarm-chip").innerText();
  const banner = Number((chip.match(/·\s*(\d+)/) || [])[1]);
  await expect(page.locator('[data-total="alarms"]')).toHaveText(String(banner));
  const perHall = await page.locator(".fleet-table tbody tr").evaluateAll((rows) =>
    rows.reduce((sum, row) => sum + (Number((row.querySelector('[data-col="alarms"]').textContent.match(/(\d+) ·/) || [])[1]) || 0), 0));
  expect(perHall).toBe(banner);

  // The managed hall carries the ACS-A14 alarms.
  await expect(page.locator(".fleet-p1 [data-act]")).toHaveText("Hall 1");

  // Opening a hall goes to it on the floor.
  await page.locator(".fleet-table tbody tr").first().locator('[data-act="oneline-hall"]').click();
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "floor");
  expect(errors).toEqual([]);
});

test("fleet view fits an iPhone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.evaluate(() => { location.hash = "#/fleet"; });
  await expect(page.locator(".fleet-page .oneline-head h2")).toBeInViewport();
  await expect(page.locator(".fleet-tile").first()).toBeInViewport();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
