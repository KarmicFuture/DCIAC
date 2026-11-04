const { test, expect } = require("@playwright/test");

async function signIn(page) {
  await page.goto("/");
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator("h1")).toBeVisible();
}

test("phone puts content first and keeps primary tabs", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const rail = await page.locator(".rail").boundingBox();
  expect(rail.x + rail.width).toBeLessThanOrEqual(1);
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
  const bar = await page.locator(".topbar").boundingBox();
  const content = await page.locator("[data-slot='alarm']").boundingBox();
  expect(content.y).toBeGreaterThan(bar.y);
  expect(content.y).toBeLessThan(bar.y + bar.height + 24);
  const tabs = page.locator(".tabbar");
  await expect(tabs).toBeVisible();
  for (const label of ["Rack", "Port map", "Sessions", "Audit"]) {
    await expect(tabs.getByRole("button", { name: label })).toBeVisible();
  }
  const tabBox = await tabs.boundingBox();
  expect(tabBox.y + tabBox.height).toBeGreaterThan(800);

  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.locator(".rail")).toBeInViewport();
  await page.locator('.rail nav [data-view="floor"]').click();
  expect((await page.locator(".rail").boundingBox()).x + (await page.locator(".rail").boundingBox()).width).toBeLessThanOrEqual(1);

  await tabs.getByRole("button", { name: "Port map" }).click();
  await expect(page.locator("h1")).toHaveText("Port map");
  await expect(page.locator(".port-legend")).toContainText("In the rack");
  await expect(page.locator(".port-legend")).toContainText("Serial-only");
  await expect(page.locator(".port-legend")).toContainText("Refused");
  await expect(page.locator(".port-legend")).toContainText("Alarm");

  await page.locator("#port-search").fill("ttyS8");
  await expect(page.locator(".port-cell")).toHaveCount(1);
  await expect(page.locator(".port-cell")).toContainText("GPU Tray 06");
  await page.locator("#port-search").fill("");
  await page.locator('[data-filter="refused"]').click();
  await expect(page.locator(".port-cell")).toHaveCount(2);
  await page.locator('[data-filter="rack"]').click();
  await expect(page.locator(".port-cell[data-port-kind='rack']").first()).toBeVisible();
  await expect(page.locator(".port-cell[data-port-kind='serial']")).toHaveCount(0);
  await page.locator('[data-act="port-density"]').click();
  await expect(page.locator(".port-grid")).toHaveClass(/compact/);
});

test("desktop keeps the side rail and the port map tools", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const rail = await page.locator(".rail").boundingBox();
  expect(rail.x).toBeGreaterThanOrEqual(0);
  expect(rail.width).toBeGreaterThan(200);
  await expect(page.locator(".topbar")).toBeHidden();
  await expect(page.locator(".tabbar")).toBeHidden();
  await page.locator('nav [data-view="map"]').click();
  await expect(page.locator("h1")).toHaveText("Port map");
  await expect(page.locator(".port-legend")).toBeVisible();
  await page.locator("#port-search").fill("SN2201");
  await expect(page.locator(".port-cell")).toHaveCount(1);
  await expect(page.locator(".port-cell")).toContainText("ttyS4");
  await page.locator("#port-search").fill("");
  await page.locator('[data-filter="alarm"]').click();
  await expect(page.locator(".port-cell").first()).toBeVisible();
  await expect(page.locator(".port-cell.alarm").first()).toBeVisible();
});
