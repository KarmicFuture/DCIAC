const { test, expect } = require("@playwright/test");

const rackRowName = /^(Nominal|Rise|Hot|RDP|BMC) .*\d+ devices$/;

async function signInSessions(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/sessions", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator("#app")).not.toContainText("Loading the asset repository");
  const chip = page.locator(".alarm-chip");
  await expect(chip).toHaveText(/P1 · \d+/);
  return chip;
}

async function openAlarmBanner(page) {
  const list = page.locator(".alarm-list");
  const chip = page.locator(".alarm-chip");
  if (!(await list.isVisible())) await chip.click();
  await expect(list).toBeVisible();
}

async function rackAlarmRow(page) {
  return page.locator('.alarm-row:has([data-act="alarm-floor"])').first();
}

async function expandAndFocusShowOnFloor(page, row) {
  const summary = row.locator('summary[data-act="alarm-focus"]');
  const floorBtn = row.locator('[data-act="alarm-floor"]');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await summary.focus();
    await page.keyboard.press("Enter");
    if (await floorBtn.isVisible()) break;
  }
  await expect(floorBtn).toBeVisible();
  for (let i = 0; i < 4; i += 1) {
    if (await floorBtn.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(floorBtn).toBeFocused();
  const outline = await floorBtn.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
  return floorBtn;
}

async function jumpShowOnFloor(page, row) {
  const floorBtn = await expandAndFocusShowOnFloor(page, row);
  await page.keyboard.press("Enter");
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "floor");
  const pulse = page.locator(".rackbox.is-pulse");
  await expect(pulse).toHaveCount(1);
  const rackId = await pulse.getAttribute("data-rack");
  await expect(page.locator(".hud-mission")).toHaveText(/Hall \d+/);
  const toggle = page.locator("#floor-list-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const drawer = page.locator("#floor-detail");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { level: 2 })).toHaveText(/^Hall \d+$/);
  const rackRow = drawer.locator('[data-act="floor-rack"][data-rack="' + rackId + '"]');
  await expect.poll(() => rackRow.evaluate((el) => el === document.activeElement), { timeout: 1000 }).toBeTruthy();
  await expect(rackRow).toHaveAccessibleName(rackRowName);
  const rowOutline = await rackRow.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(rowOutline).not.toBe("none");
  const inView = await page.evaluate((id) => {
    const drawerEl = document.getElementById("floor-detail");
    const rowEl = drawerEl && drawerEl.querySelector('[data-act="floor-rack"][data-rack="' + id + '"]');
    if (!drawerEl || !rowEl) return false;
    const dr = drawerEl.getBoundingClientRect();
    const rr = rowEl.getBoundingClientRect();
    return rr.top >= dr.top && rr.bottom <= dr.bottom;
  }, rackId);
  expect(inView).toBeTruthy();
  await expect(page).toHaveURL(/#\/floor\/hall$/);
  return { rackId, floorBtn };
}

test("Show on floor jumps to floor from any signed-in screen", async ({ page }) => {
  test.setTimeout(120000);
  const chip = await signInSessions(page);
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "sessions");

  await openAlarmBanner(page);
  const rows = page.locator(".alarm-list > .alarm-row");
  const count = await rows.count();
  let anyFloor = false;
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const floorBtns = row.locator('[data-act="alarm-floor"]');
    expect(await floorBtns.count()).toBeLessThanOrEqual(1);
    if ((await floorBtns.count()) === 1) {
      anyFloor = true;
      await expect(floorBtns).toHaveRole("button");
      await expect(floorBtns).toHaveText("Show on floor");
      const asset = await row.locator("summary b").innerText();
      await expect(floorBtns).toHaveAttribute("aria-label", "Show on floor · " + asset);
      const parentClass = await floorBtns.evaluate((el) => el.parentElement && el.parentElement.className);
      expect(parentClass).toContain("alarm-extra");
    }
  }
  expect(anyFloor).toBeTruthy();
  await expect(page.locator('.alarm-list summary [data-act="alarm-floor"]')).toHaveCount(0);

  const row = await rackAlarmRow(page);
  const hadUnacked = await row.evaluate((el) => el.classList.contains("unacked"));

  const { rackId } = await jumpShowOnFloor(page, row);

  if (hadUnacked) {
    await openAlarmBanner(page);
    const checkRow = page.locator('.alarm-row:has([data-act="alarm-floor"])').first();
    await expect(checkRow).toHaveClass(/unacked/);
  }

  await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
  if (await page.locator(".inspector").count() > 0) await page.keyboard.press("Escape");
  await expect(page.locator("#floor-list-toggle")).toHaveAttribute("aria-expanded", "false");
  await openAlarmBanner(page);
  const rowOnFloor = await rackAlarmRow(page);
  const { rackId: rackIdFromFloor } = await jumpShowOnFloor(page, rowOnFloor);
  expect(rackIdFromFloor).toBe(rackId);

  await page.goto("/#/sessions", { waitUntil: "domcontentloaded" });
  await openAlarmBanner(page);
  const rowForEscape = await rackAlarmRow(page);
  await jumpShowOnFloor(page, rowForEscape);
  await page.keyboard.press("Escape");
  await expect(page.locator(".inspector")).toHaveCount(0);
  const toggle = page.locator("#floor-list-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();

  await page.goto("/#/sessions", { waitUntil: "domcontentloaded" });
  await openAlarmBanner(page);
  const rowForBack = await rackAlarmRow(page);
  await jumpShowOnFloor(page, rowForBack);
  await page.goBack();
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "sessions");
  await expect(page).toHaveURL(/#\/sessions$/);

  await page.goto("/#/fleet", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "fleet");
  await openAlarmBanner(page);
  const fleetRow = await rackAlarmRow(page);
  await jumpShowOnFloor(page, fleetRow);
});