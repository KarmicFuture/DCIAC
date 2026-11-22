const { test, expect } = require("@playwright/test");

async function signInFloor(page, hash = "/#/floor/hall") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(hash, { waitUntil: "domcontentloaded" });
  const user = page.locator('[data-user="dsvs.operator"]');
  if (await user.count()) await user.click();
  await expect(page.locator("#app")).not.toContainText("Loading the asset repository");
}

async function activeInDrawer(page) {
  return page.evaluate(() => {
    const drawer = document.getElementById("floor-detail");
    if (!drawer) return false;
    const active = document.activeElement;
    return active === drawer || drawer.contains(active);
  });
}

async function openHallListDrawer(page) {
  const toggle = page.locator("#floor-list-toggle");
  await toggle.focus();
  await page.keyboard.press("Enter");
  const drawer = page.locator("#floor-detail");
  await expect(drawer).toBeVisible();
  await expect(drawer).toBeFocused();
  await expect(drawer.getByRole("heading", { name: "Hall 1" })).toBeVisible();
  return drawer;
}

async function focusOverviewViaTab(page, drawer) {
  const overviewBtn = drawer.locator('[data-act="floor-overview"]');
  for (let i = 0; i < 4; i += 1) {
    if (await overviewBtn.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(overviewBtn).toBeFocused();
  return overviewBtn;
}

test("keyboard Open Hall overview from hall list", async ({ page }) => {
  await signInFloor(page);
  let drawer = await openHallListDrawer(page);

  const overviewBtn = drawer.locator('[data-act="floor-overview"]');
  await expect(overviewBtn).toHaveCount(1);
  await expect(overviewBtn).toHaveAccessibleName("Open Hall 1 overview");
  await expect(overviewBtn).toHaveAttribute("data-pod", "pod-a");
  const beforeRacks = await page.evaluate(() => {
    const btn = document.querySelector('#floor-detail [data-act="floor-overview"]');
    const h3 = [...document.querySelectorAll("#floor-detail h3")].find((h) => h.textContent.trim() === "Racks");
    if (!btn || !h3) return false;
    return Boolean(btn.compareDocumentPosition(h3) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(beforeRacks).toBe(true);

  await signInFloor(page, "/#/floor");
  await page.locator("#floor-list-toggle").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-act="floor-overview"]')).toHaveCount(0);
  await page.keyboard.press("Escape");

  await signInFloor(page);
  drawer = await openHallListDrawer(page);

  const overview = await focusOverviewViaTab(page, drawer);
  const btnOutline = await overview.evaluate((el) => window.getComputedStyle(el).outlineStyle);
  expect(btnOutline).not.toBe("none");

  await page.keyboard.press("Enter");
  await expect(drawer).toBeVisible();
  await expect(page.locator(".inspector")).toHaveCount(1);
  await expect(drawer.locator('.crumbs [data-act="floor-go"][data-level="pod"]')).toHaveText("Hall 1");
  await expect(drawer.getByRole("heading", { name: "Hall 1", level: 2 })).toBeVisible();
  for (const name of ["Rows", "Racks", "Infrastructure", "Nearing capacity"]) {
    await expect(drawer.getByRole("heading", { name, level: 3 })).toBeVisible();
  }
  await expect(drawer.locator('[data-act="floor-row"]')).not.toHaveCount(0);
  await expect(drawer.locator('[data-act="floor-rack"]')).toHaveCount(20);
  const nearingState = await drawer.evaluate(() => {
    const h = [...document.querySelectorAll("#floor-detail h3")].find((el) => el.textContent.trim() === "Nearing capacity");
    if (!h) return "missing";
    let el = h.nextElementSibling;
    while (el && el.tagName !== "H3") {
      if (el.matches('button[data-act="floor-server"]')) return "server";
      if (el.textContent && el.textContent.includes("None right now.")) return "empty";
      el = el.nextElementSibling;
    }
    return "missing";
  });
  expect(["server", "empty"]).toContain(nearingState);
  await expect.poll(() => activeInDrawer(page), { timeout: 1000 }).toBeTruthy();
  await expect(page.locator("#floor-list-toggle")).toHaveAttribute("aria-expanded", "true");

  await expect(page.locator(".scene.walking")).toHaveCount(0);
  await expect(page.locator(".walk-bar")).toHaveCount(0);
  await expect(page.locator("#floor-list-toggle")).toBeVisible();

  const rowBtn = drawer.locator('[data-act="floor-row"]').first();
  for (let i = 0; i < 30; i += 1) {
    if (await rowBtn.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(rowBtn).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(drawer.getByRole("heading", { name: "Aisles" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /Cold aisle.*Supply/ })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /Hot aisle.*Exhaust/ })).toBeVisible();
  expect(await activeInDrawer(page)).toBeTruthy();

  let hallCrumb = drawer.locator('[data-act="floor-go"][data-level="hall"]');
  await hallCrumb.focus();
  await page.keyboard.press("Enter");
  await expect(drawer.getByRole("heading", { name: "Hall 1" })).toBeVisible();
  await expect(drawer.locator('[data-act="floor-overview"]')).toHaveCount(1);
  await focusOverviewViaTab(page, drawer);
  await page.keyboard.press("Enter");
  await expect(drawer.getByRole("heading", { name: "Rows" })).toBeVisible();
  hallCrumb = drawer.locator('[data-act="floor-go"][data-level="hall"]');
  await hallCrumb.focus();
  await page.keyboard.press("Enter");
  await expect(drawer.getByRole("heading", { name: "Hall 1" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Watch list" })).toBeVisible();
  await expect(drawer.locator('[data-act="floor-overview"]')).toHaveCount(1);
  await expect(hallCrumb).toBeFocused();

  await focusOverviewViaTab(page, drawer);
  await page.keyboard.press("Enter");
  await expect(drawer.getByRole("heading", { name: "Rows" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".inspector")).toHaveCount(0);
  await expect(page.locator("#floor-list-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#floor-list-toggle")).toBeFocused();

  await signInFloor(page, "/#/floor");
  await page.locator("#floor-list-toggle").focus();
  await page.keyboard.press("Enter");
  drawer = page.locator("#floor-detail");
  const hall2 = drawer.locator('[data-act="floor-hall"][data-pod]').nth(1);
  await hall2.focus();
  await page.keyboard.press("Enter");
  const hall2Overview = drawer.locator('[data-act="floor-overview"]');
  await expect(hall2Overview).toHaveAccessibleName("Open Hall 2 overview");
  await hall2Overview.focus();
  await page.keyboard.press("Enter");
  await expect(drawer.getByRole("heading", { name: "Hall 2", level: 2 })).toBeVisible();
  await expect(page.locator(".hud-mission")).toHaveText(/Hall 2/);
});