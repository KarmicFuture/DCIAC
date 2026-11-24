const { test, expect } = require("@playwright/test");

async function signIn(page) {
  await page.goto("/");
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator(".hud-mission")).toContainText("Outside");
}

const devIds = (page, scope) => page.locator(scope + " .r3-world .r3-dev").evaluateAll((els) => els.map((el) => el.dataset.dev).sort());

test("clicking a rack on the floor opens the same 3D rack view as Operate", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await signIn(page);

  // Operate › Rack first, for reference.
  await page.locator('.rail [data-act="nav"][data-view="rack"]').click();
  await expect(page.locator(".r3-pdu")).toHaveCount(2);
  const operate = await devIds(page, ".rack3d-panel");

  // Floor › Hall 1 › click rack A14.
  await page.locator('.rail [data-act="nav"][data-view="floor"]').click();
  await page.locator('[data-act="floor-go"][data-level="hall"]').first().click();
  await expect(page.locator(".hud-mission")).toContainText("Hall 1");
  // Chromium's elementsFromPoint lists the overhead power whips first in a 3D scene even
  // where the rack top is in front, so Playwright's hit check refuses a click a person can make.
  // A forced click is still a real mouse click at the rack top's centre: the A14 checks below
  // fail if anything actually covers it.
  await page.locator('.rackbox[data-act="floor-rack"][data-rack="A14"] .ftop').click({ force: true });

  const scene = page.locator(".scene.rack-scene");
  await expect(scene.locator(".r3-stage")).toBeVisible();
  await expect(page.locator(".rack-cab")).toHaveCount(0);
  await expect(scene.locator(".r3-pdu")).toHaveCount(2);
  expect(await devIds(page, ".rack-scene")).toEqual(operate);
  await expect(scene.locator(".r3-pdu-table tbody tr")).toHaveCount(11);
  await expect(page.locator(".scene .inspector.drawer .crumbs")).toContainText("A14");

  // A device in the 3D rack opens its details on the right, and the rack stays 3D.
  await scene.locator('[data-act="rack-view"][data-rack-view="front"]').click();
  await page.waitForTimeout(600);
  await scene.locator('.r3-dev [data-act="floor-server"][data-server="tray-04"]').click();
  await expect(page.locator(".scene .inspector.drawer .crumbs")).toContainText("GPU Tray 04");
  await expect(page.locator(".scene.rack-scene .r3-stage")).toBeVisible();
  await expect(page.locator(".rack-scene .r3-dev.on")).toHaveCount(1);
  await expect(page.locator(".rack-scene .r3-pdu").first().locator('.r3-socket[data-outlet="7"]')).toHaveClass(/mine/);
  expect(errors).toEqual([]);
});

test("a simulated rack in another hall opens in the same 3D view", async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = "#/floor/hall"; });
  await page.evaluate(() => {
    const el = document.querySelector('.rackbox[data-act="floor-rack"][data-rack="A13"]');
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const scene = page.locator(".scene.rack-scene");
  await expect(scene.locator(".r3-stage")).toBeVisible();
  expect(await scene.locator(".r3-dev").count()).toBeGreaterThan(0);
  await expect(scene).toContainText("No rack PDU is recorded on this rack.");
});
