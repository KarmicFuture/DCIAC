const { test, expect } = require("@playwright/test");

test("install a PowerEdge R760 from Find a home and alarm on Feeder A", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.admin"]').click();
  await expect(page.locator(".who strong")).toHaveText("dsvs.admin");

  await page.locator('nav [data-view="dcim"]').click();
  await expect(page.locator("h1")).toHaveText("DCIM");
  await page.locator('[data-act="dcim-home"]').click();
  const home = page.locator('[data-act="dcim-plan"][data-rack="H3-07"]');
  await expect(home).toBeVisible();
  await home.click();
  const note = page.locator(".dcim p.fine");
  await expect(note).toContainText("not installed yet");
  await page.locator('[data-act="dcim-promote"]').click();
  await expect(note).toContainText("is submitted");
  const workId = ((await note.innerText()).match(/WO-[A-Za-z0-9-]+/) || [""])[0];
  await page.locator(`[data-id="${workId}"][data-to="Approved"]`).click();
  await expect(page.locator(".dcim")).toContainText("Approved");
  await page.locator(`[data-id="${workId}"][data-to="Verified"]`).click();
  await expect(page.locator(".dcim")).toContainText("Verified");

  await page.locator('[data-act="dcim-tab"][data-tab="capacity"]').click();
  await expect(page.locator(".dcim")).toContainText("PUE 1.05");
  await page.locator('[data-act="dcim-tab"][data-tab="reports"]').click();
  await page.locator('[data-act="dcim-report"][data-kind="audit"]').click();
  await expect(page.locator(".dcim")).toContainText("work order verify");

  await page.locator('nav [data-view="floor"]').click();
  await page.locator('.rackbox.building[data-pod="hall-3"] .ftop').click();
  await page.locator('button[data-act="floor-rack"][data-rack="H3-07"]').click();
  await expect(page.locator(".elev-scene, .elevation")).toContainText("PowerEdge R760");
  await page.locator('[data-act="power-fail"][data-node="grid-1"]').click();
  await expect(page.locator(".power-fail")).toContainText("No device loses power");
  await expect(page.locator(".power-fail")).toContainText("Alarm recorded");

  await page.locator('nav [data-view="dcim"]').click();
  await page.locator('[data-act="dcim-tab"][data-tab="monitor"]').click();
  await expect(page.locator(".dcim")).toContainText("grid-1");
});
