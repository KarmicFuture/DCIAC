const { test, expect } = require("@playwright/test");

test("the build plan starts as grass and ends as the 100 MW campus", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator(".hud-mission")).toContainText("Outside");

  await page.locator('nav [data-view="plan"]').click();
  await expect(page.locator("h1")).toHaveText("Plan · Campus");
  await expect(page.locator(".plan-day")).toBeVisible();
  await expect(page.locator(".build-scene .grass-slab")).toBeVisible();
  await expect(page.locator(".build-scene .legend")).toContainText("Grass field");
  await expect(page.locator(".build-scene .legend")).toContainText("0 MW");
  await expect(page.locator(".build-scene .rackbox.building:not(.shell)")).toHaveCount(0);

  await page.locator('[data-act="build-day"][data-date="2027-11-15"]').click();
  await expect(page.locator(".plan-day")).toHaveText("15 Nov 2027");
  await expect(page.locator(".build-scene .legend")).toContainText("100 MW");
  await expect(page.locator(".build-scene .legend")).toContainText("10 halls");
  await expect(page.locator(".build-scene .rackbox.building:not(.shell)")).toHaveCount(10);
  await expect(page.locator('.stage-bar [data-act="build-stage"][data-date="2027-10-01"]')).toHaveAttribute("aria-pressed", "true");

  await page.locator('.stage-bar [data-act="build-stage"][data-date="2026-11-16"]').click();
  await expect(page.locator(".build-scene .grass-slab")).toBeVisible();
  await expect(page.locator(".build-scene .legend")).toContainText("0 MW");
});
