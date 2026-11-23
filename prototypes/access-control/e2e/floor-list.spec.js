const { test, expect } = require("@playwright/test");

const yardStatus = ["Nominal", "Rise", "Hot", "RDP", "BMC"];

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

test("List toggle is closed by default at site and hall", async ({ page }) => {
  await signInFloor(page);
  await expect(page.locator(".inspector")).toHaveCount(0);
  const toggle = page.locator("#floor-list-toggle");
  await expect(toggle).toHaveRole("button");
  await expect(toggle).toHaveAccessibleName("List");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".inspector")).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("keyboard List flow: halls, racks, focus, escape", async ({ page }) => {
  await signInFloor(page);

  await page.locator('[data-act="floor-go"][data-level="hall"]').focus();
  for (let i = 0; i < 6; i += 1) {
    const id = await page.evaluate(() => document.activeElement && document.activeElement.id);
    if (id === "floor-list-toggle") break;
    await page.keyboard.press("Tab");
  }
  await expect(page.locator("#floor-list-toggle")).toBeFocused();

  await page.keyboard.press("Enter");
  let toggle = page.locator("#floor-list-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  let drawer = page.locator("#floor-detail");
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveRole("complementary");
  await expect(drawer).toHaveAccessibleName("Floor details");
  await expect(drawer).toBeFocused();
  await expect(drawer.getByRole("heading", { name: "Ten halls" })).toBeVisible();
  await expect(drawer.locator('[data-act="floor-hall"]')).toHaveCount(10);
  await expect(drawer.locator('[data-act="floor-hall"]').first()).toHaveAccessibleName(/^Hall 1\s+20 racks$/);

  const yardButtons = drawer.locator('h3:has-text("Yard") ~ [data-act="floor-server"]');
  const yardCount = await yardButtons.count();
  const yardName = new RegExp("^(" + yardStatus.join("|") + ")");
  for (let i = 0; i < yardCount; i += 1) {
    await expect(yardButtons.nth(i)).toHaveAccessibleName(yardName);
  }

  await expect
    .poll(() => page.locator("#floor-detail:focus-visible").count())
    .toBeGreaterThan(0);
  const outlineStyle = await drawer.evaluate((el) => window.getComputedStyle(el).outlineStyle);
  expect(outlineStyle).not.toBe("none");

  const hallBtn = drawer.locator('[data-act="floor-hall"][data-pod="pod-a"]');
  for (let i = 0; i < 4; i += 1) {
    if (await hallBtn.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(hallBtn).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.locator(".hud-mission")).toHaveText(/Hall 1/);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Hall 1" })).toBeVisible();
  await expect(drawer.locator('[data-act="floor-rack"]')).toHaveCount(20);
  await expect(drawer.locator('[data-rack="A14"]')).toHaveAccessibleName(
    /^(Nominal|Rise|Hot|RDP|BMC) .*A14.*\d+ devices$/
  );
  expect(await activeInDrawer(page)).toBeTruthy();

  await expect(drawer.getByRole("heading", { name: "Watch list" })).toBeVisible();
  const alarmName = /^(BMC|RDP|Hot|Rise)/;
  const watchNames = await drawer.evaluate(() => {
    const root = document.getElementById("floor-detail");
    if (!root) return [];
    const watchHeading = [...root.querySelectorAll("h3")].find((h) => h.textContent.trim() === "Watch list");
    if (!watchHeading) return [];
    const names = [];
    let el = watchHeading.nextElementSibling;
    while (el && el.tagName !== "H3") {
      if (el.matches('button[data-act="floor-server"]')) {
        const led = el.querySelector(".led");
        const status = led && led.getAttribute("aria-label") ? led.getAttribute("aria-label") + " " : "";
        names.push(status + (el.textContent || "").replace(/\s+/g, " ").trim());
      }
      el = el.nextElementSibling;
    }
    return names;
  });
  const watchAlarm = watchNames.filter((name) => alarmName.test(name));
  if (watchAlarm.length === 0) {
    await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".alarm-chip")).toHaveText(/P1 · \d+/);
    await page.locator("#floor-list-toggle").focus();
    await page.keyboard.press("Enter");
    drawer = page.locator("#floor-detail");
    await expect(drawer.getByRole("heading", { name: "Watch list" })).toBeVisible();
    const namesHall = await drawer.evaluate(() => {
      const root = document.getElementById("floor-detail");
      const watchHeading = [...root.querySelectorAll("h3")].find((h) => h.textContent.trim() === "Watch list");
      const names = [];
      let el = watchHeading.nextElementSibling;
      while (el && el.tagName !== "H3") {
        if (el.matches('button[data-act="floor-server"]')) {
          names.push(el);
        }
        el = el.nextElementSibling;
      }
      return names.length;
    });
    expect(namesHall).toBeGreaterThan(0);
    await expect(drawer.locator('h3:text-is("Watch list") ~ [data-act="floor-server"]').first()).toHaveAccessibleName(alarmName);
  } else {
    expect(watchAlarm.length).toBeGreaterThan(0);
  }

  await drawer.locator('[data-rack="A14"]').focus();
  await page.keyboard.press("Enter");
  await expect(drawer.locator(".crumbs")).toContainText("A14");
  await expect(drawer.locator('[data-act="rack-positions"]')).toBeVisible({ timeout: 10000 });
  await expect.poll(() => activeInDrawer(page), { timeout: 1000 }).toBeTruthy();

  await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".hud-mission")).toHaveText(/Hall 1/);
  if (await page.locator(".inspector").count() > 0) {
    await page.keyboard.press("Escape");
  }
  await expect(page.locator(".inspector")).toHaveCount(0);
  toggle = page.locator("#floor-list-toggle");
  drawer = page.locator("#floor-detail");
  await toggle.focus();
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".inspector")).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();

  await page.locator("#floor-list-toggle").focus();
  await page.keyboard.press("Enter");
  await expect(drawer).toBeVisible();
  await page.locator("#floor-list-toggle").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".inspector")).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
});

test("pointer rack open unchanged", async ({ page }) => {
  await signInFloor(page, "/#/floor/hall");
  await page.locator('.rackbox[data-act="floor-rack"][data-rack="A14"] .ftop').click();
  await expect(page.locator("#floor-detail .crumbs")).toContainText("A14");
});