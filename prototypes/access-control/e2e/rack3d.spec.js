const { test, expect } = require("@playwright/test");

async function openRack(page) {
  await page.goto("/");
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator(".who strong")).toHaveText("dsvs.operator");
  await page.locator('.rail [data-act="nav"][data-view="rack"]').click();
  await expect(page.locator(".rack3d")).toBeVisible();
}

test("rack A14 is 3D with its devices and the rack PDU", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await openRack(page);

  // Every racked device is a 3D box, and the PDU has a socket per outlet.
  await expect(page.locator(".r3-world .r3-dev")).toHaveCount(10);
  // Built from the asset repository, the same as the floor drill-down: rPDU-A and
  // rPDU-B on the rear rails, with rPDU-A carrying the 11 live outlets.
  await expect(page.locator(".r3-pdu")).toHaveCount(2);
  await expect(page.locator(".r3-pdu").first().locator(".r3-socket.on")).toHaveCount(11);
  await expect(page.locator(".r3-pdu-table tbody tr")).toHaveCount(11);
  await expect(page.locator(".r3-world")).toHaveAttribute("style", /rotateY\(-42(\.0)?deg\)/);

  // Camera presets turn the rack.
  await page.locator('[data-act="rack-view"][data-rack-view="rear"]').click();
  await expect(page.locator('[data-act="rack-view"][data-rack-view="rear"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".r3-world")).toHaveAttribute("style", /rotateY\(-200(\.0)?deg\)/);

  // Selecting a device marks its outlet on the PDU.
  await page.locator('.r3-pdu-table [data-act="select"][data-device="tray-04"]').click();
  await expect(page.locator(".r3-pdu").first().locator('.r3-socket[data-outlet="7"]')).toHaveClass(/mine/);
  await expect(page.locator('.r3-pdu-table tr[data-outlet="7"]')).toHaveClass(/mine/);
  await expect(page.locator(".detail h3")).toHaveText("GPU Tray 04");
  expect(errors).toEqual([]);
});

test("the PDU shows the leak lock and only navigates to Control", async ({ page }) => {
  await openRack(page);
  await page.evaluate(() => window.AccessDemo.fireEvent("leak-trip", "", { quiet: true, stay: true }));
  await page.evaluate(() => { location.hash = "#/rack/A14/tray-01"; });
  await expect(page.locator(".r3-pdu").first().locator('.r3-socket[data-outlet="1"]')).toHaveClass(/locked/);
  await expect(page.locator(".r3-pdu").first().locator('.r3-socket[data-outlet="2"]')).toHaveClass(/locked/);
  await expect(page.locator('.r3-pdu-table tr[data-outlet="1"]')).toContainText("Locked by DI-1 leak");

  // A socket opens Control on that outlet without changing its power.
  const before = await page.evaluate(() => window.AccessDemo.outlets.map((o) => o.power).join(","));
  await page.locator('[data-act="rack-view"][data-rack-view="rear"]').click();
  await page.waitForTimeout(600);
  await page.locator(".r3-pdu").first().locator('.r3-socket[data-outlet="9"]').click();
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "control");
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/control?outlet=9");
  expect(await page.evaluate(() => window.AccessDemo.outlets.map((o) => o.power).join(","))).toBe(before);
});
