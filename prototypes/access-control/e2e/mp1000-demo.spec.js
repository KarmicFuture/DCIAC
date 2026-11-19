const { test, expect } = require("@playwright/test");

async function fresh(page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await page.waitForFunction(() => window.AccessDemo && typeof window.AccessDemo.startMp1000Demo === "function");
}

const caption = (page) => page.locator("#demo-caption");
const next = (page) => page.evaluate(() => window.AccessDemo.advanceDemo());

test("MP1000 KVM demo: device list, launch, RM1048 path, HTML5 viewer, audited", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await fresh(page);
  await page.evaluate(() => window.AccessDemo.setDemoPauseMs(60000));
  await page.locator('.login-wrap [data-act="demo-mp1000"]').click();
  await expect(page.locator(".demo-tour")).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".shell")).toHaveAttribute("data-demo", "mp1000");
  await expect(page.locator(".demo-kicker")).toContainText("MP1000 KVM demo · 1 of 9");
  await expect(caption(page)).toContainText("RM1048");

  // 2-3: the MP1000 device list, with GPU Tray 02 ready.
  await next(page);
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "sessions");
  const row = page.locator('.mp1000-panel tr[data-device="tray-02"]');
  await expect(row).toContainText("GPU Tray 02");
  await expect(row).toContainText("Ready");
  await next(page);
  await expect(caption(page)).toContainText("maintenance window");
  expect(await page.evaluate(() => window.AccessDemo.state.maintenance && window.AccessDemo.state.maintenance.name)).toBe("Rack A14 KVM access");
  await next(page);
  await expect(caption(page)).toContainText("Launch KVM");

  // 4: MP1000 launches a KVM session through RM1048.
  await next(page);
  const card = page.locator(".session.kvm");
  await expect(card).toBeVisible();
  await expect(card.locator("h3")).toHaveText("MP1000 · KVM");
  await expect(card.locator(".uri")).toContainText("/redfish/v1/Managers/RMC/GraphicalConsole/Tray-02");
  await expect(card).toContainText("brokered this HTML5 session through the RM1048");

  // 5-6: the HTML5 viewer, then BIOS in the same session.
  await next(page);
  await expect(card.locator(".bios")).toContainText("Ubuntu 24.04");
  await next(page);
  await expect(card.locator(".bios")).toContainText("Boot mode");

  // 7: the audit has the launch and the session.
  await next(page);
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "audit");
  await expect(page.locator(".view")).toContainText("MP1000 KVM request");
  await expect(page.locator(".view")).toContainText("launched from MP1000");

  // 9 and stop: sessions and the window are closed again.
  await next(page);
  await next(page);
  await expect(page.locator(".demo-tour")).toHaveCount(0);
  expect(await page.evaluate(() => ({ sessions: window.AccessDemo.state.sessions.length, window: !!window.AccessDemo.state.maintenance })))
    .toEqual({ sessions: 0, window: false });
  expect(errors).toEqual([]);
});

test("MP1000 list keeps the console gates: dark BMC goes to ACS, no window means no session", async ({ page }) => {
  await fresh(page);
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator(".who strong")).toHaveText("dsvs.operator");
  await page.evaluate(() => window.AccessDemo.fireEvent("bmc-loss", "tray-06", { quiet: true, stay: true }));
  await page.evaluate(() => { location.hash = "#/sessions"; });
  const dark = page.locator('.mp1000-panel tr[data-device="tray-06"]');
  await expect(dark).toContainText("BMC dark. Use ACS KVM.");
  await expect(dark.locator('[data-act="mp1000-kvm"]')).toBeDisabled();

  // With no window or work order, the console check refuses the launch.
  const launch = page.locator('.mp1000-panel tr[data-device="tray-03"] [data-act="mp1000-kvm"]');
  await launch.click();
  await expect(page.locator(".toast")).toContainText("work order");
  await expect(page.locator(".session.kvm")).toHaveCount(0);

  // Inside a maintenance window the same click opens the session.
  await page.evaluate(() => { location.hash = "#/simulate"; });
  await page.locator('[data-act="maint-toggle"]').click();
  await page.evaluate(() => { location.hash = "#/sessions"; });
  await launch.click();
  await expect(page.locator(".session.kvm h3")).toHaveText("MP1000 · KVM");
  await expect(page.locator(".session.kvm .uri")).toContainText("GraphicalConsole/Tray-03");
});
