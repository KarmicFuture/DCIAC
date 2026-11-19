const { test, expect } = require("@playwright/test");

test("hall build schedule shows every hall's phases and opens a hall on a phase", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator(".hud-mission")).toContainText("Outside");
  await page.locator('nav [data-view="plan"]').click();
  await page.locator('.view-tabs [data-view="halls"]').click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/halls");
  await expect(page.locator(".gantt-page .oneline-head h2")).toHaveText("Hall build schedule");

  // One row per hall, each with the full run of phases ending in Live.
  const rows = page.locator(".gantt-row[data-hall]");
  await expect(rows).toHaveCount(10);
  const hall5 = page.locator('.gantt-row[data-hall="hall-5"]');
  for (const phase of ["pad", "shell", "fitout", "racks", "commission", "live"]) {
    await expect(hall5.locator('[data-phase="' + phase + '"]')).toHaveCount(1);
  }
  await expect(hall5.locator(".gantt-dates")).toContainText("Live 16 Aug 2027");

  // On the first plan day nothing is live, and every hall is still a field.
  await expect(page.locator(".gantt-page .ol-summary")).toContainText("0 of 10 halls live");
  await expect(page.locator('.gantt-row[data-now="field"]')).toHaveCount(10);

  // Halls 1–4 go live before Hall 5, and Halls 9–10 last.
  const liveOf = (id) => page.locator('.gantt-row[data-hall="' + id + '"] [data-phase="live"]').getAttribute("data-date");
  expect(await liveOf("pod-a")).toBe("2027-07-01");
  expect(await liveOf("hall-10")).toBe("2027-10-01");

  // A phase opens that hall's timeline on its first day.
  await hall5.locator('[data-phase="racks"]').click();
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "plan");
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/plan/hall-5");
  await expect(page.locator(".hall-build")).toHaveAttribute("data-phase", "racks");
  expect(errors).toEqual([]);
});
