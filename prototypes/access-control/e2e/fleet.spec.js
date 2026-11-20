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
  await expect(page.locator('.fleet-p1 [data-act="oneline-hall"]')).toHaveText("Hall 1");

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

test("fleet shows simulated power loss per hall", async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = "#/fleet"; });
  await expect(page.locator(".fleet-feed")).toHaveCount(0);
  await page.evaluate(() => window.AccessDemo.fireEvent("feeders-both-loss", "", { quiet: true, stay: true }));
  await page.evaluate(() => { location.hash = "#/floor"; });
  await page.evaluate(() => { location.hash = "#/fleet"; });
  await expect(page.locator(".fleet-feed.lost")).toHaveCount(10);
  await expect(page.locator(".fleet-sim")).toContainText("Simulation:");
  await page.evaluate(() => window.AccessDemo.resetSimulation());
  await page.evaluate(() => { location.hash = "#/floor"; });
  await page.evaluate(() => { location.hash = "#/fleet"; });
  await expect(page.locator(".fleet-feed")).toHaveCount(0);
});

test("a hall's racks drill down from fleet, sort by power or alarms, and open on the floor", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await signIn(page);
  await page.evaluate(() => { location.hash = "#/fleet"; });
  const hallRow = page.locator('.fleet-table > tbody > tr[data-hall="pod-a"]');
  const toggle = hallRow.locator('[data-act="fleet-racks"]');
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const racks = page.locator('[data-racks-for="pod-a"] .fleet-rack-table tbody tr');
  await expect(racks).toHaveCount(20);

  // Default sort: highest IT power first.
  await expect(page.locator('.fleet-sort [data-sort="power"]')).toHaveAttribute("aria-pressed", "true");
  const kws = await racks.evaluateAll((rows) => rows.map((row) => Number(row.querySelector('[data-col="power"]').dataset.kw)));
  expect(kws).toEqual([...kws].sort((a, b) => b - a));

  // Sort by alarms: the alarmed rack (A14, the ACS domain) comes first, and the
  // per-rack alarm counts add up to the hall's count.
  await page.locator('.fleet-sort [data-sort="alarms"]').click();
  await expect(page.locator('.fleet-sort [data-sort="alarms"]')).toHaveAttribute("aria-pressed", "true");
  await expect(racks.first()).toHaveAttribute("data-rack", "A14");
  const hallAlarms = Number(((await hallRow.locator('[data-col="alarms"]').innerText()).match(/(\d+) ·/) || [])[1]);
  expect(hallAlarms).toBeGreaterThan(0);
  const rackAlarms = await racks.evaluateAll((rows) =>
    rows.reduce((sum, row) => sum + (Number((row.querySelector('[data-col="alarms"]').textContent.match(/(\d+) ·/) || [])[1]) || 0), 0));
  expect(rackAlarms).toBe(hallAlarms);

  // Fits an iPhone width with the racks open.
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1440, height: 900 });

  // A rack opens on the floor.
  await racks.first().locator('[data-act="floor-rack"]').click();
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "floor");
  await expect.poll(() => page.evaluate(() => location.hash)).toContain("/A14");

  // Hiding the racks collapses the row.
  await page.evaluate(() => { location.hash = "#/fleet"; });
  await page.locator('.fleet-table > tbody > tr[data-hall="pod-a"] [data-act="fleet-racks"]').click();
  await expect(page.locator(".fleet-racks-row")).toHaveCount(0);
  expect(errors).toEqual([]);
});
