const { test, expect } = require("@playwright/test");

function encodeSim(data) {
  const json = JSON.stringify(data);
  const b64 = Buffer.from(json, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signIn(page) {
  await page.locator('[data-user="dsvs.admin"]').click();
  await expect(page.locator(".who strong")).toHaveText("dsvs.admin");
}

async function abnormalCount(page) {
  return page.locator(".hud-mission").evaluate((el) => {
    const match = el.textContent.match(/(\d+)\s+abnormal/);
    return match ? Number(match[1]) : 0;
  });
}

test("shared sim link raises abnormal count, tints racks, and Reset restores", async ({ page }) => {
  const payload = encodeSim({
    seed: 1,
    speed: 60,
    events: [
      { at: 0, eventId: "feeder-a-loss", targetId: "" },
      { at: 1000, eventId: "cdu-failure", targetId: "" },
    ],
  });

  await page.goto("/#/floor/hall");
  await signIn(page);
  await expect(page.locator(".hud-mission")).toBeVisible();
  const startCount = await abnormalCount(page);

  await page.evaluate((sim) => {
    location.hash = "#/floor/hall?sim=" + sim;
  }, payload);

  await expect(page.locator(".sim-bar")).toBeVisible();
  await expect(page.locator(".sim-timeline .sim-tick").first()).toBeVisible();
  await expect.poll(() => abnormalCount(page), { timeout: 20000 }).toBeGreaterThan(startCount);
  await expect(page.locator(".world.sim-active")).toBeVisible();
  await expect(page.locator(".rackbox.sim-hit").first()).toBeVisible();

  await page.locator('[data-act="sim-reset"]').click();
  await expect.poll(() => abnormalCount(page)).toBe(startCount);
});
