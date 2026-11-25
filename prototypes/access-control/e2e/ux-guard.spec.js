// UX guard: fails when a main view breaks its layout, not only its behaviour.
// For each main view at desktop (1440 px) and iPhone (390 px) width it checks:
//   - the page heading is visible and above the fold
//   - the page does not scroll sideways
//   - no console errors, page crashes, or API 5xx answers
// The daily runs treat a red UX guard like any other failing test.
const { test, expect } = require("@playwright/test");

const VIEWS = [
  ["#/rack", "Operate · Rack"],
  ["#/map", "Operate · Port map"],
  ["#/control", "Operate · Control"],
  ["#/sessions", "Operate · Sessions"],
  ["#/oneline", "Operate · One-line"],
  ["#/fleet", "Operate · Fleet"],
  ["#/plan", "Plan · Campus"],
  ["#/halls", "Plan · Halls"],
  ["#/models", "Plan · Models"],
  ["#/dcim", "Plan · DCIM"],
  ["#/audit", "Audit"],
  ["#/simulate", "Simulate"],
];

const SIZES = [
  ["desktop", { width: 1440, height: 900 }],
  ["iPhone", { width: 390, height: 844 }],
];

for (const [label, size] of SIZES) {
  test(`main views keep their heading in view and fit the ${label} width`, async ({ page }) => {
    const problems = [];
    page.on("console", (msg) => { if (msg.type() === "error") problems.push("console: " + msg.text()); });
    page.on("pageerror", (err) => problems.push("crash: " + err.message));
    page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 500) problems.push("api " + r.status() + ": " + r.url()); });

    await page.setViewportSize(size);
    await page.goto("/");
    await page.locator('[data-act="login"][data-user="dsvs.operator"]').click();
    await expect(page.locator(".shell")).toBeVisible();

    for (const [hash, heading] of VIEWS) {
      await page.evaluate((h) => { location.hash = h; }, hash);
      const h1 = page.locator("h1");
      await expect(h1, hash).toHaveText(heading);
      await expect(h1, `${hash}: heading is visible`).toBeVisible();
      // Views that load data re-render once, so measure the heading once it is stable.
      const top = () => page.evaluate(() => {
        const el = document.querySelector("h1");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.height > 0 ? { y: Math.round(r.y), bottom: Math.round(r.bottom) } : null;
      });
      await expect.poll(top, { message: `${hash}: heading is rendered` }).not.toBeNull();
      await expect.poll(async () => (await top()).y, { message: `${hash}: heading starts on screen` }).toBeGreaterThanOrEqual(0);
      await expect.poll(async () => (await top()).bottom, { message: `${hash}: heading is above the fold` }).toBeLessThanOrEqual(size.height);
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await expect.poll(overflow, { message: `${hash}: page scrolls sideways` }).toBeLessThanOrEqual(1);
    }
    expect(problems).toEqual([]);
  });
}
