const { test, expect } = require("@playwright/test");

// Post readings tells the server each BMC's state and the RM1048 plane, so /actions/outlet
// can apply the RM1048 ownership rule. The request is answered here so no reading reaches
// the shared database the other specs use.
test("Post readings sends BMC and RM1048 plane state", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator(".who strong")).toHaveText("dsvs.operator");
  let sent = null;
  await page.route("**/api/v1/collect", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ source: "lab", alarms: [] }) });
  });
  await page.locator('[data-act="simulate"]').click();
  await expect(page.locator("h1")).toHaveText("Simulate");
  await page.locator('[data-act="lab-post"]').click();
  await expect(page.locator(".toast")).toContainText("Lab posted");
  const value = (deviceId, name) => {
    const row = sent.samples.find((s) => s.deviceId === deviceId && s.name === name);
    return row ? row.value : undefined;
  };
  const bmc = await page.evaluate(() => Object.fromEntries(window.AccessDemo.devices.map((d) => [d.id, d.bmc])));
  for (const [id, state] of Object.entries(bmc)) {
    expect(value(id, "bmc"), id).toBe(state === "up" ? 1 : 0);
  }
  expect(bmc["tray-06"]).toBe("down");
  expect(value("rm1048", "plane")).toBe(1);
});
