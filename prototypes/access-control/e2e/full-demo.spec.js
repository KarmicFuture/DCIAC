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

test("Operator Full demo auto-advances with highlight pops", async ({ page }) => {
  await signInOperator(page);
  await page.evaluate(() => window.AccessDemo.setDemoPauseMs(250));
  await expect(page.locator('.rail [data-act="demo-full"]')).toBeVisible();
  await page.locator('.rail [data-act="demo-full"]').click();

  await expect(page.locator(".demo-tour")).toBeVisible();
  await expect(page.locator(".demo-pop")).toBeVisible();
  await expect(page.locator(".demo-spot")).toBeVisible();
  await expect(page.locator("#demo-caption")).toContainText("100 MW campus");
  await expect(page.locator("#demo-advance")).toHaveCount(0);

  await expect.poll(async () => page.locator("#demo-caption").textContent(), { timeout: 5000 })
    .toContain("Hall 1");
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "floor");

  await expect.poll(async () => page.locator(".shell").getAttribute("data-view"), { timeout: 5000 })
    .toBe("oneline");
  await expect(page.locator(".oneline-sheet")).toBeVisible();
  await expect(page.locator("#demo-caption")).toContainText("one-line");

  await page.evaluate(() => window.AccessDemo.stopDemo());
  await expect(page.locator(".demo-tour")).toHaveCount(0);
});
