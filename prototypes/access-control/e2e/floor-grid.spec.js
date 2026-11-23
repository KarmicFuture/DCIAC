const { test, expect } = require("@playwright/test");

async function signInFloor(page, hash = "/#/floor") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(hash, { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
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

async function openSiteListDrawer(page) {
  const toggle = page.locator("#floor-list-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.focus();
    await page.keyboard.press("Enter");
  }
  const drawer = page.locator("#floor-detail");
  await expect(drawer).toBeVisible();
  await expect(drawer).toBeFocused();
  await expect(drawer.getByRole("heading", { name: "Ten halls" })).toBeVisible();
  return drawer;
}

async function tabToFocused(page, locator, maxTabs) {
  for (let i = 0; i < maxTabs; i += 1) {
    if (await locator.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
}

test("keyboard grid drawers open the matching feeder", async ({ page }) => {
  await signInFloor(page);
  const drawer = await openSiteListDrawer(page);

  const grid1 = drawer.locator('[data-act="floor-server"][data-server="grid-1"]');
  await grid1.focus();
  await page.keyboard.press("Enter");
  await expect(drawer.getByRole("heading", { level: 2, name: /Feeder A/ })).toBeVisible();

  const openFeederA = drawer.locator('[data-act="floor-feed"]');
  await expect(openFeederA).toHaveCount(1);
  await expect(openFeederA).toHaveRole("button");
  await expect(openFeederA).toHaveAttribute("type", "button");
  await expect(openFeederA).toHaveAttribute("data-feed", "grid-xfmr-a");
  await expect(openFeederA).not.toHaveAttribute("data-pod", /.+/);
  await expect(openFeederA).toHaveAccessibleName("Open Feeder A");
  await expect(page.locator('[data-feed="grid-xfmr"]')).toHaveCount(0);

  const drawerButtons = await drawer.locator("button").count();
  await tabToFocused(page, openFeederA, drawerButtons + 2);
  await expect(openFeederA).toBeFocused();
  const aOutline = await openFeederA.evaluate((el) => window.getComputedStyle(el).outlineStyle);
  expect(aOutline).not.toBe("none");

  await page.keyboard.press("Enter");
  await expect(drawer).toBeVisible();
  await expect(page.locator(".inspector")).toHaveCount(1);
  await expect(drawer.getByRole("heading", { name: "Energized", level: 2 })).toBeVisible();
  await expect(drawer.getByText(/Feeder A/)).toBeVisible();
  await expect(drawer.getByText(/Utility feeder/)).toBeVisible();
  await expect.poll(() => activeInDrawer(page), { timeout: 1000 }).toBeTruthy();
  await expect(page.locator(".scene.walking")).toHaveCount(0);
  await expect(page.locator(".walk-bar")).toHaveCount(0);
  await expect(page.locator("#floor-list-toggle")).toHaveAttribute("aria-expanded", "true");

  const openGrid = drawer.getByRole("button", { name: "Open the grid" });
  await expect(openGrid).toHaveAttribute("data-server", "grid-1");
  await tabToFocused(page, openGrid, drawerButtons + 2);
  await expect(openGrid).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(drawer.getByRole("heading", { level: 2, name: /Feeder A/ })).toBeVisible();
  await expect.poll(() => activeInDrawer(page), { timeout: 1000 }).toBeTruthy();
  await expect(drawer.locator('[data-act="floor-feed"][data-feed="grid-xfmr-a"]')).toHaveCount(1);
  await expect(drawer.getByRole("button", { name: "Open Feeder A" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator("#floor-list-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#floor-list-toggle")).toBeFocused();

  await page.locator("#floor-list-toggle").focus();
  await page.keyboard.press("Enter");
  const drawer2 = page.locator("#floor-detail");
  await expect(drawer2).toBeVisible();
  await drawer2.locator('.crumbs [data-act="floor-go"][data-level="site"]').click();
  await expect(drawer2.getByRole("heading", { name: "Ten halls" })).toBeVisible();
  const grid2 = drawer2.locator('[data-act="floor-server"][data-server="grid-2"]');
  await grid2.focus();
  await page.keyboard.press("Enter");
  await expect(drawer2.getByRole("heading", { level: 2, name: /Feeder B/ })).toBeVisible();

  const openFeederB = drawer2.locator('[data-act="floor-feed"]');
  await expect(openFeederB).toHaveCount(1);
  await expect(openFeederB).toHaveAttribute("data-feed", "grid-xfmr-b");
  await expect(openFeederB).toHaveAccessibleName("Open Feeder B");

  const drawerButtons2 = await drawer2.locator("button").count();
  await tabToFocused(page, openFeederB, drawerButtons2 + 2);
  await expect(openFeederB).toBeFocused();
  const bOutline = await openFeederB.evaluate((el) => window.getComputedStyle(el).outlineStyle);
  expect(bOutline).not.toBe("none");

  await page.keyboard.press("Enter");
  await expect(drawer2.getByRole("heading", { name: "Energized", level: 2 })).toBeVisible();
  await expect(drawer2.getByText(/Feeder B/)).toBeVisible();
  await expect(drawer2.getByText(/Utility feeder/)).toBeVisible();
  await expect.poll(() => activeInDrawer(page), { timeout: 1000 }).toBeTruthy();
  await expect(page.locator(".scene.walking")).toHaveCount(0);
  await expect(page.locator(".walk-bar")).toHaveCount(0);
  await expect(page.locator("#floor-list-toggle")).toHaveAttribute("aria-expanded", "true");

  const openGridB = drawer2.getByRole("button", { name: "Open the grid" });
  await expect(openGridB).toHaveAttribute("data-server", "grid-2");
  await tabToFocused(page, openGridB, drawerButtons2 + 2);
  await page.keyboard.press("Enter");
  await expect(drawer2.getByRole("heading", { level: 2, name: /Feeder B/ })).toBeVisible();
  await expect(drawer2.locator('[data-act="floor-feed"][data-feed="grid-xfmr-b"]')).toHaveCount(1);
  await expect(drawer2.getByRole("button", { name: "Open Feeder B" })).toBeVisible();

  const feedWorld = await page.evaluate(() => {
    const feeds = [...document.querySelectorAll(".world .feed")];
    return {
      count: feeds.length,
      allHidden: feeds.every((p) => p.getAttribute("aria-hidden") === "true"),
      noneTabindex: feeds.every((p) => !p.hasAttribute("tabindex")),
    };
  });
  expect(feedWorld.count).toBeGreaterThan(0);
  expect(feedWorld.allHidden).toBe(true);
  expect(feedWorld.noneTabindex).toBe(true);
});