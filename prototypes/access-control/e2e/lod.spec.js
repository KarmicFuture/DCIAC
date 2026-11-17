const { test, expect } = require("@playwright/test");

test("hall LOD stays far until zoom, without a re-render", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();

  const world = page.locator(".scene .world");
  await expect(world).toHaveAttribute("data-lod", "far");
  const rack = page.locator('.rackbox[data-act="floor-rack"][data-rack="A14"]');
  await expect(rack.locator(".gear-stack")).toHaveCount(1);
  await expect(rack.locator(".led")).toHaveCount(10);
  const farVis = await rack.evaluate((el) => {
    const gear = getComputedStyle(el.querySelector(".gear-stack")).visibility;
    const cap = getComputedStyle(el.querySelector(".cap-label")).visibility;
    const top = getComputedStyle(el.querySelector(".ftop")).backgroundImage;
    return { gear, cap, flat: top === "none" };
  });
  expect(farVis.gear).toBe("hidden");
  expect(farVis.cap).toBe("hidden");
  expect(farVis.flat).toBe(true);

  const before = await world.evaluate((el) => el.querySelectorAll(".rackbox .led").length);
  await page.locator('[data-act="floor-zoom"][data-dir="in"]').click();
  await page.locator('[data-act="floor-zoom"][data-dir="in"]').click();
  await page.locator('[data-act="floor-zoom"][data-dir="in"]').click();
  await expect(world).toHaveAttribute("data-lod", "near");
  const after = await world.evaluate((el) => el.querySelectorAll(".rackbox .led").length);
  expect(after).toBe(before);

  const nearVis = await rack.evaluate((el) => ({
    gear: getComputedStyle(el.querySelector(".gear-stack")).visibility,
    cap: getComputedStyle(el.querySelector(".cap-label")).visibility,
  }));
  expect(nearVis.gear).toBe("visible");
  expect(nearVis.cap).toBe("visible");

  await page.locator('[data-act="floor-zoom"][data-dir="reset"]').click();
  await expect(world).toHaveAttribute("data-lod", "far");
  await rack.hover();
  await expect(rack.locator(".rack-tag")).toBeVisible();
  await expect(rack.locator(".rack-tag")).toHaveText("A14");
});
