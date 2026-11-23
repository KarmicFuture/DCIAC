const { test, expect } = require("@playwright/test");

async function signIn(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/floor", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator("#app")).not.toContainText("Loading the asset repository");
}

test("Heat path walks heat through each view", async ({ page }) => {
  await signIn(page);
  const toggle = page.locator("#heat-path-toggle");
  await expect(toggle).toHaveAccessibleName("Heat path");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".heat-path")).toHaveCount(0);

  await toggle.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(toggle).toBeFocused();
  const outline = await toggle.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
  await page.keyboard.press("Enter");

  const status = page.locator("#heat-path-status");
  await expect(status).toContainText("dry coolers");
  await expect(page.locator("[data-floor-level]")).toHaveAttribute("data-floor-level", "site");
  await expect(page.locator('.heat-path-steps [aria-current="step"]')).toHaveText("Yard");
  await expect(page.locator("#heat-path-back")).toBeDisabled();
  await expect(page.locator("#heat-path-next")).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(status).toContainText("hot aisle");
  await expect(page.locator("[data-floor-level]")).toHaveAttribute("data-floor-level", "hall");

  await page.locator("#heat-path-next").click();
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "rack");
  await expect(status).toContainText("20.5");
  await expect(page.locator(".thermal-card")).toContainText("Supply");

  const rest = [
    ["oneline", "one-line"],
    ["fleet", "Fleet rolls"],
    ["control", "open outlet"],
    ["map", "Ports do not carry heat"],
    ["sessions", "does not move heat"],
  ];
  for (const pair of rest) {
    await page.locator("#heat-path-next").click();
    await expect(page.locator(".shell")).toHaveAttribute("data-view", pair[0]);
    await expect(status).toContainText(pair[1]);
  }

  await expect(page.locator("#heat-path-next")).toHaveText("Done");
  await page.locator('[data-act="heat-stop"]').last().click();
  await expect(page.locator(".heat-path")).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toBeFocused();
});

test("Escape stops the heat path", async ({ page }) => {
  await signIn(page);
  await page.locator("#heat-path-toggle").click();
  await expect(page.locator(".heat-path")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".heat-path")).toHaveCount(0);
  await expect(page.locator("#heat-path-toggle")).toBeFocused();
});
