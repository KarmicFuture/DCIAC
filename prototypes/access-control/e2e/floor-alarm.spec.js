const { test, expect } = require("@playwright/test");

const rackRowName = /^(Nominal|Rise|Hot|RDP|BMC) .*\d+ devices$/;

async function signInFloorSite(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/floor", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
  const chip = page.locator(".alarm-chip");
  await expect(chip).toHaveText(/P1 · \d+/);
  return chip;
}

async function activeInDrawer(page) {
  return page.evaluate(() => {
    const drawer = document.getElementById("floor-detail");
    if (!drawer) return false;
    const active = document.activeElement;
    return active === drawer || drawer.contains(active);
  });
}

async function expandAndFocusShowOnFloor(page, row) {
  const summary = row.locator('summary[data-act="alarm-focus"]');
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(row.locator('[data-act="alarm-floor"]')).toBeVisible();
  const floorBtn = row.locator('[data-act="alarm-floor"]');
  for (let i = 0; i < 4; i += 1) {
    if (await floorBtn.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(floorBtn).toBeFocused();
  return floorBtn;
}

async function activateShowOnFloor(page, row) {
  const floorBtn = await expandAndFocusShowOnFloor(page, row);
  const scrollY = await page.evaluate(() => window.scrollY);
  const sceneScroll = await page.locator(".scene").evaluate((el) => el.scrollTop);
  await page.keyboard.press("Enter");
  const pulse = page.locator(".rackbox.is-pulse");
  await expect(pulse).toHaveCount(1);
  const rackId = await pulse.getAttribute("data-rack");
  const drawer = page.locator("#floor-detail");
  await expect(page.locator(".hud-mission")).toHaveText(/Hall \d+/);
  await expect(page.locator("#floor-list-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { level: 2 })).toHaveText(/^Hall \d+$/);
  const rackRow = drawer.locator('[data-act="floor-rack"][data-rack="' + rackId + '"]');
  await expect(rackRow).toBeFocused();
  await expect(rackRow).toHaveAccessibleName(rackRowName);
  const outline = await rackRow.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
  const inView = await page.evaluate((id) => {
    const drawerEl = document.getElementById("floor-detail");
    const rowEl = drawerEl && drawerEl.querySelector('[data-act="floor-rack"][data-rack="' + id + '"]');
    if (!drawerEl || !rowEl) return false;
    const dr = drawerEl.getBoundingClientRect();
    const rr = rowEl.getBoundingClientRect();
    return rr.top >= dr.top && rr.bottom <= dr.bottom;
  }, rackId);
  expect(inView).toBeTruthy();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  expect(await page.locator(".scene").evaluate((el) => el.scrollTop)).toBe(sceneScroll);
  return { rackId, row, floorBtn };
}

test("Show on floor button presence and naming", async ({ page }) => {
  const chip = await signInFloorSite(page);
  await chip.click();
  const rows = page.locator(".alarm-list > .alarm-row");
  const count = await rows.count();
  let anyFloor = false;
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const floorBtns = row.locator('[data-act="alarm-floor"]');
    expect(await floorBtns.count()).toBeLessThanOrEqual(1);
    if ((await floorBtns.count()) === 1) {
      anyFloor = true;
      const asset = await row.locator("summary b").innerText();
      await expect(floorBtns).toHaveAttribute("aria-label", "Show on floor · " + asset);
    }
  }
  expect(anyFloor).toBeTruthy();
  await expect(page.locator('.alarm-list summary [data-act="alarm-floor"]')).toHaveCount(0);

  await page.goto("/#/sessions", { waitUntil: "domcontentloaded" });
  await page.locator(".alarm-chip").click();
  await expect(page.locator('[data-act="alarm-floor"]')).toHaveCount(0);
});

test("Show on floor: keyboard to List rack row and escape", async ({ page }) => {
  test.setTimeout(90000);
  const chip = await signInFloorSite(page);
  await chip.click();

  const row = page.locator('.alarm-row:has([data-act="alarm-floor"])').first();
  const hadUnacked = await row.evaluate((el) => el.classList.contains("unacked"));

  const { rackId } = await activateShowOnFloor(page, row);

  await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
  if (await page.locator(".inspector").count() > 0) await page.keyboard.press("Escape");
  await expect(page.locator("#floor-list-toggle")).toHaveAttribute("aria-expanded", "false");
  await page.locator(".alarm-chip").click();
  const rowAgain = page.locator('.alarm-row:has([data-act="alarm-floor"])').first();
  const { rackId: rackId2 } = await activateShowOnFloor(page, rowAgain);
  expect(rackId2).toBe(rackId);

  const drawer = page.locator("#floor-detail");
  const rackRow = drawer.locator('[data-act="floor-rack"][data-rack="' + rackId + '"]');
  await rackRow.focus();
  await page.keyboard.press("Enter");
  await expect(drawer.locator(".crumbs")).toContainText(rackId);
  await expect(drawer.locator('[data-act="rack-positions"]')).toBeVisible({ timeout: 10000 });
  await expect.poll(() => activeInDrawer(page), { timeout: 1000 }).toBeTruthy();

  await page.goto("/#/floor", { waitUntil: "domcontentloaded" });
  await page.locator(".alarm-chip").click();
  const freshRow = page.locator('.alarm-row:has([data-act="alarm-floor"])').first();
  await activateShowOnFloor(page, freshRow);
  await page.keyboard.press("Escape");
  await expect(page.locator(".inspector")).toHaveCount(0);
  const toggle = page.locator("#floor-list-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();

  await page.locator(".alarm-chip").click();
  const checkRow = page.locator('.alarm-row:has([data-act="alarm-floor"])').first();
  if (hadUnacked) await expect(checkRow).toHaveClass(/unacked/);
});