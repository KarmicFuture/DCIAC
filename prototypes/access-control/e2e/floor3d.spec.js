const { test, expect } = require("@playwright/test");

async function signIn(page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator("#app")).not.toContainText("Loading the asset repository");
  await expect(page.locator(".stage .world")).toBeVisible();
}

test("Experimental draws the hall with three.js, animates it, and turns back off", async ({ page }) => {
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(String(err)));
  await signIn(page);

  const toggle = page.locator("#floor3d-toggle");
  await expect(toggle).toHaveAccessibleName("Experimental");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#floor3d-host")).toHaveCount(0);

  await toggle.click();
  await expect(page.locator("#floor3d-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#floor3d-toggle")).toBeFocused();
  const host = page.locator("#floor3d-host");
  await expect(host).toHaveAttribute("role", "img");
  await expect(host).toHaveAttribute("aria-label", /Experimental 3D view of .*20 racks/);
  await expect(host).toHaveAttribute("data-floor3d", "ready");
  await expect(host).toHaveAttribute("data-racks", "20");
  const canvas = host.locator("canvas[data-floor3d=canvas]");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box.width).toBeGreaterThan(600);
  expect(box.height).toBeGreaterThan(300);
  // The CSS floor is replaced, not stacked under the canvas.
  await expect(page.locator(".stage .world")).toHaveCount(0);

  // It moves: two frames a moment apart differ.
  const a = await canvas.screenshot();
  await page.waitForTimeout(600);
  const b = await canvas.screenshot();
  expect(Buffer.compare(a, b)).not.toBe(0);

  // A re-render keeps the same canvas, and the floor comes back when it is turned off.
  await page.locator("#floor3d-toggle").click();
  await expect(page.locator("#floor3d-host")).toHaveCount(0);
  await expect(page.locator(".stage .world")).toBeVisible();
  await page.locator("#floor3d-toggle").click();
  await expect(page.locator("#floor3d-host")).toHaveAttribute("data-floor3d", "ready");
  expect(errors).toEqual([]);
});

test("Experimental fits an iPhone-width screen without sideways scroll", async ({ page }) => {
  await signIn(page, 390, 844);
  await page.locator("#floor3d-toggle").click();
  await expect(page.locator("#floor3d-host")).toHaveAttribute("data-floor3d", "ready");
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(sideways).toBeLessThanOrEqual(1);
  await expect(page.locator("#floor3d-host canvas")).toBeVisible();
});

test("Experimental draws the rack with three.js in Operate and on the floor, and a click selects a device", async ({ page }) => {
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/rack", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator(".rack3d-panel .r3-world")).toBeVisible();

  const toggle = page.locator("#rack-gl-toggle");
  await expect(toggle).toHaveAccessibleName("Experimental");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  const host = page.locator(".rack3d-panel #rack3d-host");
  await expect(host).toHaveAttribute("data-rackgl", "ready");
  await expect(host).toHaveAttribute("role", "img");
  await expect(host).toHaveAttribute("data-units", "10");
  await expect(page.locator(".rack3d-panel .r3-world")).toHaveCount(0);
  // The keyboard path to the same outlets stays under the 3D rack.
  await expect(page.locator(".rack3d-panel .r3-pdu-table tbody tr")).toHaveCount(11);
  // The view presets still aim the camera.
  await page.locator('.rack3d-panel [data-act="rack-view"][data-rack-view="rear"]').click();
  await expect(page.locator('.rack3d-panel [data-act="rack-view"][data-rack-view="rear"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('.rack3d-panel [data-act="rack-view"][data-rack-view="front"]').click();

  // Clicking a device in the 3D rack selects it, the same as the CSS rack.
  const before = await page.evaluate(() => location.hash);
  const box = await host.locator("canvas").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3);
  await expect.poll(() => page.evaluate(() => location.hash)).not.toBe(before);
  expect(await page.evaluate(() => location.hash)).toMatch(/^#\/rack\/A14\/.+/);

  // The rack opened from the floor is the same view, so it is three.js too.
  await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
  await page.locator('.rackbox[data-act="floor-rack"][data-rack="A14"] .ftop').click({ force: true });
  await expect(page.locator(".scene.rack-scene #rack3d-host")).toHaveAttribute("data-rackgl", "ready");
  await page.locator(".scene.rack-scene #rack-gl-toggle").click();
  await expect(page.locator(".scene.rack-scene .r3-world")).toBeVisible();
  expect(errors).toEqual([]);
});
