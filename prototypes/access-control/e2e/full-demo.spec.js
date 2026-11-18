const { test, expect } = require("@playwright/test");

async function signInOperator(page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("dciac.world"));
  await page.goto("/");
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator(".who strong")).toHaveText("dsvs.operator");
  await expect(page.locator(".who span")).toHaveText("Operator");
  const briefing = page.locator('[data-act="briefing-skip"]');
  if (await briefing.count()) await briefing.click();
}

test("Operator Full demo walks product surfaces", async ({ page }) => {
  await signInOperator(page);
  await expect(page.locator('.rail [data-act="demo-full"]')).toBeVisible();
  await page.locator('.rail [data-act="demo-full"]').click();
  await expect(page.locator(".demo-coach")).toBeVisible();
  await expect(page.locator("#demo-caption")).toContainText("100 MW campus");

  await page.locator("#demo-advance").click();
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "floor");
  await expect(page.locator("#demo-caption")).toContainText("Hall 1");

  await page.locator("#demo-advance").click();
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "oneline");
  await expect(page.locator(".oneline-sheet")).toBeVisible();

  await page.locator("#demo-advance").click();
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "rack");

  await page.locator('[data-act="demo-stop"]').click();
  await expect(page.locator(".demo-coach")).toHaveCount(0);
});
