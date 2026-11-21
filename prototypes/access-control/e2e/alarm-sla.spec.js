const { test, expect } = require("@playwright/test");

test("slaStatus counts down to escalation, and an ack stops it", async ({ page }) => {
  await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
  const s = await page.evaluate(() => {
    const f = window.AccessDemo.slaStatus;
    const t = 1_000_000_000;
    return {
      fresh: f(1, t, t, false),
      p1Late: f(1, t, t + 20 * 60000, false),
      p1Acked: f(1, t, t + 20 * 60000, true),
      p2Mid: f(2, t, t + 20 * 60000, false),
      p3Long: f(3, t, t + 65 * 60000, false),
    };
  });
  expect(s.fresh.label).toBe("Open 0s · escalates in 15m");
  expect(s.fresh.escalated).toBe(false);
  expect(s.p1Late.escalated).toBe(true);
  expect(s.p1Late.label).toBe("Escalated 5m ago · open 20m");
  expect(s.p1Acked.escalated).toBe(false);
  expect(s.p1Acked.label).toBe("Acked · open 20m");
  expect(s.p2Mid.label).toBe("Open 20m · escalates in 40m");
  expect(s.p3Long.label).toBe("Open 1h 05m · escalates in 2h 55m");
});

test("each alarm shows how long it has been open and when it escalates", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
  await page.locator(".alarm-chip").click();

  const rows = page.locator(".alarm-row");
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  await expect(page.locator(".alarm-row .alarm-sla")).toHaveCount(count);

  const first = rows.first();
  const id = await first.locator('summary[data-act="alarm-focus"]').getAttribute("data-alarm");
  const timer = page.locator('.alarm-sla[data-sla-alarm="' + id + '"]');
  await expect(timer).toHaveText(/^Open \d+s · escalates in 15m$/);
  await expect(timer).not.toHaveClass(/is-escalated/);

  // Twenty minutes later and still unacknowledged: escalated, painted in place.
  expect(await page.evaluate((alarm) => window.AccessDemo.ageAlarm(alarm, 20 * 60000), id)).toBe(true);
  await expect(timer).toHaveText(/^Escalated 5m ago · open 20m$/);
  await expect(timer).toHaveClass(/is-escalated/);

  // Acknowledging stops the escalation clock; the open time keeps counting.
  await first.locator('summary[data-act="alarm-focus"] b').click();
  await page.locator(".alarm-row[open] [data-act='alarm-ack']").click();
  const after = page.locator('.alarm-sla[data-sla-alarm="' + id + '"]');
  await expect(after).toHaveText(/^Acked · open 20m$/);
  await expect(after).not.toHaveClass(/is-escalated/);
});

test("alarm timers fit an iPhone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
  await page.locator(".alarm-chip").click();
  const timer = page.locator(".alarm-row .alarm-sla").first();
  await expect(timer).toBeVisible();
  const box = await timer.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
