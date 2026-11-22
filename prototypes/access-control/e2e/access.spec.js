const { test, expect } = require("@playwright/test");

const ROLES = [
  { id: "dsvs.operator", role: "Operator" },
  { id: "dsvs.admin", role: "Administrator" },
  { id: "colo.readonly", role: "ReadOnly" },
];

const VIEWS = [
  ["floor", "Outside"],
  ["rack", "Operate · Rack"],
  ["plan", "Plan · Campus"],
  ["audit", "Audit"],
];

async function signIn(page, id) {
  await page.goto("/");
  await page.locator(`[data-user="${id}"]`).click();
  await expect(page.locator(".who strong")).toHaveText(id);
}

function outletRow(page, n) {
  return page.locator("tr", { hasText: new RegExp(`^Outlet ${n}\\b|Outlet ${n} `) }).first();
}

test.describe("sign in and navigation", () => {
  for (const person of ROLES) {
    test(`${person.id} signs in as ${person.role} and opens every view`, async ({ page }) => {
      await signIn(page, person.id);
      await expect(page.locator(".who span")).toHaveText(person.role);
      for (const [view, heading] of VIEWS) {
        await page.locator(`nav [data-view="${view}"]`).click();
        if (view === "floor") await expect(page.locator(".hud-mission")).toContainText("Outside");
        else await expect(page.locator("h1")).toHaveText(heading);
      }
      await expect(page.locator("nav [data-view]")).toHaveCount(4);
      await expect(page.locator(".rack-id")).toHaveCount(0);
      await expect(page.locator('[data-act="simulate"]')).toHaveText("Simulate");
    });
  }
});

test("ReadOnly cannot cycle outlets or mount virtual media", async ({ page }) => {
  await signIn(page, "colo.readonly");
  await page.locator('nav [data-view="rack"]').click();
  await page.locator('.view-tabs [data-view="control"]').click();
  await expect(page.locator(".status")).toContainText("ReadOnly cannot cycle outlets.");
  const cycles = page.locator('[data-op="cycle"]');
  await expect(cycles).toHaveCount(11);
  for (let i = 0; i < 11; i += 1) {
    await expect(cycles.nth(i)).toBeDisabled();
  }
  await expect(page.locator('[data-act="all-outlets"]')).toBeDisabled();

  await page.locator('nav [data-view="rack"]').click();
  await page.locator('.device-view tr[data-path="mpu-kvm"] [data-act="launch"]').first().click();
  await expect(page.locator("h1")).toHaveText("Operate · Sessions");
  await expect(page.locator('.view-tabs [data-view="sessions"]')).toHaveAttribute("aria-current", "page");
  const mount = page.locator('[data-act="mount"]');
  await expect(mount).toBeDisabled();
  await expect(page.locator(".media .reason")).toHaveText("ReadOnly cannot open write-capable KVM virtual media.");
});

test("Operator can cycle a bound outlet and the act is audited", async ({ page }) => {
  const opened = await page.request.post("/api/v1/work-orders", {
    headers: { "X-Dciac-User": "dsvs.admin", "X-Dciac-Role": "Administrator" },
    data: { id: "WO-14", kind: "Power cycle", state: "In progress", title: "Cycle tray-06", deviceId: "tray-06", reason: "WO-14" },
  });
  expect(opened.ok() || opened.status() === 400).toBeTruthy();
  await signIn(page, "dsvs.operator");
  await page.locator('nav [data-view="rack"]').click();
  await page.locator('.view-tabs [data-view="control"]').click();
  const row = outletRow(page, 9);
  await expect(row).toContainText("GPU Tray 06");
  const cycle = row.locator('[data-op="cycle"]');
  await expect(cycle).toBeEnabled();
  await cycle.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("GPU Tray 06");
  await expect(dialog).toContainText("BMC");
  await expect(dialog).toContainText("Live sessions that will drop");
  await dialog.locator("#outlet-short").fill("tray-06");
  await dialog.locator("#outlet-wo").fill("WO-14");
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator(".toast")).toContainText("Cycle Outlet 9 · GPU Tray 06");
  await page.evaluate(() => window.AccessDemo.finishOutletHold());

  await page.locator('nav [data-view="audit"]').click();
  const entry = page.locator("tbody tr", { hasText: "outlet cycle" }).first();
  await expect(entry).toContainText("dsvs.operator");
  await expect(entry).toContainText("GPU Tray 06");
  await expect(entry).toContainText("Outlet 9");
  await expect(entry).toContainText("power before on, after on");
  await expect(entry).toContainText("WO-14");
});

test("dropping a BMC starts the 30s ACS serial failover", async ({ page }) => {
  await signIn(page, "dsvs.operator");
  await page.locator('[data-act="simulate"]').click();
  await expect(page.locator("h1")).toHaveText("Simulate");
  await page.locator("#sim-event").selectOption("bmc-loss");
  await page.locator("#sim-target").selectOption("tray-01");
  await page.locator('[data-act="sim-run"]').click();

  const wait = page.locator('[data-countdown-for="tray-01"]');
  await expect(wait).toBeVisible();
  await expect(wait).toContainText("BMC path lost. Out-of-band serial is coming up on ACS");
  await expect(wait).toContainText("30 seconds");
  const seconds = Number(await wait.locator("[data-countdown-num]").innerText());
  expect(seconds).toBeGreaterThanOrEqual(28);
  expect(seconds).toBeLessThanOrEqual(30);

  await page.evaluate(() => window.AccessDemo.finishFailover("tray-01"));
  await expect(page.locator(".toast")).toContainText("GPU Tray 01 serial is up on ACS.");
  await page.locator('nav [data-view="audit"]').click();
  const ready = page.locator("tbody tr", { hasText: "serial ready" }).first();
  await expect(ready).toContainText("GPU Tray 01");
  await expect(ready).toContainText("ttyS1");
});

test("tripping DI-1 raises the alarm and blocks outlets 1 and 2", async ({ page }) => {
  await signIn(page, "dsvs.operator");
  await page.locator('[data-act="simulate"]').click();
  await page.locator("#sim-event").selectOption("leak-trip");
  await page.locator('[data-act="sim-run"]').click();

  await expect(page.locator("h1")).toHaveText("Operate · Control");
  await expect(page.locator('.view-tabs [data-view="control"]')).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "DI-1 leak alarm" })).toBeVisible();
  await expect(page.locator(".alarm")).toContainText("Outlet 1 (GPU Tray 01) and Outlet 2 (GPU Tray 02)");
  await expect(page.locator(".toast")).toContainText("DI-1 alarm. Suggested control is Outlet 1 and Outlet 2.");
  await expect(page.locator(".alarm-banner")).toContainText("DI-1 leak rope asserted");
  await expect(page.locator(".rail .alarm-note")).toHaveText("DI-1 leak alarm");

  for (const n of [1, 2]) {
    const row = outletRow(page, n);
    await expect(row.locator(".badge.bad")).toHaveText("Suggested");
    await expect(row.locator('[data-op="on"]')).toBeDisabled();
    await expect(row.locator('[data-op="off"]')).toBeDisabled();
    await expect(row.locator('[data-op="cycle"]')).toBeDisabled();
    await expect(page.locator(`.alarm [data-outlet="${n}"]`)).toBeDisabled();
  }
  await expect(page.locator('[data-act="all-outlets"]')).toBeDisabled();
});

test("port 15 and port 16 are refused with their reasons", async ({ page }) => {
  await signIn(page, "dsvs.operator");
  await page.locator('nav [data-view="rack"]').click();
  await page.locator('.view-tabs [data-view="map"]').click();

  await page.locator('.port-cell[data-key="port-15"]').click();
  await expect(page.locator(".toast")).toContainText("Port 15 is not bound to a target. Access refused.");
  await expect(page.locator(".refuse-note")).toHaveText("Port 15 is not bound to a target. Access refused.");

  await page.locator('.port-cell[data-key="port-16"]').click();
  await expect(page.locator(".toast")).toContainText("Target is in rack B07. ACS-A14 launches only inside rack A14.");
  await expect(page.locator(".refuse-note")).toHaveText("Target is in rack B07. ACS-A14 launches only inside rack A14.");
});
