const { test, expect } = require("@playwright/test");

function encodeSim(data) {
  const b64 = Buffer.from(JSON.stringify(data), "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signIn(page, hash = "#/control") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/" + hash, { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator("#app")).not.toContainText("Loading the asset repository");
}

function cloud(page, id) {
  return page.evaluate((cid) => {
    const g = document.querySelector('.heat-clouds .cloud[data-id="' + cid + '"]');
    return g ? { kind: g.dataset.kind, c: Number(g.dataset.c), r: Number(g.dataset.r), y: Number(g.dataset.y), strength: Number(g.dataset.strength) } : null;
  }, id);
}

test("Heat path turns the hall into a heat map of hot clouds and cold spots", async ({ page }) => {
  await signIn(page);
  const toggle = page.locator("#heat-path-toggle");
  await expect(toggle).toHaveAccessibleName("Heat path");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".heat-clouds")).toHaveCount(0);

  await toggle.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(toggle).toBeFocused();
  const outline = await toggle.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
  await page.keyboard.press("Enter");

  // The heat map lives on the hall floor, so Heat path takes you there.
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/floor/hall");
  await expect(page.locator("#heat-path-toggle")).toHaveAttribute("aria-pressed", "true");
  const map = page.locator(".heat-clouds");
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute("role", "img");
  await expect(map).toHaveAttribute("aria-label", /^Heat map\. Hottest: Rack \w+ exhaust \d+\.\d °C\./);
  expect(await page.locator('.heat-clouds .cloud[data-kind="hot"]').count()).toBeGreaterThan(10);
  expect(await page.locator('.heat-clouds .cloud[data-kind="cold"]').count()).toBeGreaterThan(10);
  // Clouds are soft: blurred, layered puffs, drifting.
  await expect(page.locator(".heat-clouds filter feGaussianBlur")).toHaveCount(1);
  expect(await page.locator('.heat-clouds .cloud[data-id="hot-A14"] circle').count()).toBeGreaterThanOrEqual(3);
  expect(await page.locator('.heat-clouds .cloud').first().evaluate((el) => getComputedStyle(el).animationName)).toBe("heat-cloud-drift");
  // A working CDU is the strongest cold spot.
  const cdu = await cloud(page, "cold-cdu-a");
  expect(cdu).toMatchObject({ kind: "cold", c: 20.5, strength: 1 });
  // The heat map replaces the boxy thermal overlay while it is on, and says what it shows.
  await expect(page.locator(".thermal-map")).toHaveCount(0);
  await expect(page.locator("#heat-map-status")).toContainText("Heat map ·");

  await page.locator("#heat-path-toggle").click();
  await expect(page.locator(".heat-clouds")).toHaveCount(0);
  await expect(page.locator(".thermal-map")).toHaveCount(1);
  await expect(page.locator("#heat-path-toggle")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#heat-path-toggle")).toBeFocused();
});

test("a CDU failure scenario moves the clouds, and Reset settles them", async ({ page }) => {
  test.setTimeout(90000);
  await signIn(page, "#/floor/hall");
  await page.locator("#heat-path-toggle").click();
  await expect(page.locator(".heat-clouds")).toBeVisible();
  const before = await cloud(page, "hot-A14");
  const coldBefore = await cloud(page, "cold-A14");
  expect(before.kind).toBe("hot");

  await page.evaluate((sim) => { location.hash = "#/floor/hall?sim=" + sim; },
    encodeSim({ seed: 1, speed: 60, events: [{ at: 0, eventId: "cdu-failure", targetId: "" }] }));
  await expect(page.locator(".sim-bar")).toBeVisible();

  // The CDU stops cooling: its cold spot turns into a warm patch.
  await expect.poll(() => cloud(page, "cold-cdu-a"), { timeout: 30000 }).toBeNull();
  await expect.poll(async () => (await cloud(page, "hot-cdu-a") || {}).kind).toBe("hot");
  await expect(page.locator(".heat-clouds")).toHaveAttribute("aria-label", /CDU .* \(not cooling\)/);
  // Rack heat grows and drifts over the rack toward the cold aisle; its cold spot shrinks.
  await expect.poll(async () => (await cloud(page, "hot-A14")).r, { timeout: 30000 }).toBeGreaterThan(before.r);
  const after = await cloud(page, "hot-A14");
  expect(after.c).toBeGreaterThan(before.c);
  expect(Math.abs(after.y - coldBefore.y)).toBeLessThan(Math.abs(before.y - coldBefore.y));
  await expect.poll(async () => ((await cloud(page, "cold-A14")) || { strength: 0 }).strength).toBeLessThan(coldBefore.strength);

  // Reset puts the plant back, and the clouds with it.
  // The bar re-renders on every 60x tick, so press Reset through the DOM, as a click would.
  await page.evaluate(() => document.querySelector('[data-act="sim-reset"]').click());
  await expect.poll(async () => (await cloud(page, "cold-cdu-a") || {}).strength, { timeout: 30000 }).toBe(1);
  await expect.poll(async () => (await cloud(page, "hot-A14")).r).toBeLessThan(after.r);
});

test("clouds hold still for people who ask for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page, "#/floor/hall");
  await page.locator("#heat-path-toggle").click();
  await expect(page.locator(".heat-clouds .cloud").first()).toBeVisible();
  expect(await page.locator(".heat-clouds .cloud").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});
