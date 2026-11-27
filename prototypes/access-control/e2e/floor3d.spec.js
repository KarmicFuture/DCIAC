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

  const toggle = page.locator("#head-gl-toggle");
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
  // Two clicks at different heights pick two different devices.
  await page.waitForTimeout(300);
  const box = await host.locator("canvas").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3);
  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/rack\/A14\/.+/);
  const upper = await page.evaluate(() => location.hash);
  await page.waitForTimeout(300);
  const after = await host.locator("canvas").boundingBox();
  await page.mouse.click(after.x + after.width / 2, after.y + after.height * 0.5);
  await expect.poll(() => page.evaluate(() => location.hash)).not.toBe(upper);
  expect(await page.evaluate(() => location.hash)).toMatch(/^#\/rack\/A14\/.+/);

  // Experimental is one switch: the hall floor is three.js now too, and so is the rack
  // opened from it, because that is the same rack view.
  await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#floor3d-host")).toHaveAttribute("data-floor3d", "ready");
  await page.goto("/#/floor/pod-a/A14", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".scene.rack-scene #rack3d-host")).toHaveAttribute("data-rackgl", "ready");
  await page.locator(".scene.rack-scene #rack-gl-toggle").click();
  await expect(page.locator(".scene.rack-scene .r3-world")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Experimental draws Outside and the Plan site with three.js, and clicks still open what they open", async ({ page }) => {
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/floor", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator(".hud-mission")).toContainText("Outside");

  // Outside: every hall and piece of yard gear, and the feeders and pipes, from the same world.
  const standard = await page.locator(".site-scene .world .rackbox").count();
  const lines = await page.locator(".site-scene .world .feed, .site-scene .world .pipe").count();
  await page.locator("#floor3d-toggle").click();
  const host = page.locator("#world-gl-host");
  await expect(host).toHaveAttribute("data-worldgl", "ready");
  await expect(host).toHaveAttribute("data-kind", "site");
  await expect(host).toHaveAttribute("role", "img");
  expect(Number(await host.getAttribute("data-boxes"))).toBe(standard);
  expect(Number(await host.getAttribute("data-lines"))).toBe(lines);
  await expect(host.locator("canvas")).toBeVisible();
  await expect(page.locator(".gl-source")).toBeHidden();
  const a = await host.locator("canvas").screenshot();
  await page.waitForTimeout(600);
  expect(Buffer.compare(a, await host.locator("canvas").screenshot())).not.toBe(0);
  // Walk through needs the standard floor, so it steps aside in Experimental.
  await expect(page.locator('[data-act="floor-walk"]')).toHaveCount(0);

  // Plan: the same switch is on there, and a click on a hall opens its timeline.
  await page.goto("/#/plan", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#head-gl-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-act="build-stage"]').nth(5).click();
  await expect(host).toHaveAttribute("data-kind", "plan");
  await expect(host).toHaveAttribute("data-worldgl", "ready");
  await expect.poll(async () => Number(await host.getAttribute("data-boxes"))).toBeGreaterThan(4);
  await page.waitForTimeout(400);
  const box = await host.locator("canvas").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/plan\/hall-/);

  // Off again: the standard scene is back.
  await page.goto("/#/plan", { waitUntil: "domcontentloaded" });
  await page.locator("#head-gl-toggle").click();
  await expect(page.locator("#world-gl-host")).toHaveCount(0);
  await expect(page.locator(".build-scene .world")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Experimental turns the non-drawing views into a dashboard of cards", async ({ page }) => {
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/control", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator(".dash-strip")).toHaveCount(0);
  const flat = await page.locator(".view .panel").first().evaluate((el) => getComputedStyle(el).boxShadow);

  await page.locator("#head-gl-toggle").click();
  await expect(page.locator(".shell")).toHaveAttribute("data-experimental", "on");
  await expect(page.locator("#head-gl-toggle")).toBeFocused();
  // Live tiles under the heading, each a named button that opens its view.
  const tiles = page.locator(".dash-strip .dash-tile");
  await expect(tiles).toHaveCount(5);
  await expect(tiles.first()).toContainText("Open alarms");
  await expect(page.locator(".dash-strip")).toHaveJSProperty("previousElementSibling.className", "page-head");
  // Cards pop out: deeper shadow than the standard panel, and the view is a grid.
  const deep = await page.locator(".view .panel").first().evaluate((el) => getComputedStyle(el).boxShadow);
  expect(deep).not.toBe(flat);
  expect(deep.split("rgba").length).toBeGreaterThan(3);
  expect(await page.locator(".view").evaluate((el) => getComputedStyle(el).display)).toBe("grid");
  // A small card leans toward the pointer.
  const tile = tiles.nth(1);
  const box = await tile.boundingBox();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.2);
  await expect.poll(() => tile.evaluate((el) => el.style.getPropertyValue("--ry"))).not.toBe("");
  // Tiles open their view.
  await page.locator('.dash-tile[data-view="sessions"]').click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/sessions");
  await expect(page.locator(".dash-strip .dash-tile")).toHaveCount(5);

  // Drawings stay drawings: the one-line becomes three.js, with no dashboard tiles.
  await page.locator('[data-act="nav"][data-view="oneline"]').first().click();
  await expect(page.locator(".dash-strip")).toHaveCount(0);
  const host = page.locator("#oneline-gl-host");
  await expect(host).toHaveAttribute("data-onelinegl", "ready");
  await expect(host).toHaveAttribute("role", "img");
  // Feeders A and B, modules A to D, two battery zones, and every hall are clickable.
  expect(Number(await host.getAttribute("data-nodes"))).toBeGreaterThanOrEqual(16);
  expect(Number(await host.getAttribute("data-segments"))).toBeGreaterThan(20);
  const canvas = host.locator("canvas");
  const a = await canvas.screenshot();
  await page.waitForTimeout(600);
  expect(Buffer.compare(a, await canvas.screenshot())).not.toBe(0);

  // On a phone the dashboard still fits without sideways scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { location.hash = "#/fleet"; });
  await expect(page.locator(".dash-strip .dash-tile")).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

  await page.locator("#head-gl-toggle").click();
  await expect(page.locator(".shell")).toHaveAttribute("data-experimental", "off");
  await expect(page.locator(".dash-strip")).toHaveCount(0);
  expect(errors).toEqual([]);
});
