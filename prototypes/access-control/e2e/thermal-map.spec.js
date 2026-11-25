const { test, expect } = require("@playwright/test");

async function signInHall(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
  const user = page.locator('[data-user="dsvs.operator"]');
  if (await user.count()) await user.click();
  await expect(page.locator("#app")).not.toContainText("Loading the asset repository");
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "floor");
}

test("hall floor overlays a thermal map from inlet and return", async ({ page }) => {
  await signInHall(page);
  const map = page.locator(".thermal-map");
  await expect(map).toHaveCount(1);
  await expect(map).toHaveAttribute("aria-label", /Cold aisles .+ Hot aisle .+ return/);
  await expect(page.locator('.thermal-map rect[data-tone="cold"]')).toHaveCount(2);
  await expect(page.locator('.thermal-map rect[data-tone="hot"]')).toHaveCount(1);
  await expect(page.locator(".thermal-scale")).toContainText("Supply 20.5 °C");
  await expect(page.locator('[data-act="thermal-map"]')).toHaveAttribute("aria-pressed", "true");

  const colors = await page.locator(".thermal-map stop").evaluateAll((stops) => stops.map((stop) => stop.getAttribute("stop-color")));
  expect(new Set(colors).size).toBeGreaterThan(1);

  await page.locator('[data-act="thermal-map"]').click();
  await expect(page.locator(".thermal-map")).toHaveCount(0);
  await expect(page.locator(".thermal-scale")).toHaveCount(0);
  await expect(page.locator('[data-act="thermal-map"]')).toHaveAttribute("aria-pressed", "false");

  await page.locator('[data-act="thermal-map"]').click();
  await expect(page.locator(".thermal-map")).toHaveCount(1);
});

async function park(page, id, catalogId, name, localX, localY) {
  await page.evaluate(({ id, catalogId, name, localX, localY }) => {
    const pod = document.querySelector(".pod");
    const originX = parseFloat(pod.style.getPropertyValue("--x"));
    const originY = parseFloat(pod.style.getPropertyValue("--y"));
    const spec = window.AccessDemo.state.plan.placements;
    const existing = spec.find((item) => item.id === id);
    const point = { x: originX + localX, y: originY + localY };
    if (existing) {
      existing.x = point.x;
      existing.y = point.y;
    } else {
      spec.push({ id, catalogId, name, place: "floor", x: point.x, y: point.y, host: "" });
    }
    location.hash = "#/fleet";
  }, { id, catalogId, name, localX, localY });
  await page.evaluate(() => { location.hash = "#/floor/hall"; });
  await expect(page.locator(".thermal-map")).toHaveCount(1);
}

test("moving a load and a cooler changes the 3D hall heat map", async ({ page }) => {
  await signInHall(page);
  const coldBefore = await page.locator(".thermal-scale").innerText();

  await park(page, "gear-gpu", "inv-nvidia-gb200-nvl72", "GB200 1", 356, -1);
  const coldGpu = page.locator('.thermal-spot[data-gear="gear-gpu"]');
  await expect(coldGpu).toHaveAttribute("data-mode", "heat");
  const inCold = Number(await coldGpu.getAttribute("data-c"));
  expect(inCold).toBeGreaterThan(24);
  await expect(page.locator(".thermal-scale")).not.toHaveText(coldBefore);

  await park(page, "gear-gpu", "inv-nvidia-gb200-nvl72", "GB200 1", 356, 129);
  const inHot = Number(await page.locator('.thermal-spot[data-gear="gear-gpu"]').getAttribute("data-c"));
  expect(inHot).toBeGreaterThan(inCold);

  await park(page, "gear-crac", "vertiv-crac", "CRAC 1", 356, 129);
  const besideCooler = Number(await page.locator('.thermal-spot[data-gear="gear-gpu"]').getAttribute("data-c"));
  expect(besideCooler).toBeLessThan(inHot);
  await expect(page.locator('.thermal-spot[data-gear="gear-crac"]')).toHaveAttribute("data-mode", "cool");
});
