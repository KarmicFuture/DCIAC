const { test, expect } = require("@playwright/test");

async function signIn(page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("dciac.world"));
  await page.goto("/");
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator(".who strong")).toHaveText("dsvs.operator");
}

function outletRow(page, n) {
  return page.locator("tr", { hasText: new RegExp(`Outlet ${n}\\b`) }).first();
}

test("guided demo walks BMC failover, the leak, and a read-only refusal", async ({ page }) => {
  await signIn(page);
  await page.locator('[data-act="lab-open"]').click();
  await expect(page.getByRole("heading", { name: "Guided demo" })).toBeVisible();

  await page.getByRole("button", { name: "BMC dies on Tray 06" }).click();
  await expect(page.locator("#demo-caption")).toContainText("GPU Tray 06 is on its BMC");
  await expect(page.locator("#demo-caption")).toContainText("ACS serial, not RM1048");
  await page.locator("#demo-advance").click();
  await expect(page.locator("#demo-caption")).toContainText("is dark");
  await expect(page.locator("#demo-caption")).toContainText("ttyS8");
  await page.locator("#demo-advance").click();
  await expect(page.locator("h1")).toHaveText("Sessions");
  await expect(page.locator("#demo-caption")).toContainText("out-of-band console");
  await expect(page.locator(".term-path")).toContainText("ACS ttyS8");
  await page.locator("#demo-advance").click();
  await expect(page.locator("#demo-caption")).toContainText("in-band plane");
  await page.locator("#demo-advance").click();
  await expect(page.locator("#demo-caption")).toHaveCount(0);

  await page.getByRole("button", { name: "DI-1 leak" }).click();
  await expect(page.locator("#demo-caption")).toContainText("DI-1 is quiet");
  await page.locator("#demo-advance").click();
  await expect(page.locator("h1")).toHaveText("Outlet control");
  await expect(page.locator("#demo-caption")).toContainText("Outlets 1 and 2 are locked");
  await expect(outletRow(page, 1).locator('[data-op="cycle"]')).toBeDisabled();
  await expect(outletRow(page, 2).locator('[data-op="cycle"]')).toBeDisabled();
  await page.locator("#demo-advance").click();
  await expect(page.locator("#demo-caption")).toContainText("can be cycled");
  await expect(page.locator("#demo-caption")).toContainText("Plant-wide trip is not the policy");
  await expect(outletRow(page, 1).locator('[data-op="cycle"]')).toBeEnabled();
  await expect(outletRow(page, 2).locator('[data-op="cycle"]')).toBeEnabled();
  await page.locator("#demo-advance").click();

  await page.getByRole("button", { name: "Read-only colo user" }).click();
  await expect(page.locator("#demo-caption")).toContainText("colo.readonly");
  await page.locator("#demo-advance").click();
  await expect(page.locator(".who strong")).toHaveText("colo.readonly");
  await expect(page.locator(".who span")).toHaveText("ReadOnly");
  await page.locator("#demo-advance").click();
  await expect(page.locator(".toast")).toContainText("ReadOnly cannot cycle outlets.");
  await expect(page.locator("#demo-caption")).toContainText("The cycle was refused");
  await expect(page.getByRole("row", { name: /^Outlet 9\b/ }).getByRole("cell").nth(2)).toHaveText("On");
});

test("NOC theme, live regions, keyboard focus, and reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.locator('[data-act="theme"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "noc");
  await expect(page.locator('[data-act="theme"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator("[data-slot=alarm]")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("[data-slot=toast]")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "noc");
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  expect(outline).not.toBe("none");
  const motion = await page.evaluate(() => {
    const el = document.createElement("div");
    el.className = "feed live";
    document.body.appendChild(el);
    return getComputedStyle(el, "::after").animationName;
  });
  expect(motion).toBe("none");
  await page.locator(".rail [data-act=theme]").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  await expect(page.locator(".rail [data-act=theme]")).toHaveAttribute("aria-pressed", "false");
});
