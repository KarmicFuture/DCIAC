const { test, expect } = require("@playwright/test");

async function signIn(page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("dciac.world"));
  await page.goto("/");
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator(".hud-mission")).toContainText("Outside");
}

async function drag(page, locator, dx, dy) {
  const box = await locator.locator(".ftop").boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 12 });
  await page.mouse.up();
}

test("floor pieces drag inside the view and a click still opens them", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);

  const grid = page.locator('.rackbox[data-server="grid-1"]');
  const before = await grid.evaluate((el) => el.style.getPropertyValue("--x"));
  await drag(page, grid, 80, 20);
  const yard = await grid.evaluate((el) => ({
    x: el.style.getPropertyValue("--x"),
    nx: parseFloat(el.style.getPropertyValue("--x")),
    ny: parseFloat(el.style.getPropertyValue("--y")),
  }));
  expect(yard.x).not.toBe(before);
  expect(yard.nx).toBeGreaterThanOrEqual(-640);
  expect(yard.ny).toBeGreaterThanOrEqual(-440);

  await page.locator('[data-act="floor-go"][data-level="hall"]').first().click();
  await expect(page.locator(".hud-mission")).toContainText("Hall 1");
  const rack = page.locator('.rackbox[data-rack="A14"]');
  const rackBefore = await rack.evaluate((el) => el.style.getPropertyValue("--x"));
  await drag(page, rack, 80, 16);
  const moved = await rack.evaluate((el) => ({
    x: el.style.getPropertyValue("--x"),
    nx: parseFloat(el.style.getPropertyValue("--x")),
    ny: parseFloat(el.style.getPropertyValue("--y")),
    podW: parseFloat(getComputedStyle(el.parentElement).width),
    podH: parseFloat(getComputedStyle(el.parentElement).height),
    w: parseFloat(getComputedStyle(el).width),
    d: parseFloat(getComputedStyle(el).height),
  }));
  expect(moved.x).not.toBe(rackBefore);
  expect(moved.nx).toBeGreaterThanOrEqual(0);
  expect(moved.ny).toBeGreaterThanOrEqual(0);
  expect(moved.nx + moved.w).toBeLessThanOrEqual(moved.podW + 1);
  expect(moved.ny + moved.d).toBeLessThanOrEqual(moved.podH + 1);
  await expect(page.locator(".chassis-top")).toHaveCount(0);

  // A drag swallows the click that ends it, then clears the flag on the next task.
  // Wait for that before sending a fresh click, or the click can land first.
  await expect.poll(() => page.evaluate(() => window.AccessDemo.state.floor.suppressClick)).toBe(false);
  await page.locator('.rackbox[data-act="floor-rack"][data-rack="A13"]').dispatchEvent("click");
  await expect(page.locator(".inspector .crumbs")).toContainText("A13");
});
