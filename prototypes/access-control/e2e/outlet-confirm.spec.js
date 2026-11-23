const { test, expect } = require("@playwright/test");

async function signIn(page) {
  await page.goto("/");
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator(".who strong")).toHaveText("dsvs.operator");
}

function outletRow(page, n) {
  return page.getByRole("row", { name: new RegExp(`^Outlet ${n}\\b`) });
}

async function goControl(page) {
  await page.locator('nav [data-view="rack"]').click();
  await page.locator('.view-tabs [data-view="control"]').click();
  await expect(page.locator("h1")).toHaveText("Operate · Control");
}

async function openMaintenance(page) {
  await page.locator('[data-act="simulate"]').click();
  await expect(page.locator("h1")).toHaveText("Simulate");
  const isOpen = await page.evaluate(() => !!window.AccessDemo.state.maintenance);
  if (!isOpen) {
    await page.locator("#maint-name").fill("Rack A14 outlet maintenance");
    await page.locator('[data-act="maint-toggle"]').click();
  }
  expect(await page.evaluate(() => !!window.AccessDemo.state.maintenance)).toBe(true);
}

async function ensureWorkOrder(page) {
  const opened = await page.request.post("/api/v1/work-orders", {
    headers: { "X-Dciac-User": "dsvs.admin", "X-Dciac-Role": "Administrator" },
    data: { id: "WO-14", kind: "Power cycle", state: "In progress", title: "Cycle tray-06", deviceId: "tray-06", reason: "WO-14" },
  });
  expect(opened.ok() || opened.status() === 400).toBeTruthy();
}

async function outlineVisible(page) {
  return page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== "none");
}

test.describe("outlet confirmation dialog", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await goControl(page);
  });

  test("1 — initial focus lands on work order", async ({ page }) => {
    await outletRow(page, 9).locator('[data-op="cycle"]').click();
    await expect(page.getByRole("dialog", { name: "Cycle Outlet 9" })).toBeVisible();
    await expect(page.locator("#outlet-wo")).toBeFocused();
    expect(await outlineVisible(page)).toBeTruthy();
  });

  test("2 — without fields, focus lands on Cancel", async ({ page }) => {
    await openMaintenance(page);
    await goControl(page);
    const row = outletRow(page, 6);
    await expect(row.locator('[data-op="cycle"]')).toBeEnabled();
    await row.locator('[data-op="cycle"]').click();
    await expect(page.getByRole("dialog", { name: "Cycle Outlet 6" })).toBeVisible();
    await expect(page.locator("#outlet-wo")).toHaveCount(0);
    await expect(page.locator("#outlet-short")).toHaveCount(0);
    await expect(page.locator("#outlet-cancel")).toBeFocused();
  });

  test("3 — dialog lives outside the toast live region", async ({ page }) => {
    await outletRow(page, 9).locator('[data-op="cycle"]').click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator('[data-slot="toast"] [role="dialog"]')).toHaveCount(0);
    await expect(page.locator('[aria-live] [role="dialog"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="confirm"] [role="dialog"]')).toHaveCount(1);
  });

  test("4 — background is inert while open", async ({ page }) => {
    await outletRow(page, 9).locator('[data-op="cycle"]').click();
    const inert = async () => page.evaluate(() => ({
      main: document.querySelector("main#content")?.hasAttribute("inert"),
      rail: document.querySelector("nav")?.hasAttribute("inert"),
      skip: document.querySelector("a.skip")?.hasAttribute("inert"),
      confirm: document.querySelector('[data-slot="confirm"]')?.hasAttribute("inert"),
    }));
    const open = await inert();
    expect(open.main).toBe(true);
    expect(open.rail).toBe(true);
    expect(open.skip).toBe(true);
    expect(open.confirm).toBe(false);
    await page.locator("#outlet-cancel").click();
    const closed = await inert();
    expect(closed.main).toBe(false);
    expect(closed.rail).toBe(false);
    expect(closed.skip).toBe(false);
  });

  test("5 — Tab is contained inside the card", async ({ page }) => {
    await outletRow(page, 9).locator('[data-op="cycle"]').click();
    await expect(page.locator("#outlet-wo")).toBeFocused();
    const ids = ["outlet-short", "outlet-cancel", "outlet-confirm", "outlet-wo"];
    for (const id of ids) {
      await page.keyboard.press("Tab");
      await expect(page.locator("#" + id)).toBeFocused();
      const inside = await page.evaluate(() => !!document.activeElement.closest(".confirm-card"));
      expect(inside).toBe(true);
      expect(await outlineVisible(page)).toBeTruthy();
    }
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator("#outlet-confirm")).toBeFocused();
  });

  test("6 — Escape from a field cancels without changing power", async ({ page }) => {
    await outletRow(page, 9).locator('[data-op="cycle"]').click();
    await page.locator("#outlet-wo").fill("WO-draft");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(outletRow(page, 9).getByRole("cell").nth(2)).toHaveText("On");
    await page.locator('nav [data-view="audit"]').click();
    await expect(page.locator("tbody tr", { hasText: "outlet cycle" })).toHaveCount(0);
  });

  test("7 — focus returns to the opener", async ({ page }) => {
    await outletRow(page, 9).locator('[data-op="cycle"]').click();
    await page.keyboard.press("Escape");
    await expect(page.locator("#outlet-9-cycle")).toBeFocused();

    await page.locator("#outlet-9-cycle").click();
    await page.locator("#outlet-cancel").click();
    await expect(page.locator("#outlet-9-cycle")).toBeFocused();

    await page.locator('[data-act="simulate"]').click();
    await page.locator("#sim-event").selectOption("leak-trip");
    await page.locator('[data-act="sim-run"]').click();
    await openMaintenance(page);
    await goControl(page);
    await page.locator("#leak-shed-1").click();
    await expect(page.getByRole("dialog", { name: "Turn off Outlet 1" })).toBeVisible();
    await page.locator("#outlet-cancel").click();
    await expect(page.locator("#leak-shed-1")).toBeFocused();
  });

  test("8 — validation errors keep focus inside", async ({ page }) => {
    await outletRow(page, 9).locator('[data-op="cycle"]').click();
    await page.locator("#outlet-confirm").click();
    await expect(page.getByRole("alert")).toHaveText("A work order number is required outside a maintenance window.");
    await expect(page.locator("#outlet-wo")).toBeFocused();

    await page.locator("#outlet-wo").fill("WO-14");
    await page.locator("#outlet-confirm").click();
    await expect(page.getByRole("alert")).toHaveText("Type the device short name tray-06 to confirm.");
    await expect(page.locator("#outlet-short")).toBeFocused();
  });

  test("9 — busy feedback blocks a second request", async ({ page }) => {
    await ensureWorkOrder(page);
    let hits = 0;
    await page.route("**/api/v1/actions/outlet", async (route) => {
      hits += 1;
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });
    await goControl(page);
    await outletRow(page, 9).locator('[data-op="cycle"]').click();
    await page.locator("#outlet-short").fill("tray-06");
    await page.locator("#outlet-wo").fill("WO-14");
    const confirm = page.locator("#outlet-confirm");
    await confirm.click();
    await expect(confirm).toHaveText("Confirming…");
    await expect(confirm).toHaveAttribute("aria-busy", "true");
    await expect(confirm).toHaveAttribute("aria-disabled", "true");
    await confirm.click({ force: true });
    await expect.poll(() => hits).toBe(1);
  });

  test("10 — success focuses Undo and Enter undoes", async ({ page }) => {
    await ensureWorkOrder(page);
    await goControl(page);
    await outletRow(page, 9).locator('[data-op="cycle"]').click();
    await page.locator("#outlet-short").fill("tray-06");
    await page.locator("#outlet-wo").fill("WO-14");
    await page.locator("#outlet-confirm").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".toast")).toContainText("Cycle Outlet 9 · GPU Tray 06");
    await expect(page.locator(".toast")).toContainText("Undo within");
    await expect(page.locator("#outlet-undo")).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator("#outlet-undo")).toBeFocused();
    expect(await outlineVisible(page)).toBeTruthy();
    await page.keyboard.press("Enter");
    await expect(page.locator(".toast")).toContainText("Outlet change undone. Power was not changed.");
    await expect(page.locator("#outlet-9-cycle")).toBeFocused();
  });

  test("11 — commit restores focus when Undo was focused", async ({ page }) => {
    await ensureWorkOrder(page);
    await goControl(page);
    await outletRow(page, 9).locator('[data-op="cycle"]').click();
    await page.locator("#outlet-short").fill("tray-06");
    await page.locator("#outlet-wo").fill("WO-14");
    await page.locator("#outlet-confirm").click();
    await expect(page.locator("#outlet-undo")).toBeFocused();
    await page.evaluate(() => window.AccessDemo.finishOutletHold());
    await expect(page.locator("#outlet-9-cycle")).toBeFocused();
    await expect(page.evaluate(() => document.activeElement.tagName)).not.toBe("BODY");
  });
});