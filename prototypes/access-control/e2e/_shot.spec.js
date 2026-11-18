const { test } = require("@playwright/test");
test("shot", async ({ page }) => {
  page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
  page.on("console", (msg) => { if (msg.type() === "error") console.log("CONSOLE", msg.text()); });
  await page.goto("/");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/tmp/access-home.png", fullPage: true });
  const boot = await page.locator("#app").innerText();
  console.log("BOOT", JSON.stringify(boot.slice(0, 300)));
  await page.locator('[data-user="dsvs.admin"]').click();
  await page.waitForSelector(".who strong");
  await page.locator('.rail [data-act="nav"][data-view="rack"]').click();
  await page.locator('.view-tabs [data-act="nav"][data-view="oneline"]').click();
  await page.waitForSelector(".oneline-sheet");
  await page.screenshot({ path: "/tmp/access-oneline.png", fullPage: true });
});
