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

test("keyboard site feeders: list, detail, grid, escape", async ({ page }) => {
  await signInFloor(page);
  const drawer = await openSiteListDrawer(page);

  const feedButtons = drawer.locator('[data-act="floor-feed"]');
  await expect(feedButtons).toHaveCount(2);
  const feederA = drawer.locator('[data-act="floor-feed"][data-feed="grid-xfmr-a"]');
  const feederB = drawer.locator('[data-act="floor-feed"][data-feed="grid-xfmr-b"]');
  await expect(feederA).toHaveCount(1);
  await expect(feederB).toHaveCount(1);

  for (const btn of [feederA, feederB]) {
    await expect(btn).toHaveRole("button");
    await expect(btn).toHaveAttribute("type", "button");
    await expect(btn).toHaveClass(/floor-row/);
    await expect(btn).not.toHaveAttribute("data-pod", /.+/);
  }
  await expect(feederA).toHaveAccessibleName("Feeder A");
  await expect(feederB).toHaveAccessibleName("Feeder B");

  await expect(drawer.getByRole("heading", { name: "Feeders", level: 3 })).toBeVisible();

  const domOrder = await page.evaluate(() => {
    const root = document.getElementById("floor-detail");
    const h3s = [...root.querySelectorAll("h3")].map((h) => h.textContent.trim());
    const yardH3 = [...root.querySelectorAll("h3")].find((h) => h.textContent.trim() === "Yard");
    const yardFeed = [];
    let el = yardH3.nextElementSibling;
    while (el) {
      if (el.tagName === "H3") break;
      if (el.matches('[data-act="floor-feed"]')) yardFeed.push(el.getAttribute("data-feed"));
      el = el.nextElementSibling;
    }
    return { h3s, yardFeedCount: yardFeed.length };
  });
  expect(domOrder.h3s.indexOf("Halls")).toBeLessThan(domOrder.h3s.indexOf("Yard"));
  expect(domOrder.h3s.indexOf("Yard")).toBeLessThan(domOrder.h3s.indexOf("Feeders"));
  expect(domOrder.yardFeedCount).toBe(0);

  await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#app")).not.toContainText("Loading the asset repository");
  const hallToggle = page.locator("#floor-list-toggle");
  if ((await hallToggle.getAttribute("aria-expanded")) !== "true") {
    await hallToggle.focus();
    await page.keyboard.press("Enter");
  }
  await expect(page.locator("#floor-detail")).toBeVisible();
  await expect(page.locator("#floor-detail").locator('[data-act="floor-feed"][data-feed^="grid-xfmr"]')).toHaveCount(0);

  await page.goto("/#/floor", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#app")).not.toContainText("Loading the asset repository");
  const drawer2 = await openSiteListDrawer(page);
  const feederA2 = drawer2.locator('[data-act="floor-feed"][data-feed="grid-xfmr-a"]');
  const drawerButtons = await drawer2.locator("button").count();

  for (let i = 0; i < drawerButtons + 2; i += 1) {
    if (await feederA2.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(feederA2).toBeFocused();
  const aOutline = await feederA2.evaluate((el) => window.getComputedStyle(el).outlineStyle);
  expect(aOutline).not.toBe("none");

  await page.keyboard.press("Enter");
  await expect(drawer2).toBeVisible();
  await expect(page.locator(".inspector")).toHaveCount(1);
  await expect(drawer2.getByRole("heading", { name: "Energized", level: 2 })).toBeVisible();
  await expect(drawer2.getByText("Feeder A. Utility feeder from the grid gantry to MV transformer A.")).toBeVisible();
  await expect(drawer2.getByText("The conductor stays in the yard.")).toBeVisible();
  const openGrid = drawer2.getByRole("button", { name: "Open the grid" });
  await expect(openGrid).toHaveAttribute("data-act", "floor-server");
  await expect(openGrid).toHaveAttribute("data-server", "grid-1");
  await expect(drawer2.locator('.crumbs [data-act="floor-go"][data-level="site"]')).toBeVisible();
  await expect(drawer2.locator('.crumbs')).toContainText("Feed");
  await expect(drawer2.locator('.crumbs [data-level="hall"]')).toHaveCount(0);
  await expect.poll(() => activeInDrawer(page), { timeout: 1000 }).toBeTruthy();
  await expect(page.locator("#floor-list-toggle")).toHaveAttribute("aria-expanded", "true");

  await expect(page.locator(".scene.walking")).toHaveCount(0);
  await expect(page.locator(".walk-bar")).toHaveCount(0);
  await expect(page.locator("#floor-list-toggle")).toBeVisible();

  const feedWorld = await page.evaluate(() => {
    const feeds = [...document.querySelectorAll(".world .feed")];
    return {
      count: feeds.length,
      allHidden: feeds.every((p) => p.getAttribute("aria-hidden") === "true"),
      noneTabindex: feeds.every((p) => !p.hasAttribute("tabindex")),
      xfmrA: document.querySelectorAll('.world .feed[data-feed="grid-xfmr-a"]').length,
    };
  });
  expect(feedWorld.count).toBeGreaterThan(0);
  expect(feedWorld.allHidden).toBe(true);
  expect(feedWorld.noneTabindex).toBe(true);
  expect(feedWorld.xfmrA).toBeGreaterThanOrEqual(1);

  for (let i = 0; i < drawerButtons + 2; i += 1) {
    if (await openGrid.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(openGrid).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(drawer2.getByRole("heading", { level: 2, name: /Feeder A/ })).toBeVisible();
  await expect.poll(() => activeInDrawer(page), { timeout: 1000 }).toBeTruthy();

  await drawer2.locator('.crumbs [data-act="floor-go"][data-level="site"]').click();
  await expect(drawer2.getByRole("heading", { name: "Ten halls" })).toBeVisible();
  for (let i = 0; i < drawerButtons + 2; i += 1) {
    if (await feederA2.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");
  await expect(drawer2.getByRole("heading", { name: "Energized", level: 2 })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator(".inspector")).toHaveCount(0);
  await expect(page.locator("#floor-list-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#floor-list-toggle")).toBeFocused();

  await page.goto("/#/floor", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#app")).not.toContainText("Loading the asset repository");
  const drawerB = await openSiteListDrawer(page);
  const feederB2 = drawerB.locator('[data-act="floor-feed"][data-feed="grid-xfmr-b"]');
  for (let i = 0; i < drawerButtons + 2; i += 1) {
    if (await feederB2.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");
  await expect(drawerB.getByRole("heading", { name: "Energized", level: 2 })).toBeVisible();
  await expect(drawerB.getByText("Feeder B. Utility feeder from the grid gantry to MV transformer B.")).toBeVisible();
  const openGridB = drawerB.getByRole("button", { name: "Open the grid" });
  await expect(openGridB).toHaveAttribute("data-server", "grid-2");
  await expect.poll(() => activeInDrawer(page), { timeout: 1000 }).toBeTruthy();
});