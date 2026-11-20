const { test, expect } = require("@playwright/test");

async function signIn(page) {
  await page.goto("/");
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator(".who strong")).toHaveText("dsvs.operator");
}

const open = (page, id) => page.evaluate((id) => { location.hash = "#/rack/A14/" + id; }, id);
const rows = (page, scope = ".device-view") => page.locator(scope + " .dv-paths tr[data-path]").evaluateAll((els) => els.map((el) => el.dataset.path));
const best = (page, band) => page.locator('.device-view .dv-paths tr.best[data-band="' + band + '"]');

test("a GPU tray shows its ports, the ACS and MPU2 links, and every way in", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await signIn(page);
  await open(page, "tray-01");
  const view = page.locator('.device-view[data-family="gpu"]');
  await expect(view.locator("h3")).toContainText("GB200 NVL72 compute tray");
  await expect(view.locator('.dv-port[data-port-role="serial"]')).toContainText("ACS-A14 port 1 · ttyS1");
  await expect(view.locator('.dv-port[data-port-role="video"]')).toContainText("MPU2 port 1");
  await expect(view.locator(".dv-port", { hasText: "ConnectX-7" })).toContainText("x 4");
  expect(await rows(page)).toEqual(["acs-serial", "mpu-kvm", "bmc", "ssh", "rdp"]);
  await expect(best(page, "oob")).toHaveAttribute("data-path", "acs-serial");
  await expect(best(page, "inband")).toHaveAttribute("data-path", "ssh");

  // Inside a maintenance window, the serial button opens a logged ACS serial session.
  await page.evaluate(() => { location.hash = "#/simulate"; });
  await page.locator('[data-act="maint-toggle"]').click();
  await open(page, "tray-01");
  await view.locator('tr[data-path="acs-serial"] [data-act="launch"]').click();
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "sessions");
  await expect(page.locator(".session .term-path")).toContainText("ttyS1");
  expect(errors).toEqual([]);
});

test("a switch has data and console ports but no KVM, BMC, or RDP", async ({ page }) => {
  await signIn(page);
  await open(page, "sn2201");
  const view = page.locator('.device-view[data-family="switch"]');
  await expect(view.locator("h3")).toContainText("SN2201");
  await expect(view.locator(".dv-port", { hasText: "1GbE x 48" }).locator(".dv-jacks i")).toHaveCount(48);
  await expect(view.locator(".dv-port", { hasText: "100G x 4" })).toContainText("QSFP28");
  await expect(view.locator('.dv-port[data-port-role="serial"]')).toContainText("ACS-A14 port 4");
  expect(await rows(page)).toEqual(["acs-serial", "ssh"]);
  await expect(best(page, "inband")).toContainText("MGT RJ45");
  await expect(view).toContainText("No KVM (no video port), no BMC, no RDP");
});

test("a power shelf is reached by serial and its shelf controller", async ({ page }) => {
  await signIn(page);
  await open(page, "pshelf");
  await expect(page.locator('.device-view[data-family="shelf"] .dv-port', { hasText: "PSU x 6" })).toBeVisible();
  expect(await rows(page)).toEqual(["acs-serial", "shelf-mgmt"]);
});

test("the best path moves when the BMC goes dark or the OS is down", async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => window.AccessDemo.fireEvent("bmc-loss", "tray-06", { quiet: true, stay: true }));
  await open(page, "tray-06");
  await expect(page.locator('.device-view tr[data-path="bmc"]')).toContainText("BMC dark");
  await expect(page.locator('.device-view tr[data-path="bmc"] [data-act="launch"]')).toHaveCount(0);
  await expect(best(page, "oob")).toHaveAttribute("data-path", "acs-serial");

  await page.evaluate(() => window.AccessDemo.breakBoot("tray-05"));
  await open(page, "tray-05");
  await expect(page.locator('.device-view tr[data-path="ssh"]')).toContainText("No OS running");
  await expect(best(page, "inband")).toHaveCount(0);
  await expect(best(page, "oob")).toHaveAttribute("data-path", "acs-serial");
});

test("the floor shows the same device view as Operate", async ({ page }) => {
  await signIn(page);
  await open(page, "tray-02");
  const operate = await rows(page);
  await page.evaluate(() => { location.hash = "#/floor/hall"; });
  await page.evaluate(() => document.querySelector('.rackbox[data-act="floor-rack"][data-rack="A14"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await expect(page.locator(".rack-scene .r3-pdu")).toHaveCount(2);
  await page.locator('.rack-scene [data-act="rack-view"][data-rack-view="front"]').click();
  await page.waitForTimeout(600);
  await page.locator('.rack-scene .r3-bezel[data-server="tray-02"]').click();
  const floorView = ".inspector .device-view";
  await expect(page.locator(floorView)).toBeVisible();
  expect(await rows(page, floorView)).toEqual(operate);
});
