const { test, expect } = require("@playwright/test");

async function signIn(page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto("/#/oneline", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator(".ol-svg")).toBeVisible();
}

test("the one-line runs from the utility to every server in rack A14", async ({ page }) => {
  await signIn(page);
  const svg = page.locator(".ol-svg");
  await expect(svg.locator('.ol-node[data-server="bus-a"]')).toContainText("Hall 1 busway");
  await expect(svg.locator('.ol-node[data-server="pdu-A14-a"]')).toContainText("rPDU A");
  await expect(svg.locator('.ol-node[data-server="pdu-A14-b"]')).toContainText("rPDU B");
  const outlets = await page.evaluate(() => window.AccessDemo.outlets.length);
  for (let n = 1; n <= outlets; n += 1) await expect(svg.locator('.ol-node[data-server="outlet-' + n + '"]')).toHaveCount(1);
  await expect(svg.locator('.ol-node[data-server="tray-01"]')).toContainText("GPU Tray 01");
  await expect(svg.locator('.ol-node[data-server="sn2201"]')).toHaveCount(1);
  // An outlet that is off cuts its server off, and the diagram says so.
  await page.evaluate(() => { window.AccessDemo.outlets.find((o) => o.n === 3).power = "off"; });
  await page.locator('.ol-node[data-server="outlet-3"]').click();
  await expect(svg.locator('.ol-node[data-server="outlet-3"]')).toHaveClass(/\bdead\b/);
  await expect(svg.locator('.ol-node[data-server="tray-03"]')).toHaveClass(/\bdead\b/);
  await expect(page.locator("#ol-fly .olf-status")).toHaveText("Off");
});

test("a scoreboard ticks live and a click opens live details on the right", async ({ page }) => {
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(String(err)));
  await signIn(page);
  const hud = page.locator(".ol-hud");
  await expect(hud).toContainText("Grid health");
  await expect(hud).toContainText("2N");
  await expect(hud.locator(".ol-badge")).toHaveCount(6);
  const streak = hud.locator("[data-ol-streak]");
  const first = await streak.textContent();
  await expect.poll(() => streak.textContent(), { timeout: 5000 }).not.toBe(first);

  // Keyboard: focus a node, Enter opens the fly-out with focus on Close; Escape returns.
  const node = page.locator('.ol-node[data-server="pwr-mod"]');
  await node.focus();
  await page.keyboard.press("Enter");
  const fly = page.locator("#ol-fly");
  await expect(fly).toBeVisible();
  await expect(page.locator("#ol-fly-close")).toBeFocused();
  await expect(fly).toHaveAttribute("role", "dialog");
  await expect(fly.locator("#ol-fly-title")).toContainText("Power module A");
  await expect(fly).toContainText("Halls 1 to 5");
  await expect(fly.locator('[data-olf="power"]')).toHaveCount(1);
  await expect(page.locator('.ol-node.picked[data-server="pwr-mod"]')).toHaveCount(1);
  // Live values move without a redraw: push a new load and watch the gauge follow.
  await page.evaluate(() => window.AccessDemo.pushLoad("pwr-mod", { power: 91, drift: 0 }));
  await expect.poll(() => fly.locator('[data-olf-text="power"]').textContent(), { timeout: 4000 }).toMatch(/^9\d% · /);
  // The path upstream is clickable: walk up to the feeder.
  await fly.locator('.olf-path [data-server="grid-1"]').click();
  await expect(fly.locator("#ol-fly-title")).toContainText("Feeder A");
  await expect(fly.locator('[data-act="sim-break"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(fly).toHaveCount(0);
  await expect(page.locator('.ol-node[data-server="grid-1"]')).toBeFocused();

  // A server shows its GPU and memory, and opens on the floor.
  await page.locator('.ol-node[data-server="tray-01"]').click();
  await expect(fly.locator('[data-olf="gpu"]')).toHaveCount(1);
  await expect(fly.locator(".olf-path")).toContainText("Outlet 1");
  await fly.locator('[data-act="oneline-open"]').click();
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "floor");
  expect(errors).toEqual([]);
});

test("in Experimental, clicking the 3D one-line opens the same fly-out", async ({ page }) => {
  await signIn(page);
  await page.locator("#head-gl-toggle").click();
  const host = page.locator("#oneline-gl-host");
  await expect(host).toHaveAttribute("data-onelinegl", "ready");
  expect(Number(await host.getAttribute("data-nodes"))).toBeGreaterThanOrEqual(40);
  await page.locator('.gl-source .ol-node[data-server="grid-2"]').dispatchEvent("click");
  await expect(page.locator("#ol-fly #ol-fly-title")).toContainText("Feeder B");
  await page.locator("#ol-fly-close").click();
  await expect(page.locator("#ol-fly")).toHaveCount(0);
});

test("the fly-out is a bottom sheet on a phone and the page does not scroll sideways", async ({ page }) => {
  await signIn(page, 390, 844);
  await page.locator('.ol-node[data-server="grid-1"]').dispatchEvent("click");
  const fly = page.locator("#ol-fly");
  await expect(fly).toBeVisible();
  const box = await fly.boundingBox();
  expect(box.width).toBeGreaterThan(380);
  expect(box.y).toBeGreaterThan(100);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});
