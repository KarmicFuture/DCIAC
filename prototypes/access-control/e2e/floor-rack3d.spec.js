const { test, expect } = require("@playwright/test");

async function signIn(page, who = "dsvs.operator") {
  await page.goto("/");
  await page.locator('[data-user="' + who + '"]').click();
  await expect(page.locator(".who strong")).toHaveText(who);
}

test("a rack link opens the 3D rack view with live rack PDUs", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await signIn(page);
  await page.evaluate(() => { location.hash = "#/floor/pod-a/A14"; });
  const scene = page.locator(".scene.rack-scene");
  await expect(scene.locator(".r3-pdu")).toHaveCount(2);
  await expect(page.locator(".scene .inspector.drawer .crumbs")).toContainText("A14");

  // Every mounted device is a box at its U, and both 0U rack PDUs are on the rear rails.
  await expect(scene.locator(".r3-dev")).toHaveCount(10);
  const pduA = scene.locator('.r3-pdu:has(.r3-pdu-name:text-is("rPDU-A"))');
  await expect(pduA.locator(".r3-socket")).toHaveCount(24);
  await expect(pduA.locator(".r3-socket.on")).toHaveCount(11);
  expect(await scene.locator(".r3-world").innerText()).not.toMatch(/Geist|Vertiv|Avocent/);

  // The leak interlock shows on the live PDU.
  await page.evaluate(() => window.AccessDemo.fireEvent("leak-trip", "", { quiet: true, stay: true }));
  await expect(pduA.locator('.r3-socket[data-outlet="1"]')).toHaveClass(/locked/);

  // Rear view, then a lit socket opens Control on that outlet.
  await scene.locator('[data-act="rack-view"][data-rack-view="rear"]').click();
  await page.waitForTimeout(600);
  await pduA.locator('.r3-socket[data-outlet="7"]').click();
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "control");
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/control?outlet=7");
  expect(errors).toEqual([]);
});

test("a device link opens the rack with that device's details, and /u is the U positions editor", async ({ page }) => {
  await signIn(page, "dsvs.admin");
  await page.evaluate(() => { location.hash = "#/floor/pod-a/A14/tray-03"; });
  await expect(page.locator(".scene.rack-scene .r3-dev.on")).toHaveCount(1);
  await expect(page.locator(".scene .inspector.drawer .device-view")).toBeVisible();

  await page.locator('[data-act="floor-go"][data-level="rack"]').click();
  await page.locator('[data-act="rack-positions"]').click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/floor/pod-a/A14/u");
  await expect(page.locator(".elev-scene .elev-grid")).toBeVisible();
  await expect(page.locator('.elev-scene [data-act="elev-png"]')).toBeVisible();

  // The editor can show the same 3D rack, and goes back to the rack view.
  await page.locator('[data-act="elev-3d"][data-mode="3d"]').click();
  await expect(page.locator(".elev-scene.is-3d .r3-stage")).toBeVisible();
  await page.locator('[data-act="elev-chassis"]').click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/floor/pod-a/A14");
  await expect(page.locator(".scene.rack-scene .r3-stage")).toBeVisible();
});

test("a rack with nothing in the repository shows its simulated servers in 3D", async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = "#/floor/hall-10/H10-01"; });
  const scene = page.locator(".scene.rack-scene");
  await expect(scene.locator(".r3-stage")).toBeVisible();
  expect(await scene.locator(".r3-dev").count()).toBeGreaterThan(0);
  await expect(scene).toContainText("No rack PDU is recorded on this rack.");
});
