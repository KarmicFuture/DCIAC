const { test, expect } = require("@playwright/test");

async function signIn(page, who = "dsvs.operator") {
  await page.goto("/");
  await page.locator('[data-user="' + who + '"]').click();
  await expect(page.locator(".who strong")).toHaveText(who);
}

test("drilling into rack A14 from the floor shows it in 3D with live rack PDUs", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await signIn(page);
  await page.evaluate(() => { location.hash = "#/floor/pod-a/A14"; });
  const scene = page.locator(".elev-scene.is-3d");
  await expect(scene).toBeVisible();
  await expect(scene.locator('[data-act="elev-3d"][data-mode="3d"]')).toHaveAttribute("aria-pressed", "true");

  // Every mounted device is a box at its U, and both 0U rack PDUs are on the rear rails.
  await expect(scene.locator(".r3-dev")).toHaveCount(10);
  await expect(scene.locator(".r3-pdu")).toHaveCount(2);
  const pduA = scene.locator('.r3-pdu:has(.r3-pdu-name:text-is("rPDU-A"))');
  await expect(pduA.locator(".r3-socket")).toHaveCount(24);
  await expect(pduA.locator(".r3-socket.on")).toHaveCount(11);
  expect(await scene.locator(".r3-world").innerText()).not.toMatch(/Geist|Vertiv|Avocent/);

  // The leak interlock shows on the live PDU.
  await page.evaluate(() => window.AccessDemo.fireEvent("leak-trip", "", { quiet: true, stay: true }));
  await page.evaluate(() => { location.hash = "#/floor/pod-a/A14"; });
  await expect(pduA.locator('.r3-socket[data-outlet="1"]')).toHaveClass(/locked/);

  // Rear view, then a lit socket opens Control on that outlet.
  await scene.locator('[data-act="rack-view"][data-rack-view="rear"]').click();
  await page.waitForTimeout(600);
  await pduA.locator('.r3-socket[data-outlet="7"]').click();
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "control");
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/control?outlet=7");
  expect(errors).toEqual([]);
});

test("a device box opens the server, and 2D brings back the editable elevation", async ({ page }) => {
  await signIn(page, "dsvs.admin");
  await page.evaluate(() => { location.hash = "#/floor/pod-a/A14"; });
  const scene = page.locator(".elev-scene.is-3d");
  await expect(scene).toBeVisible();
  await scene.locator('[data-act="rack-view"][data-rack-view="front"]').click();
  await page.waitForTimeout(600);
  await scene.locator('.r3-dev[data-dev] [data-act="elev-device"][data-tag="tray-03"]').click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/floor/pod-a/A14/tray-03");

  await page.evaluate(() => { location.hash = "#/floor/pod-a/A14"; });
  await page.locator('[data-act="elev-3d"][data-mode="2d"]').click();
  await expect(page.locator(".elev-scene .elev-grid")).toBeVisible();
  await expect(page.locator('.elev-scene [data-act="elev-png"]')).toBeVisible();
  await expect(page.locator(".elev-scene .r3-stage")).toHaveCount(0);
});

test("an empty rack in another hall shows an empty 3D cabinet", async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = "#/floor/hall-10/H10-01"; });
  const scene = page.locator(".elev-scene.is-3d");
  await expect(scene).toBeVisible();
  await expect(scene.locator(".r3-dev")).toHaveCount(0);
  await expect(scene).toContainText("No rack PDU is recorded on this rack.");
});
