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

async function openSiteListDrawer(page) {
  const toggle = page.locator("#floor-list-toggle");
  await toggle.focus();
  await page.keyboard.press("Enter");
  const drawer = page.locator("#floor-detail");
  await expect(drawer).toBeVisible();
  await expect(drawer).toBeFocused();
  await expect(drawer.getByRole("heading", { name: "Ten halls" })).toBeVisible();
  return drawer;
}

test("keyboard Yard piping: list, detail, crumbs, escape", async ({ page }) => {
  await signInFloor(page);
  const drawer = await openSiteListDrawer(page);

  const pipeSup = drawer.locator('h3:has-text("Yard") ~ [data-act="floor-server"][data-server="pipe-sup"]');
  const pipeRet = drawer.locator('h3:has-text("Yard") ~ [data-act="floor-server"][data-server="pipe-ret"]');
  await expect(pipeSup).toHaveCount(1);
  await expect(pipeRet).toHaveCount(1);

  for (const btn of [pipeSup, pipeRet]) {
    await expect(btn).toHaveRole("button");
    await expect(btn).toHaveAttribute("type", "button");
    await expect(btn).toHaveClass(/floor-row/);
  }

  const yardName = new RegExp("^(" + yardStatus.join("|") + ") .+");
  await expect(pipeSup).toHaveAccessibleName(yardName);
  await expect(pipeRet).toHaveAccessibleName(yardName);
  await expect(pipeSup).toHaveAccessibleName(/Supply piping/);
  await expect(pipeRet).toHaveAccessibleName(/Return piping/);

  const yardDom = await page.evaluate(() => {
    const root = document.getElementById("floor-detail");
    const yardH3 = [...root.querySelectorAll("h3")].find((h) => h.textContent.trim() === "Yard");
    const yardSection = [];
    let el = yardH3.nextElementSibling;
    while (el) {
      if (el.tagName === "H3") break;
      if (el.matches('[data-act="floor-server"]')) yardSection.push(el.getAttribute("data-server"));
      el = el.nextElementSibling;
    }
    return {
      pipeCount: yardSection.filter((id) => id && id.startsWith("pipe-")).length,
      serverCount: yardSection.length,
      supAfterYard: yardSection.includes("pipe-sup"),
      retAfterYard: yardSection.includes("pipe-ret"),
    };
  });
  expect(yardDom.supAfterYard).toBe(true);
  expect(yardDom.retAfterYard).toBe(true);
  expect(yardDom.pipeCount).toBe(2);
  expect(yardDom.serverCount).toBeGreaterThanOrEqual(3);

  const pipeWorld = await page.evaluate(() => {
    const pipes = [...document.querySelectorAll(".world .pipe")];
    return {
      count: pipes.length,
      allHidden: pipes.every((p) => p.getAttribute("aria-hidden") === "true"),
      noneTabindex: pipes.every((p) => !p.hasAttribute("tabindex")),
    };
  });
  expect(pipeWorld.count).toBeGreaterThan(0);
  expect(pipeWorld.allHidden).toBe(true);
  expect(pipeWorld.noneTabindex).toBe(true);

  const drawerButtons = await drawer.locator("button").count();
  for (let i = 0; i < drawerButtons + 2; i += 1) {
    if (await pipeSup.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(pipeSup).toBeFocused();
  const supOutline = await pipeSup.evaluate((el) => window.getComputedStyle(el).outlineStyle);
  expect(supOutline).not.toBe("none");

  await page.keyboard.press("Enter");
  await expect(drawer).toBeVisible();
  await expect(page.locator(".inspector")).toHaveCount(1);
  await expect(drawer.getByRole("heading", { name: "Supply piping", level: 2 })).toBeVisible();
  await expect(drawer.getByText("Pipe · simulated load")).toBeVisible();
  await expect(drawer.getByText("Cool supply. It runs along the outside of the east wall.")).toBeVisible();
  await expect(drawer.getByText(/Supply piping carries cool fluid/)).toBeVisible();
  await expect(drawer.locator('.crumbs [data-act="floor-go"][data-level="site"]')).toBeVisible();
  await expect(drawer.locator('.crumbs [data-level="hall"]')).toHaveCount(0);
  await expect.poll(() => activeInDrawer(page), { timeout: 1000 }).toBeTruthy();
  await expect(page.locator("#floor-list-toggle")).toHaveAttribute("aria-expanded", "true");

  const outsideCrumb = drawer.locator('.crumbs [data-act="floor-go"][data-level="site"]');
  for (let i = 0; i < drawerButtons + 2; i += 1) {
    if (await outsideCrumb.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Shift+Tab");
  }
  if (!(await outsideCrumb.evaluate((el) => el === document.activeElement))) {
    for (let i = 0; i < drawerButtons + 2; i += 1) {
      if (await outsideCrumb.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
  }
  await expect(outsideCrumb).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Ten halls" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Yard", level: 3 })).toBeVisible();
  await expect(drawer.locator('[data-server="pipe-ret"]')).toHaveCount(1);
  await expect(outsideCrumb).toBeFocused();

  for (let i = 0; i < drawerButtons + 2; i += 1) {
    if (await pipeRet.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(pipeRet).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(drawer.getByRole("heading", { name: "Return piping", level: 2 })).toBeVisible();
  await expect(drawer.getByText("Warm return. It runs beside the supply and stays outside the hall.")).toBeVisible();
  await expect(drawer.getByText(/Return piping carries warm fluid/)).toBeVisible();
  await expect.poll(() => activeInDrawer(page), { timeout: 1000 }).toBeTruthy();

  await page.keyboard.press("Escape");
  await expect(page.locator(".inspector")).toHaveCount(0);
  await expect(page.locator("#floor-list-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#floor-list-toggle")).toBeFocused();
});

test("pointer pipe open unchanged", async ({ page }) => {
  await signInFloor(page);
  await expect(page.locator(".inspector")).toHaveCount(0);
  const pipe = page.locator('.pipe.supply[data-server="pipe-sup"]').first();
  await pipe.dispatchEvent("click");
  const drawer = page.locator("#floor-detail");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Supply piping", level: 2 })).toBeVisible();
  await expect(drawer.getByText("Cool supply. It runs along the outside of the east wall.")).toBeVisible();
});