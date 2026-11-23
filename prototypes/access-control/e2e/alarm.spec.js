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

test("each alarm shows how long it has been open and escalates past its ack target", async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();

  const chip = page.locator(".alarm-chip");
  await expect(chip).toHaveText(/P1 · \d+$/);
  await chip.click();
  // tray-06 (BMC dark) and tray-07 (login rejected) are P1s that stay put while the world runs.
  const row = (id) => page.locator('details.alarm-row:has(summary[data-alarm="watch-' + id + '"])');
  const late = row("tray-07");
  const acked = row("tray-06");
  await expect(late).toHaveClass(/pri-1/);
  await expect(acked).toHaveClass(/pri-1/);
  await expect(late.locator(".alarm-clock")).toHaveText(/^Open \d+s · escalates in 4m$/);
  await expect(late).not.toHaveClass(/escalated/);

  // Ack tray-06 now; it keeps its open time but never escalates.
  await acked.locator("summary b").click();
  await expect(acked.locator(".alarm-target")).toContainText("P1 ack target 5 min, due ");
  await acked.locator('[data-act="alarm-ack"]').click();
  await expect(acked.locator(".alarm-clock")).toHaveText(/^Acked · open \d+s$/);

  // Past the 5-minute P1 target: the unacked row and the chip say it escalated.
  await page.clock.fastForward("06:00");
  await expect(late.locator(".alarm-clock")).toHaveText(/^Escalated · 1m past 5m$/);
  await expect(late.locator(".alarm-clock")).toHaveClass(/is-escalated/);
  await expect(late).toHaveClass(/escalated/);
  await expect(chip).toHaveText(/P1 · \d+ · \d+ escalated/);
  await expect(acked.locator(".alarm-clock")).toHaveText(/^Acked · open 6m$/);
  await expect(acked).not.toHaveClass(/escalated/);
});
